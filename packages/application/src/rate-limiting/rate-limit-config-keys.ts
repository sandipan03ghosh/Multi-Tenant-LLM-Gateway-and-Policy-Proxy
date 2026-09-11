import { toConfigKey } from "@llm-gateway/domain";
import type { ConfigKey, TenantContext, TenantScope } from "@llm-gateway/domain";

// Same helper as enrichment-config-keys.ts's toTenantScope, kept local rather than shared.
export function toTenantScope(tenant: TenantContext): TenantScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.projectId ? { projectId: tenant.projectId } : {}),
  };
}

// Single JSON-object config value ({capacity, refillTokens, refillIntervalMs}) rather than three
// keys — the fields only make sense set together, so splitting them would allow inconsistent
// partial updates.
export const RATE_LIMIT_POLICY_CONFIG_KEY: ConfigKey = toConfigKey("rate-limit.policy");
