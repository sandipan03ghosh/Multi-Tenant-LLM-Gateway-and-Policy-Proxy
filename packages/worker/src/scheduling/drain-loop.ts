import type { RedisRequestScheduler } from "@llm-gateway/adapters-redis";
import type { PostgresJobScheduler, PrismaBatchRequestRepository } from "@llm-gateway/adapters-postgres";

export interface DrainLoopConfig {
  readonly intervalMs?: number;
  readonly batchSize?: number;
}

const DEFAULT_CONFIG: Required<DrainLoopConfig> = {
  intervalMs: 2_000,
  batchSize: 10,
};

// Periodically pops batch/background work off RedisRequestScheduler and hands each item to
// JobScheduler as a process_scheduled_request job; execution (lease/retry/attempts) happens
// there. webhookUrl is read from the BatchRequest row here and folded into the payload so
// delivery scheduling doesn't depend on that row later. A hand-off failure after the item is
// popped requeues it under its original ticketId — this can double-schedule an item, which is
// safe: process_scheduled_request is idempotent per batchId.
export class DrainLoop {
  private readonly config: Required<DrainLoopConfig>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  constructor(
    private readonly requestScheduler: RedisRequestScheduler,
    private readonly jobScheduler: PostgresJobScheduler,
    private readonly batchRequestRepository: PrismaBatchRequestRepository,
    config: DrainLoopConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.stopped = false;
    this.scheduleNext(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNext(this.config.intervalMs));
    }, delayMs);
  }
 
  private async tick(): Promise<void> {
    let dequeued;
    try {
      dequeued = await this.requestScheduler.dequeueNext({ maxJobs: this.config.batchSize });
    } catch (error) {
      console.error("DrainLoop: failed to dequeue scheduled requests (will retry next tick):", error);
      return;
    }

    for (const { ticket, request } of dequeued) {
      await this.scheduleProcessing(ticket.ticketId, request);
    }
  }

  private async scheduleProcessing(batchId: string, request: Parameters<RedisRequestScheduler["requeue"]>[1]): Promise<void> {
    let webhookUrl: string | null = null;
    try {
      const record = await this.batchRequestRepository.findByIdUnscoped(batchId);
      webhookUrl = record?.webhookUrl ?? null;
    } catch (error) {
      // Not fatal — proceed without a webhook rather than lose the request entirely.
      console.error(`DrainLoop: failed to look up batch ${batchId} for webhookUrl (proceeding without one):`, error);
    }

    try {
      await this.jobScheduler.enqueue({
        type: "process_scheduled_request",
        payload: { batchId, webhookUrl, scheduledRequest: request },
      });
    } catch (error) {
      console.error(`DrainLoop: failed to enqueue processing for batch ${batchId} — requeuing it in Redis:`, error);
      try {
        await this.requestScheduler.requeue({ ticketId: batchId }, request);
      } catch (requeueError) {
        // Hand-off and recovery both failed — the item is now genuinely lost from tracking
        // (stays "pending" in Postgres).
        console.error(`DrainLoop: failed to requeue batch ${batchId} after a failed enqueue — it is now lost from the queue:`, requeueError);
      }
    }
  }
}
