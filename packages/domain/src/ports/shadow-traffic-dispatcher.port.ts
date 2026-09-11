import type { CanonicalRequest } from "../value-objects/canonical-request.js";
import type { ShadowRoutingConfig } from "../value-objects/shadow-routing-config.js";

// `dispatch()` returns void, not Promise<void>, so a caller can't await it and block the primary
// request. It must never throw synchronously or produce an unhandled rejection — a shadow-traffic
// failure is a log line, never a client-visible effect.
export interface ShadowTrafficDispatcher {
  dispatch(request: CanonicalRequest, shadow: ShadowRoutingConfig): void;
}
