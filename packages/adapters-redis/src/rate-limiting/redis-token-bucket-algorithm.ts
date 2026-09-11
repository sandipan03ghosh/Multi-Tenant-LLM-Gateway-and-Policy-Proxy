import type { Redis } from "ioredis";
import type { RateLimitAlgorithm, RateLimitPolicy, RateLimitResult } from "@llm-gateway/domain";

// Bounded retry count for the WATCH/MULTI/EXEC transaction below — an optimistic-locking abort
// under contention is the expected outcome; each retry re-reads fresh bucket state.
const MAX_OPTIMISTIC_RETRIES = 5;

// Lazy-refill token bucket — one Redis hash per key holding {tokens, lastRefillAt}, refilled on
// read rather than by a background timer, so an idle bucket costs nothing.
//
// WATCH/MULTI/EXEC, not a Lua script (same as the other Redis adapters here). Read-modify-write
// is still atomic: EXEC fails and the loop retries if the key changed between WATCH and EXEC.
// Every call runs on its own duplicated connection since WATCH/MULTI/EXEC state is
// connection-scoped.
export class RedisTokenBucketAlgorithm implements RateLimitAlgorithm {
  constructor(private readonly redis: Redis) {}

  async checkAndConsume(key: string, cost: number, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(redisKey);
        const [tokensRaw, lastRefillAtRaw] = await tx.hmget(redisKey, "tokens", "lastRefillAt");

        const now = Date.now();
        let tokens = tokensRaw !== null ? Number(tokensRaw) : policy.capacity;
        let lastRefillAt = lastRefillAtRaw !== null ? Number(lastRefillAtRaw) : now;

        const elapsedMs = now - lastRefillAt;
        if (elapsedMs > 0) {
          const intervalsElapsed = Math.floor(elapsedMs / policy.refillIntervalMs);
          if (intervalsElapsed > 0) {
            tokens = Math.min(policy.capacity, tokens + intervalsElapsed * policy.refillTokens);
            lastRefillAt += intervalsElapsed * policy.refillIntervalMs;
          }
        }

        const allowed = tokens >= cost;
        const tokensAfter = allowed ? tokens - cost : tokens;

        const execResult = await tx
          .multi()
          .hset(redisKey, "tokens", String(tokensAfter), "lastRefillAt", String(lastRefillAt))
          .pexpire(redisKey, this.idleTtlMs(policy))
          .exec();

        if (execResult === null) {
          // Bucket changed concurrently between WATCH and EXEC — retry with a fresh read.
          await tx.unwatch();
          continue;
        }

        if (allowed) {
          return { allowed: true, remaining: tokensAfter };
        }
        return { allowed: false, remaining: tokens, retryAfterMs: this.retryAfterMs(tokens, cost, policy) };
      }

      // Exhausted retries under contention — fail closed rather than guess at an uncommitted result.
      return { allowed: false, remaining: 0, retryAfterMs: policy.refillIntervalMs };
    } finally {
      tx.disconnect();
    }
  }

  private retryAfterMs(currentTokens: number, cost: number, policy: RateLimitPolicy): number {
    if (policy.refillTokens <= 0) {
      // A zero refill rate means this bucket never recovers on its own.
      return policy.refillIntervalMs;
    }
    const deficit = cost - currentTokens;
    return Math.ceil(deficit / policy.refillTokens) * policy.refillIntervalMs;
  }

  // "Time to fully refill from empty," doubled for margin — long enough that a mid-use bucket
  // doesn't expire out from under an active tenant, short enough that an abandoned one doesn't linger.
  private idleTtlMs(policy: RateLimitPolicy): number {
    if (policy.refillTokens <= 0) {
      return policy.refillIntervalMs * 2;
    }
    const refillsToFull = Math.ceil(policy.capacity / policy.refillTokens);
    return Math.max(policy.refillIntervalMs * 2, refillsToFull * policy.refillIntervalMs * 2);
  }
}
