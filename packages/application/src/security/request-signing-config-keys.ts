import { toConfigKey } from "@llm-gateway/domain";
import type { ConfigKey, TenantContext, TenantScope } from "@llm-gateway/domain";

// Same helper as the other subsystems' own toTenantScope, kept local rather than shared.
export function toTenantScope(tenant: TenantContext): TenantScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.projectId ? { projectId: tenant.projectId } : {}),
  };
}

// Tenant-scoped boolean, default false when unset or malformed.
export const REQUEST_SIGNING_ENABLED_CONFIG_KEY: ConfigKey = toConfigKey("security.request-signing.enabled");

// Owns the SecretStore key-naming convention for a project's HMAC signing key.
export function projectSigningKeySecretKey(projectId: string): string {
  return `project-signing-key:${projectId}`;
}
