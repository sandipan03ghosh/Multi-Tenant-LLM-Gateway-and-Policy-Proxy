import type { DomainAlertEvent } from "../value-objects/domain-alert-event.js";

// One concrete delivery mechanism for a DomainAlertEvent (e.g. PersistentWebhookAlertChannel).
// DefaultAlertPublisher fans a single publish() call out to every configured channel.
export interface AlertChannel {
  send(event: DomainAlertEvent): Promise<void>;
}
