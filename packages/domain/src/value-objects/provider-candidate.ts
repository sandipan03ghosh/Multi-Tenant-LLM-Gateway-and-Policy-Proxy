export interface ProviderCandidate {
  readonly providerId: string;
  readonly modelId: string;
}

export interface RankedCandidate extends ProviderCandidate {
  readonly score: number;
}

// A candidate's relative share of a weighted-random selection. Must be > 0 — a zero/negative
// weight is a construction-time DomainValidationError, not a silently-never-selected candidate.
export interface WeightedCandidate extends ProviderCandidate {
  readonly weight: number;
}
