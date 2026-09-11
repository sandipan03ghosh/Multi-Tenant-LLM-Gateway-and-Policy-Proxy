import type { ConfigScope } from "../value-objects/config-scope.js";
import type { ConfigKey } from "../value-objects/config-key.js";

// Companion write-side port, separate from the read-only ConfigurationService. Admin API
// use-cases call this to change policy; every write publishes a cache-invalidation signal so
// readers on every instance pick it up without a restart.
export interface ConfigurationWriter {
  set(scope: ConfigScope, scopeId: string, key: ConfigKey, value: unknown): Promise<void>;
}
