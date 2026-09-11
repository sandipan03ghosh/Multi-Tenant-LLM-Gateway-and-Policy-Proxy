import type { Redis } from "ioredis";
import { BudgetCounterNotFoundError } from "@llm-gateway/domain";
import type { BudgetCounterStore } from "@llm-gateway/domain";

// Bounded retry count for both reserve() and adjust()'s WATCH/MULTI/EXEC transactions.
const MAX_OPTIMISTIC_RETRIES = 5;

// Redis fast-path for Budget Enforcement — the Postgres ledger/reconciliation is the source of
// truth; this class holds an approximate, periodically-corrected "remaining budget" figure.
//
// Both reserve() and adjust() use WATCH/MULTI/EXEC (own connection per call, bounded retries)
// rather than a plain DECRBY:
//  - reserve() checks `current >= reservationMicros` before writing anything — a failed check
//    never mutates the key, so there's no wrong value visible to a concurrent reserve() and
//    nothing to refund.
//  - adjust() GETs first and throws BudgetCounterNotFoundError if the key is absent, rather than
//    letting a bare DECRBY auto-vivify a key from 0 and invent budget state.
export class RedisBudgetCounterStore implements BudgetCounterStore {
  constructor(private readonly redis: Redis) {}

  async reserve(
    key: string,
    reservationMicros: number,
    limitMicros: number,
    ttlMs: number,
  ): Promise<{ allowed: boolean; remainingMicros: number }> {
    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(key);
        const raw = await tx.get(key);
        const current = raw !== null ? Number(raw) : limitMicros;

        if (current < reservationMicros) {
          await tx.unwatch();
          return { allowed: false, remainingMicros: current };
        }

        const remaining = current - reservationMicros;
        const execResult = await tx.multi().set(key, String(remaining), "PX", ttlMs).exec();
        if (execResult === null) {
          // Counter changed concurrently between WATCH and EXEC — retry with a fresh read.
          continue;
        }
        return { allowed: true, remainingMicros: remaining };
      }
      // Exhausted retries under contention — fail closed rather than guess at an uncommitted result.
      return { allowed: false, remainingMicros: 0 };
    } finally {
      tx.disconnect();
    }
  }

  async adjust(key: string, deltaMicros: number, ttlMs: number): Promise<number> {
    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(key);
        const raw = await tx.get(key);
        if (raw === null) {
          await tx.unwatch();
          throw new BudgetCounterNotFoundError(key);
        }

        const remaining = Number(raw) - deltaMicros;
        const execResult = await tx.multi().set(key, String(remaining), "PX", ttlMs).exec();
        if (execResult === null) {
          // Concurrent write between WATCH and EXEC — retry with a fresh read.
          continue;
        }
        return remaining;
      }
      // Exhausted retries under contention — refuse rather than apply a delta against unverified state.
      throw new BudgetCounterNotFoundError(key);
    } finally {
      tx.disconnect();
    }
  }

  async reconcile(key: string, remainingMicros: number, ttlMs: number): Promise<void> {
    await this.redis.set(key, String(remainingMicros), "PX", ttlMs);
  }

  async tryArmOnce(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, "1", "PX", ttlMs, "NX");
    return result === "OK";
  }
}
