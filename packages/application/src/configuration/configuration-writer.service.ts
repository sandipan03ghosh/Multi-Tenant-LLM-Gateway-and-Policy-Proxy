import type {
  ConfigurationRepository,
  ConfigurationWriter,
  PubSub,
  ConfigScope,
  ConfigKey,
} from "@llm-gateway/domain";
import { CONFIG_INVALIDATION_CHANNEL, encodeInvalidationMessage } from "./configuration-cache-keys.js";

// Write-side counterpart to PostgresConfigurationService. Every write goes through the
// repository first, then publishes an invalidation message so every ConfigurationService
// instance evicts its cache and re-reads on next access.
export class ConfigurationWriterService implements ConfigurationWriter {
  constructor(
    private readonly repository: ConfigurationRepository,
    private readonly pubSub: PubSub,
  ) {}

  async set(scope: ConfigScope, scopeId: string, key: ConfigKey, value: unknown): Promise<void> {
    await this.repository.upsert(scope, scopeId, key, value);
    await this.pubSub.publish(
      CONFIG_INVALIDATION_CHANNEL,
      encodeInvalidationMessage({ scope, scopeId, key }),
    );
  }
}
