import type { CanonicalRequest } from "./canonical-request.js";
import type { RoutingPolicy } from "./routing-policy.js";
import type { TenantContext } from "./tenant-context.js";

// interactive (synchronous, low latency), high_priority (synchronous, preferential concurrency),
// batch (async, job handle + later result), background (async, lowest priority).
export type RequestClass = "interactive" | "high_priority" | "batch" | "background";

// Carries everything a worker needs to later run this request through the same routing ->
// resilience -> provider path a synchronous request would — not just enough to decide admission.
export interface ScheduledRequest {
  readonly requestClass: RequestClass;
  readonly tenant: TenantContext;
  readonly canonicalRequest: CanonicalRequest;
  readonly routingPolicy: RoutingPolicy;
}
