import type { ProviderScorer, ProviderCandidate, RankedCandidate, HealthTracker } from "@llm-gateway/domain";

// Ranks every candidate by its rolling health score, regardless of which strategy selected it.
// The single scorer for all strategies.
export class HealthAwareProviderScorer implements ProviderScorer {
  constructor(private readonly healthTracker: HealthTracker) {}

  async score(candidates: readonly ProviderCandidate[]): Promise<RankedCandidate[]> {
    return Promise.all(
      candidates.map(async (candidate) => ({
        ...candidate,
        score: await this.healthTracker.getScore(candidate.providerId),
      })),
    );
  }
}
