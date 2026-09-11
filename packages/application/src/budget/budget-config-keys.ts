import { toConfigKey } from "@llm-gateway/domain";
import type { ConfigKey, TenantContext, TenantScope } from "@llm-gateway/domain";

// Same helper as the other config-keys files' toTenantScope, kept local rather than shared.
export function toTenantScope(tenant: TenantContext): TenantScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.projectId ? { projectId: tenant.projectId } : {}),
  };
}

// Tenant-scoped (getWithFallback), mirrors rate-limit.policy's shape/convention.
export const BUDGET_POLICY_CONFIG_KEY: ConfigKey = toConfigKey("budget.policy");
