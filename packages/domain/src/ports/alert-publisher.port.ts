import type { DomainAlertEvent } from "../value-objects/domain-alert-event.js";

// Fire-and-forget-safe — publish() must never throw or reject: a circuit breaker opening or a
// budget hard-stop must never fail because alerting about it failed. Implemented by
// DefaultAlertPublisher.
export interface AlertPublisher {
  publish(event: DomainAlertEvent): Promise<void>;
}
