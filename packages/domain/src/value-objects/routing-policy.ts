import type { ProviderCandidate, WeightedCandidate } from "./provider-candidate.js";
import type { ShadowRoutingConfig } from "./shadow-routing-config.js";

// Every RoutingPolicy variant can optionally carry a shadow traffic config — a mirrored,
// sampled, best-effort call to a not-yet-trusted candidate, discarded and never returned.
interface RoutingPolicyBase {
  readonly shadow?: ShadowRoutingConfig;
}

// The policy names an explicit provider; the model comes from the client's request.
export interface ManualRoutingPolicy extends RoutingPolicyBase {
  readonly type: "manual";
  readonly providerId: string;
}

// `cursorKey` is the caller-assigned identity of the rotation itself (e.g. a route or org/project
// scope), shared consistently across instances and requests (Redis key `rr:{cursorKey}`).
export interface RoundRobinRoutingPolicy extends RoutingPolicyBase {
  readonly type: "round_robin";
  readonly cursorKey: string;
  readonly candidates: readonly ProviderCandidate[];
}

export interface WeightedRoutingPolicy extends RoutingPolicyBase {
  readonly type: "weighted";
  readonly candidates: readonly WeightedCandidate[];
}

// Candidate eligibility only — ranking is delegated to a health-aware ProviderScorer (Strategy
// selects, Scorer ranks).
export interface HealthAwareRoutingPolicy extends RoutingPolicyBase {
  readonly type: "health_aware";
  readonly candidates: readonly ProviderCandidate[];
}

// `sessionKey` identifies the session pinned to a single candidate across requests (Redis key
// `sticky:{sessionKey}`). `pinTtlMs` optionally overrides the strategy's default pin TTL.
export interface StickyRoutingPolicy extends RoutingPolicyBase {
  readonly type: "sticky";
  readonly sessionKey: string;
  readonly candidates: readonly ProviderCandidate[];
  readonly pinTtlMs?: number;
}

export type RoutingPolicy =
  | ManualRoutingPolicy
  | RoundRobinRoutingPolicy
  | WeightedRoutingPolicy
  | HealthAwareRoutingPolicy
  | StickyRoutingPolicy;
