import type { ProviderCandidate, RankedCandidate } from "../value-objects/provider-candidate.js";

// The ranking stage of the routing pipeline. HealthAwareProviderScorer ranks on live health
// signal; PassthroughProviderScorer is a no-op fallback.
export interface ProviderScorer {
  score(candidates: readonly ProviderCandidate[]): Promise<RankedCandidate[]>;
}
