// Branded string type so a raw string can't be passed where a validated ConfigKey is expected
// without going through toConfigKey() first.
declare const configKeyBrand: unique symbol;

export type ConfigKey = string & { readonly [configKeyBrand]: true };

// Lowercase, dot/hyphen-namespaced keys only (e.g. "routing.policy", "rate-limit.policy").
// Keeps keys predictable across Postgres rows, Redis cache keys, and pub/sub messages.
const CONFIG_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export function toConfigKey(raw: string): ConfigKey {
  if (!CONFIG_KEY_PATTERN.test(raw)) {
    throw new Error(
      `Invalid configuration key: "${raw}" (expected lowercase, dot/hyphen-namespaced segments)`,
    );
  }
  return raw as ConfigKey;
}
