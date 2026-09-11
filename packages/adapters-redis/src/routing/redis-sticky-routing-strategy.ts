import type { Redis } from "ioredis";
import { DomainValidationError } from "@llm-gateway/domain";
import type { RoutingStrategy, ProviderCandidate, CanonicalRequest, RoutingPolicy } from "@llm-gateway/domain";

export interface RedisStickyRoutingStrategyConfig {
  /** Used when a StickyRoutingPolicy doesn't specify its own pinTtlMs. */
  readonly defaultPinTtlMs?: number;
}

const DEFAULT_CONFIG: Required<RedisStickyRoutingStrategyConfig> = {
  defaultPinTtlMs: 30 * 60 * 1000,
};

// Bounded retry count for the WATCH/MULTI/EXEC transaction below.
const MAX_OPTIMISTIC_RETRIES = 5;

// Sticky-session provider pinning (Redis key `sticky:{sessionKey}`).
//
// Every path — refreshing a valid pin's TTL, claiming an absent pin, replacing a stale one —
// goes through the same WATCH/MULTI/EXEC compare-and-set: if the key changed between the read
// and the EXEC, the loop retries with a fresh read, so a losing attempt never clobbers a
// concurrent winner. Runs on its own duplicated connection per call since WATCH is connection-scoped.
export class RedisStickyRoutingStrategy implements RoutingStrategy {
  private readonly config: Required<RedisStickyRoutingStrategyConfig>;

  constructor(
    private readonly redis: Redis,
    config: RedisStickyRoutingStrategyConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async selectCandidates(
    _request: CanonicalRequest,
    policy: RoutingPolicy,
  ): Promise<ProviderCandidate[]> {
    if (policy.type !== "sticky") {
      throw new DomainValidationError("RedisStickyRoutingStrategy", "policy.type", `expected "sticky", got "${policy.type}"`);
    }
    const { candidates, sessionKey } = policy;
    if (sessionKey.trim().length === 0) {
      throw new DomainValidationError("StickyRoutingPolicy", "sessionKey", "must be non-empty and not whitespace-only");
    }
    if (candidates.length === 0) {
      throw new DomainValidationError("StickyRoutingPolicy", "candidates", "must be non-empty");
    }
    const ttlMs = policy.pinTtlMs ?? this.config.defaultPinTtlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new DomainValidationError("StickyRoutingPolicy", "pinTtlMs", `must be a finite number > 0, got ${ttlMs}`);
    }

    const key = this.keyFor(sessionKey);
    const fallback = candidates[0] as ProviderCandidate;

    const tx = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        await tx.watch(key);
        const currentValue = await tx.get(key);
        const match = currentValue !== null ? candidates.find((c) => this.encode(c) === currentValue) : undefined;

        if (match) {
          // Valid pin — atomically refresh its TTL (sliding expiration). An abort here retries
          // from scratch rather than refreshing a pin that's no longer current.
          const result = await tx.multi().pexpire(key, ttlMs).exec();
          if (result === null) {
            continue;
          }
          return this.rotateToFront(candidates, match);
        }

        // No pin, or a stale pin matching no current candidate — claim/replace it with
        // `fallback`, only if the key is unchanged at EXEC time (WATCH's compare-and-set).
        const result = await tx.multi().set(key, this.encode(fallback), "PX", ttlMs).exec();
        if (result === null) {
          continue;
        }
        return this.rotateToFront(candidates, fallback);
      }
      // Exhausted retries under contention — proceed without persisting a pin; the next request
      // gets a fresh attempt.
      return this.rotateToFront(candidates, fallback);
    } finally {
      tx.disconnect();
    }
  }

  private rotateToFront(
    candidates: readonly ProviderCandidate[],
    chosen: ProviderCandidate,
  ): ProviderCandidate[] {
    return [chosen, ...candidates.filter((candidate) => candidate !== chosen)];
  }

  private encode(candidate: ProviderCandidate): string {
    return `${candidate.providerId}::${candidate.modelId}`;
  }

  private keyFor(sessionKey: string): string {
    return `sticky:${sessionKey}`;
  }
}
