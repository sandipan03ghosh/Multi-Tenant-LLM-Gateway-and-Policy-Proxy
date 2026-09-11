import type { JobScheduler, JobDefinition, ScheduleOptions, JobHandle, JobHandler } from "@llm-gateway/domain";
import { runWithRequestId } from "@llm-gateway/adapters-observability";
import type { PrismaClient } from "../prisma-client.js";

export interface PostgresJobSchedulerConfig {
  /** How often to poll for claimable jobs. */
  readonly pollIntervalMs?: number;
  /** How long a claimed job's lease lasts before another worker may re-claim it. */
  readonly leaseDurationMs?: number;
  /** Max jobs claimed per poll tick. */
  readonly batchSize?: number;
  /** Backoff applied to a failed job's next runAt when it hasn't exhausted maxAttempts. */
  readonly retryBackoffMs?: number;
  /** Default maxAttempts for enqueue() calls that don't specify their own. */
  readonly defaultMaxAttempts?: number;
}

const DEFAULT_CONFIG: Required<PostgresJobSchedulerConfig> = {
  pollIntervalMs: 1_000,
  leaseDurationMs: 30_000,
  batchSize: 10,
  retryBackoffMs: 5_000,
  defaultMaxAttempts: 5,
};

interface ClaimedJobRow {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lockToken: string;
}

// Postgres-backed JobScheduler — SKIP LOCKED polling, no message broker.
//
// NOTE: the raw SQL double-quotes every camelCase column identifier; verify column names against
// prisma/schema.prisma's Job model the first time migrations run. Assumes PostgreSQL 13+ for
// `gen_random_uuid()`.
//
// claimBatch() is a single atomic statement (a CTE'd SELECT ... FOR UPDATE SKIP LOCKED feeding
// an UPDATE ... RETURNING), race-free across concurrent workers without an explicit transaction.
// It matches both due PENDING rows and RUNNING rows whose lease expired, which is what
// re-claims a crashed worker's job. `attempts` is incremented in that same claim (not in
// markFailed) so a job that crashes the whole worker process still consumes an attempt.
//
// Both claim branches require `"attempts" < "maxAttempts"`, so an exhausted job is never
// re-executed — but that alone would strand it at RUNNING if its worker crashed on the final
// attempt, so every poll also runs failExhaustedExpiredJobs(), a separate UPDATE sweeping exactly
// that case straight to FAILED. The two statements act on disjoint row sets, so no race.
//
// `"lockToken" = gen_random_uuid()::text` is evaluated per row, so each claimed job gets its own
// token. markSucceeded/markFailed filter on (id, lockToken): if the lease expired and another
// worker reclaimed the job, the original worker's write matches zero rows and is a safe no-op.
export class PostgresJobScheduler implements JobScheduler {
  private readonly config: Required<PostgresJobSchedulerConfig>;
  private readonly handlers = new Map<string, JobHandler>();
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  constructor(
    private readonly prisma: PrismaClient,
    config: PostgresJobSchedulerConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async enqueue(job: JobDefinition, options: ScheduleOptions = {}): Promise<JobHandle> {
    const row = await this.prisma.job.create({
      data: {
        type: job.type,
        payload: job.payload as never,
        runAt: options.runAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? this.config.defaultMaxAttempts,
      },
    });
    return { jobId: row.id };
  }

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  // Starts the poll loop — call once from the worker composition root after registering every
  // handler. Not part of the JobScheduler port: polling is specific to this implementation.
  start(): void {
    this.stopped = false;
    this.scheduleNextPoll(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      void this.pollOnce().finally(() => this.scheduleNextPoll(this.config.pollIntervalMs));
    }, delayMs);
  }

  private async pollOnce(): Promise<void> {
    await this.failExhaustedExpiredJobs();

    let claimed: ClaimedJobRow[];
    try {
      claimed = await this.claimBatch();
    } catch (error) {
      console.error("PostgresJobScheduler: failed to claim jobs (will retry next poll):", error);
      return;
    }
    // Sequential, not concurrent — concurrency tuning is future work.
    for (const job of claimed) {
      await this.runClaimedJob(job);
    }
  }

