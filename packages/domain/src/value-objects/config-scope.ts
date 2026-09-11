// Mirrors the ConfigScope enum in prisma/schema.prisma by value, not by import — domain must
// never depend on the generated Prisma client.

export enum ConfigScope {
  GLOBAL = "GLOBAL",
  ORGANIZATION = "ORGANIZATION",
  PROJECT = "PROJECT",
}

// The literal scopeId used for GLOBAL-scope ConfigurationEntry rows.
export const GLOBAL_CONFIG_SCOPE_ID = "global";

// The caller's tenant position when resolving config via getWithFallback (project -> org ->
// global). Both fields optional — a caller with no context resolves against GLOBAL.
export interface TenantScope {
  readonly organizationId?: string;
  readonly projectId?: string;
}
