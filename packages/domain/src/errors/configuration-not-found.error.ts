import type { ConfigScope } from "../value-objects/config-scope.js";

export class ConfigurationNotFoundError extends Error {
  constructor(
    public readonly key: string,
    public readonly scope: ConfigScope,
    public readonly scopeId: string,
  ) {
    super(`Configuration key "${key}" not found for scope ${scope}:${scopeId}`);
    this.name = "ConfigurationNotFoundError";
  }
}
