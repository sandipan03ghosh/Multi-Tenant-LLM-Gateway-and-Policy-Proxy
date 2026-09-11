import type { CanonicalRequest } from "../value-objects/canonical-request.js";
import type { ProviderCandidate } from "../value-objects/provider-candidate.js";
import type { RoutingPolicy } from "../value-objects/routing-policy.js";

// Implemented once per strategy (manual, round-robin, weighted, health-aware, sticky) — the
// candidate-selection stage of the routing pipeline.
export interface RoutingStrategy {
  selectCandidates(request: CanonicalRequest, policy: RoutingPolicy): Promise<ProviderCandidate[]>;
}
