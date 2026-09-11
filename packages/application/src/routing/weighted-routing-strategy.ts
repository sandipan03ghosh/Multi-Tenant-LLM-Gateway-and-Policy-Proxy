import { DomainValidationError } from "@llm-gateway/domain";
import type { RoutingStrategy, ProviderCandidate, CanonicalRequest, RoutingPolicy, WeightedCandidate } from "@llm-gateway/domain";

// Pure per-request weighted-random selection — no cross-instance coordination needed (unlike
// RoundRobin/Sticky): each instance drawing from the same weights converges to the configured
// proportions statistically.
export class WeightedRoutingStrategy implements RoutingStrategy {
  async selectCandidates(
    _request: CanonicalRequest,
    policy: RoutingPolicy,
  ): Promise<ProviderCandidate[]> {
    if (policy.type !== "weighted") {
      throw new DomainValidationError("WeightedRoutingStrategy", "policy.type", `expected "weighted", got "${policy.type}"`);
    }
    const { candidates } = policy;
    if (candidates.length === 0) {
      throw new DomainValidationError("WeightedRoutingPolicy", "candidates", "must be non-empty");
    }
    for (const candidate of candidates) {
      // Reject non-finite/zero/negative — a non-finite weight corrupts totalWeight and breaks
      // every draw, and zero/negative aren't valid shares.
      if (!Number.isFinite(candidate.weight) || candidate.weight <= 0) {
        throw new DomainValidationError(
          "WeightedRoutingPolicy",
          "candidates[].weight",
          `must be a finite number > 0, got ${candidate.weight} for ${candidate.providerId}/${candidate.modelId}`,
        );
      }
    }

    const chosen = this.drawWeighted(candidates);
    // Chosen first (the primary attempt), the rest by descending weight as the fallback sequence.
    const rest = candidates
      .filter((candidate) => candidate !== chosen)
      .sort((a, b) => b.weight - a.weight);
    return [chosen, ...rest];
  }

  private drawWeighted(candidates: readonly WeightedCandidate[]): WeightedCandidate {
    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let draw = Math.random() * totalWeight;
    for (const candidate of candidates) {
      draw -= candidate.weight;
      if (draw < 0) {
        return candidate;
      }
    }
    // Floating-point rounding can leave `draw` fractionally >= 0 — fall back to the last candidate.
    return candidates[candidates.length - 1] as WeightedCandidate;
  }
}
