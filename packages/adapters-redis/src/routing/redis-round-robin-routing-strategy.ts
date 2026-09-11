import type { Redis } from "ioredis";
import { DomainValidationError } from "@llm-gateway/domain";
import type { RoutingStrategy, ProviderCandidate, CanonicalRequest, RoutingPolicy } from "@llm-gateway/domain";

// Cross-instance-consistent round robin (Redis key `rr:{cursorKey}`). A plain INCR is sufficient
// — atomic on its own, and every caller just wants "the next distinct index".
export class RedisRoundRobinRoutingStrategy implements RoutingStrategy {
  constructor(private readonly redis: Redis) {}

  async selectCandidates(
    _request: CanonicalRequest,
    policy: RoutingPolicy,
  ): Promise<ProviderCandidate[]> {
    if (policy.type !== "round_robin") {
      throw new DomainValidationError("RedisRoundRobinRoutingStrategy", "policy.type", `expected "round_robin", got "${policy.type}"`);
    }
    const { candidates, cursorKey } = policy;
    if (cursorKey.trim().length === 0) {
      // An empty/whitespace-only cursorKey would collide with every other empty-key rotation
      // rather than identifying a specific one.
      throw new DomainValidationError("RoundRobinRoutingPolicy", "cursorKey", "must be non-empty and not whitespace-only");
    }
    if (candidates.length === 0) {
      throw new DomainValidationError("RoundRobinRoutingPolicy", "candidates", "must be non-empty");
    }

    const cursor = await this.redis.incr(this.keyFor(cursorKey));
    // `% candidates.length` maps every value INCR can return to a valid index — sign/overflow
    // don't affect correctness.
    const offset = ((cursor - 1) % candidates.length + candidates.length) % candidates.length;

    // Rotate so the selected candidate is first, the rest follow as the failover sequence.
    return [...candidates.slice(offset), ...candidates.slice(0, offset)];
  }

  private keyFor(cursorKey: string): string {
    return `rr:${cursorKey}`;
  }
}
