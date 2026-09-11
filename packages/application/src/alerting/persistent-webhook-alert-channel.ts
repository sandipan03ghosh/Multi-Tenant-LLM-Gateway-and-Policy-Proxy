import type { AlertChannel, AlertChannelConfigRepository, DomainAlertEvent, JobEnqueuer } from "@llm-gateway/domain";

// Fans a single alert event out to every enabled AlertChannelConfig row (operator-managed via
// the Admin API), reusing the existing deliver_webhook job type for actual delivery.
//
// One row's enqueue failure must not block delivery to the others — each is caught and logged
// individually rather than letting Promise.all reject as a whole.
export class PersistentWebhookAlertChannel implements AlertChannel {
  constructor(
    private readonly alertChannelConfigRepository: AlertChannelConfigRepository,
    private readonly jobEnqueuer: JobEnqueuer,
  ) {}

  async send(event: DomainAlertEvent): Promise<void> {
    const configs = await this.alertChannelConfigRepository.listEnabled();
    await Promise.all(
      configs.map(async (config) => {
        try {
          await this.jobEnqueuer.enqueue({
            type: "deliver_webhook",
            payload: { url: config.url, body: event },
          });
        } catch (error) {
          console.error(`PersistentWebhookAlertChannel: failed to enqueue delivery for channel "${config.name}" (${config.id}):`, error);
        }
      }),
    );
  }
}
