import type { RoleId } from "../value-objects/ids.js";

// Implemented by adapters-postgres, backed by the role_permissions join table. Answers "which
// permission codes does this Role grant" — the piece RBAC enforcement needs.
export interface RolePermissionRepository {
  listPermissionCodesByRole(roleId: RoleId): Promise<string[]>;
}
