import type { ConfigScope } from "../value-objects/config-scope.js";
import type { ConfigKey } from "../value-objects/config-key.js";

export interface ConfigurationRecord {
  readonly scope: ConfigScope;
  readonly scopeId: string;
  readonly key: ConfigKey;
  readonly value: unknown;
}

// Implemented by adapters-postgres. The durable source of truth for configuration.
export interface ConfigurationRepository {
  find(scope: ConfigScope, scopeId: string, key: ConfigKey): Promise<ConfigurationRecord | null>;
  upsert(scope: ConfigScope, scopeId: string, key: ConfigKey, value: unknown): Promise<void>;
  listByScope(scope: ConfigScope, scopeId: string): Promise<ConfigurationRecord[]>;
}
