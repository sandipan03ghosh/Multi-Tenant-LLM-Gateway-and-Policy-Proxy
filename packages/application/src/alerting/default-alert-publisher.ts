import type { AlertPublisher, AlertChannel, DomainAlertEvent } from "@llm-gateway/domain";
import { logger, domainAlertsTotal } from "@llm-gateway/adapters-observability";

// Fire-and-forget-safe: publish() never throws — a failure to increment the metric or deliver to
// a channel is logged and swallowed, never propagated into the call site that triggered the alert.
export class DefaultAlertPublisher implements AlertPublisher {
  constructor(private readonly channels: readonly AlertChannel[]) {}

  async publish(event: DomainAlertEvent): Promise<void> {
    try {
      domainAlertsTotal.inc({ type: event.type, severity: event.severity });
    } catch (error) {
      logger.error({ err: error, "alert.type": event.type }, "DefaultAlertPublisher: failed to increment domain_alerts_total");
    }

    await Promise.all(
      this.channels.map(async (channel) => {
        try {
          await channel.send(event);
        } catch (error) {
          logger.error({ err: error, "alert.type": event.type }, "DefaultAlertPublisher: channel.send() failed");
        }
      }),
    );
  }
}
