// Branded string ID types — same pattern as ConfigKey (value-objects/config-key.ts). Prevents
// passing, say, a ProjectId where an OrganizationId is expected, despite both being plain
// strings at runtime.

declare const organizationIdBrand: unique symbol;
declare const projectIdBrand: unique symbol;
declare const userIdBrand: unique symbol;
declare const apiKeyIdBrand: unique symbol;
declare const roleIdBrand: unique symbol;
declare const permissionIdBrand: unique symbol;
declare const alertChannelConfigIdBrand: unique symbol;

export type OrganizationId = string & { readonly [organizationIdBrand]: true };
export type ProjectId = string & { readonly [projectIdBrand]: true };
export type UserId = string & { readonly [userIdBrand]: true };
export type ApiKeyId = string & { readonly [apiKeyIdBrand]: true };
export type RoleId = string & { readonly [roleIdBrand]: true };
export type PermissionId = string & { readonly [permissionIdBrand]: true };
export type AlertChannelConfigId = string & { readonly [alertChannelConfigIdBrand]: true };

function nonEmptyId(raw: string, label: string): string {
  if (raw.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return raw;
}

export function toOrganizationId(raw: string): OrganizationId {
  return nonEmptyId(raw, "OrganizationId") as OrganizationId;
}
export function toProjectId(raw: string): ProjectId {
  return nonEmptyId(raw, "ProjectId") as ProjectId;
}
export function toUserId(raw: string): UserId {
  return nonEmptyId(raw, "UserId") as UserId;
}
export function toApiKeyId(raw: string): ApiKeyId {
  return nonEmptyId(raw, "ApiKeyId") as ApiKeyId;
}
export function toRoleId(raw: string): RoleId {
  return nonEmptyId(raw, "RoleId") as RoleId;
}
export function toPermissionId(raw: string): PermissionId {
  return nonEmptyId(raw, "PermissionId") as PermissionId;
}
export function toAlertChannelConfigId(raw: string): AlertChannelConfigId {
  return nonEmptyId(raw, "AlertChannelConfigId") as AlertChannelConfigId;
}
