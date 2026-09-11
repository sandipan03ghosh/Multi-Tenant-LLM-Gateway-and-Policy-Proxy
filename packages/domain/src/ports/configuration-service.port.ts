import type { ConfigKey } from "../value-objects/config-key.js";
import type { TenantScope } from "../value-objects/config-scope.js";

export type ConfigChangeHandler = (value: unknown) => void;
export type ConfigSubscriptionUnsubscribe = () => void;

// The single authoritative read path for all dynamic configuration — no subsystem queries
// configuration storage directly. get() resolves a GLOBAL value; getWithFallback() resolves the
// chain project -> organization -> global.
export interface ConfigurationService {
  get<T>(key: ConfigKey): Promise<T>;
  getWithFallback<T>(key: ConfigKey, scope: TenantScope): Promise<T>;
  subscribe(key: ConfigKey, handler: ConfigChangeHandler): ConfigSubscriptionUnsubscribe;
}
