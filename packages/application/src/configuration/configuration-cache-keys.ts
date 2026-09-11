import { ConfigScope } from "@llm-gateway/domain";
import type { ConfigKey } from "@llm-gateway/domain";

export const CONFIG_INVALIDATION_CHANNEL = "config:invalidate" as const;

export function buildCacheKey(scope: ConfigScope, scopeId: string, key: ConfigKey): string {
  return `cfg:${scope}:${scopeId}:${key}`;
}

export interface ConfigInvalidationMessage {
  readonly scope: ConfigScope;
  readonly scopeId: string;
  readonly key: ConfigKey;
}

export function encodeInvalidationMessage(message: ConfigInvalidationMessage): string {
  return JSON.stringify(message);
}

const CONFIG_SCOPES: readonly string[] = Object.values(ConfigScope);

// Invalidation messages arrive over Redis pub/sub, outside the type system — reject anything
// that doesn't match the expected shape rather than casting blindly.
export function decodeInvalidationMessage(raw: string): ConfigInvalidationMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed configuration invalidation payload (invalid JSON): ${raw}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Malformed configuration invalidation payload (not an object): ${raw}`);
  }

  const { scope, scopeId, key } = parsed as Record<string, unknown>;

  if (typeof scope !== "string" || !CONFIG_SCOPES.includes(scope)) {
    throw new Error(`Malformed configuration invalidation payload (invalid scope): ${raw}`);
  }
  if (typeof scopeId !== "string" || scopeId.length === 0) {
    throw new Error(`Malformed configuration invalidation payload (invalid scopeId): ${raw}`);
  }
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(`Malformed configuration invalidation payload (invalid key): ${raw}`);
  }

  return { scope: scope as ConfigScope, scopeId, key: key as ConfigKey };
}
