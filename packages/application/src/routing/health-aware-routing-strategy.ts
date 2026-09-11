import { DomainValidationError } from "@llm-gateway/domain";
import type { RoutingStrategy, ProviderCandidate, CanonicalRequest, RoutingPolicy } from "@llm-gateway/domain";

// Candidate eligibility only — the health-based ranking is HealthAwareProviderScorer's job
// (Strategy selects, Scorer ranks), so the ranking signal can change without touching selection.
export class HealthAwareRoutingStrategy implements RoutingStrategy {
  async selectCandidates(
    _request: CanonicalRequest,
    policy: RoutingPolicy,
  ): Promise<ProviderCandidate[]> {
    if (policy.type !== "health_aware") {
      throw new DomainValidationError("HealthAwareRoutingStrategy", "policy.type", `expected "health_aware", got "${policy.type}"`);
    }
    if (policy.candidates.length === 0) {
      throw new DomainValidationError("HealthAwareRoutingPolicy", "candidates", "must be non-empty");
    }
    return [...policy.candidates];
  }
}
