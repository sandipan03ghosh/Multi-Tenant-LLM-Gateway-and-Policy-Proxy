import type { Role } from "../entities/role.entity.js";
import type { OrganizationId, RoleId } from "../value-objects/ids.js";

// Implemented by adapters-postgres. findGlobalRoleByName is the platform-role counterpart to
// findByNameInOrganization — a dedicated method since "a role with no organization" is a
// distinct query shape.
export interface RoleRepository {
  findById(id: RoleId): Promise<Role | null>;
  findByNameInOrganization(organizationId: OrganizationId, name: string): Promise<Role | null>;
  findGlobalRoleByName(name: string): Promise<Role | null>;
  listByOrganization(organizationId: OrganizationId): Promise<Role[]>;
  save(role: Role): Promise<void>;
}
