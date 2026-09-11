import type { ProviderScorer, ProviderCandidate, RankedCandidate } from "@llm-gateway/domain";

// No-op scorer: assigns candidates their input order as score, no real signal. Fallback for
// HealthAwareProviderScorer.
export class PassthroughProviderScorer implements ProviderScorer {
  async score(candidates: readonly ProviderCandidate[]): Promise<RankedCandidate[]> {
    return candidates.map((candidate, index) => ({
      ...candidate,
      score: candidates.length - index,
    }));
  }
}
