import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { DomainValidationError } from "@llm-gateway/domain";
import type {
  RequestScheduler,
  RequestClass,
  ScheduledRequest,
  AdmissionDecision,
  QueueTicket,
  SchedulingCapacity,
  DequeuedRequest,
} from "@llm-gateway/domain";

export interface RedisRequestSchedulerConfig {
  readonly interactiveLimit?: number;
  readonly highPriorityLimit?: number;
}

const DEFAULT_CONFIG: Required<RedisRequestSchedulerConfig> = {
  interactiveLimit: 100,
  highPriorityLimit: 50,
};

interface QueuedEnvelope {
  readonly ticketId: string;
  readonly request: ScheduledRequest;
}

// Interactive/high-priority: concurrency-aware inline admission via a plain INCR/DECR counter
// (`inflight:{provider}:{class}` / `inflight:class:{class}` — see inflightKey()).
// Batch/background: Redis sorted-set priority queues (`queue:{class}`), one per class, ordered by
// a strictly monotonic per-class sequence.
//
// No key TTL on the concurrency counters: a TTL could expire a key back to 0 while requests are
// still in flight (over-admission), which is a worse failure mode than a crash between admit()
// and release() leaking one reservation (under-admission). Rejecting a little extra traffic is
// safer than exceeding configured concurrency — a known, accepted limitation.
//
// Only the "manual" routing policy has a known providerId at admission time; any other policy
// falls back to a class-level counter.
export class RedisRequestScheduler implements RequestScheduler {
  private readonly config: Required<RedisRequestSchedulerConfig>;

  constructor(
    private readonly redis: Redis,
    config: RedisRequestSchedulerConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async admit(request: ScheduledRequest): Promise<AdmissionDecision> {
    if (request.requestClass === "batch" || request.requestClass === "background") {
      return { outcome: "queue" };
    }

    const key = this.inflightKey(request);
    const limit = request.requestClass === "high_priority" ? this.config.highPriorityLimit : this.config.interactiveLimit;
    const current = await this.redis.incr(key);
    if (current > limit) {
      // Release the failed reservation rather than leave the counter holding a slot for a request
      // that was never admitted. INCR/DECR are each atomic, so concurrent callers don't corrupt
      // each other's accounting. The corrective DECR is guarded so its failure can't turn a valid
      // reject into a thrown error.
      try {
        await this.redis.decr(key);
      } catch (error) {
        console.error(`RedisRequestScheduler: corrective decrement of ${key} failed after an over-capacity admit() — the slot may be leaked:`, error);
      }
      return {
        outcome: "reject",
        code: "CAPACITY_EXCEEDED",
        reason: `No available concurrency slot for ${request.requestClass} traffic`,
      };
    }
    return { outcome: "admit_inline" };
  }

  async release(request: ScheduledRequest): Promise<void> {
    if (request.requestClass === "batch" || request.requestClass === "background") {
      // Never admitted inline — nothing to release.
      return;
    }
    const key = this.inflightKey(request);
    const current = await this.redis.decr(key);
    if (current < 0) {
      // Defensive clamp against misuse (double release, or release for a rejected request).
      // Guarded so a failure here doesn't throw out of a caller's try/finally.
      try {
        await this.redis.incr(key);
      } catch (error) {
        console.error(`RedisRequestScheduler: corrective increment of ${key} failed after release() drove it negative:`, error);
      }
      console.error(`RedisRequestScheduler: release() drove ${key} negative (clamp attempted) — check for an unmatched admit()/release() pair`);
    }
  }

  async enqueue(request: ScheduledRequest): Promise<QueueTicket> {
    const ticketId = randomUUID();
    await this.insertIntoQueue(ticketId, request);
    return { ticketId };
  }

  // Re-inserts a previously-dequeued {ticket, request} pair under its *original* ticketId — used
  // by the drain loop to recover an item popped via dequeueNext() that then failed hand-off. The
  // caller supplies the ticketId (not a new one) since the item may correlate to a client-visible
  // tracking record keyed by its original id. A double-queued item is safe: process_scheduled_request
  // is idempotent per batchId.
  async requeue(ticket: QueueTicket, request: ScheduledRequest): Promise<void> {
    await this.insertIntoQueue(ticket.ticketId, request);
  }

  // Scored by a strictly monotonic per-class sequence alone (a globally-atomic Redis INCR), not a
  // timestamp — a pure counter has no wraparound within any realistic volume, so strict FIFO holds.
  private async insertIntoQueue(ticketId: string, request: ScheduledRequest): Promise<void> {
    if (request.requestClass !== "batch" && request.requestClass !== "background") {
      throw new DomainValidationError(
        "RedisRequestScheduler",
        "requestClass",
        `only "batch" or "background" requests can be queued, got "${request.requestClass}"`,
      );
    }
    const envelope: QueuedEnvelope = { ticketId, request };
    const score = await this.redis.incr(this.sequenceKey(request.requestClass));
    await this.redis.zadd(this.queueKey(request.requestClass), score, JSON.stringify(envelope));
  }

  // Strict priority: drains `queue:batch` before `queue:background`. Returns the ticket alongside
  // each request so the batch worker can correlate dequeued work to its tracking record.
  async dequeueNext(capacity: SchedulingCapacity): Promise<DequeuedRequest[]> {
    const results: DequeuedRequest[] = [];
    for (const requestClass of ["batch", "background"] as const) {
      if (results.length >= capacity.maxJobs) {
        break;
      }
      const remaining = capacity.maxJobs - results.length;
      const popped = await this.redis.zpopmin(this.queueKey(requestClass), remaining);
      // ioredis returns a flat [member, score, member, score, ...] array.
      for (let i = 0; i < popped.length; i += 2) {
        const member = popped[i];
        if (member === undefined) {
          continue;
        }
        try {
          const envelope = JSON.parse(member) as QueuedEnvelope;
          results.push({ ticket: { ticketId: envelope.ticketId }, request: envelope.request });
        } catch (error) {
          // ZPOPMIN already removed this member — it's unrecoverable through the queue. Logged in
          // full so an operator can still recover/inspect it.
          console.error(`RedisRequestScheduler: failed to parse a queued member from queue:${requestClass} — raw content follows:`, member, error);
        }
      }
    }
    return results;
  }

  // "manual" policy: `inflight:{providerId}:{class}`. Any other policy: `inflight:class:{class}`
  // — no provider is known at admission time.
  private inflightKey(request: ScheduledRequest): string {
    if (request.routingPolicy.type === "manual") {
      return `inflight:${request.routingPolicy.providerId}:${request.requestClass}`;
    }
    return `inflight:class:${request.requestClass}`;
  }

  // For the scheduler_queue_depth metrics gauge — only "batch" and "background" are ever queued.
  async getQueueDepths(): Promise<{ batch: number; background: number }> {
    const [batch, background] = await Promise.all([
      this.redis.zcard(this.queueKey("batch")),
      this.redis.zcard(this.queueKey("background")),
    ]);
    return { batch, background };
  }

  private queueKey(requestClass: RequestClass): string {
    return `queue:${requestClass}`;
  }

  private sequenceKey(requestClass: RequestClass): string {
    return `queue:${requestClass}:seq`;
  }
}
