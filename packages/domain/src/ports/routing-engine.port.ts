import type { CanonicalRequest } from "../value-objects/canonical-request.js";
import type { CanonicalResponse } from "../value-objects/canonical-response.js";
import type { CanonicalStreamEvent } from "../value-objects/canonical-stream-event.js";
import type { RoutingPolicy } from "../value-objects/routing-policy.js";

// Takes an already-resolved RoutingPolicy; the route handler resolves it from tenant scope.
export interface RoutingEngine {
  route(request: CanonicalRequest, policy: RoutingPolicy): Promise<CanonicalResponse>;
  // Separate from route(): once a stream has yielded its first event, failover/retry are no
  // longer possible, so the resilience semantics differ — see DefaultRoutingEngine.routeStream().
  routeStream(
    request: CanonicalRequest,
    policy: RoutingPolicy,
    signal?: AbortSignal,
  ): AsyncIterable<CanonicalStreamEvent>;
}
