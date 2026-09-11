import { toConfigKey } from "@llm-gateway/domain";
import type { ConfigKey } from "@llm-gateway/domain";

// Global (not tenant-scoped) — provider availability is an operator-wide concern. One key per
// provider ("provider.{id}.enabled") rather than a single JSON map, so InMemoryProviderRegistry
// can subscribe() to exactly the providers it was constructed with.
export function providerEnabledConfigKey(providerId: string): ConfigKey {
  return toConfigKey(`provider.${providerId}.enabled`);
}