  // Sweeps jobs stuck at RUNNING past their lease that have also exhausted maxAttempts.
  // Best-effort: a failure here is logged and retried next poll.
  private async failExhaustedExpiredJobs(): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "jobs"
        SET "status" = 'FAILED', "lockedAt" = NULL, "lockedUntil" = NULL, "lockToken" = NULL,
            "lastError" = 'Job exhausted its maxAttempts while its worker was unreachable (lease expired)'
        WHERE "status" = 'RUNNING' AND "lockedUntil" < now() AND "attempts" >= "maxAttempts"
      `;
    } catch (error) {
      console.error("PostgresJobScheduler: failed to sweep exhausted expired jobs (will retry next poll):", error);
    }
  }

  private async claimBatch(): Promise<ClaimedJobRow[]> {
    const leaseUntil = new Date(Date.now() + this.config.leaseDurationMs);
    return this.prisma.$queryRaw<ClaimedJobRow[]>`
      WITH claimed AS (
        SELECT "id"
        FROM "jobs"
        WHERE ("status" = 'PENDING' AND "runAt" <= now() AND "attempts" < "maxAttempts")
           OR ("status" = 'RUNNING' AND "lockedUntil" < now() AND "attempts" < "maxAttempts")
        ORDER BY "runAt" ASC
        LIMIT ${this.config.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "jobs"
      SET "status" = 'RUNNING', "lockedAt" = now(), "lockedUntil" = ${leaseUntil}, "attempts" = "attempts" + 1, "lockToken" = gen_random_uuid()::text
      FROM claimed
      WHERE "jobs"."id" = claimed."id"
      RETURNING "jobs"."id", "jobs"."type", "jobs"."payload", "jobs"."attempts", "jobs"."maxAttempts", "jobs"."lockToken"
    `;
  }

  private async runClaimedJob(job: ClaimedJobRow): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.error(`PostgresJobScheduler: no handler registered for job type "${job.type}"`);
      await this.markFailed(job, `No handler registered for job type "${job.type}"`);
      return;
    }
    try {
      // Correlates every log line the handler emits with this job's id — the worker's equivalent
      // of an HTTP request's requestId.
      await runWithRequestId(job.id, () => handler(job.payload));
      await this.markSucceeded(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`PostgresJobScheduler: job ${job.id} (type=${job.type}) failed:`, error);
      await this.markFailed(job, message);
    }
  }

  // Filters on (id, lockToken). A 0-row match means this worker's claim was superseded — logged,
  // not an error, and the write is safely skipped.
  private async markSucceeded(job: ClaimedJobRow): Promise<void> {
    try {
      const result = await this.prisma.job.updateMany({
        where: { id: job.id, lockToken: job.lockToken },
        data: { status: "SUCCEEDED" as never, lockedAt: null, lockedUntil: null, lockToken: null },
      });
      if (result.count === 0) {
        console.error(`PostgresJobScheduler: job ${job.id} succeeded but its claim was superseded — result not recorded`);
      }
    } catch (error) {
      console.error(`PostgresJobScheduler: failed to record success for job ${job.id}:`, error);
    }
  }

  // `job.attempts` already reflects this claim (incremented in claimBatch()), so exhaustion is
  // just a comparison here.
  private async markFailed(job: ClaimedJobRow, lastError: string): Promise<void> {
    const exhausted = job.attempts >= job.maxAttempts;
    try {
      const result = await this.prisma.job.updateMany({
        where: { id: job.id, lockToken: job.lockToken },
        data: {
          status: (exhausted ? "FAILED" : "PENDING") as never,
          lastError,
          lockedAt: null,
          lockedUntil: null,
          lockToken: null,
          ...(exhausted ? {} : { runAt: new Date(Date.now() + this.config.retryBackoffMs) }),
        },
      });
      if (result.count === 0) {
        console.error(`PostgresJobScheduler: job ${job.id} failed but its claim was superseded — outcome not recorded`);
      }
    } catch (error) {
      console.error(`PostgresJobScheduler: failed to record failure for job ${job.id}:`, error);
    }
  }
}
