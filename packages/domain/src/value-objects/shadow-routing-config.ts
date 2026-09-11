import type { ProviderCandidate } from "./provider-candidate.js";

// Shadow traffic: mirrors a sampled percentage of live requests to a candidate asynchronously,
// to accumulate real HealthTracker signal before promoting it — the response is never returned.
export interface ShadowRoutingConfig {
  readonly candidate: ProviderCandidate;
  /** Fraction of requests to mirror, in [0, 1]. */
  readonly sampleRate: number;
}
