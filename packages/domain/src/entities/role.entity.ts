import type { OrganizationId, RoleId } from "../value-objects/ids.js";
import { toOrganizationId, toRoleId } from "../value-objects/ids.js";
import type { RoleScope } from "../value-objects/role-scope.js";
import { assertNonEmpty } from "./validation-helpers.js";

export interface RoleProps {
  readonly id: string;
  readonly organizationId: string | null;
  readonly name: string;
  readonly scope: RoleScope;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A Role is normally defined under an Organization; its scope determines whether an assignment
// applies organization-wide or must be pinned to one Project (enforced at assignment, not here).
// organizationId is null for a global/platform role — see prisma/schema.prisma's Role model.
export class Role {
  readonly id: RoleId;
  readonly organizationId: OrganizationId | null;
  readonly name: string;
  readonly scope: RoleScope;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: RoleProps) {
    this.id = toRoleId(props.id);
    this.organizationId = props.organizationId === null ? null : toOrganizationId(props.organizationId);
    this.name = props.name;
    this.scope = props.scope;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: RoleProps): Role {
    assertNonEmpty("Role", "name", props.name);
    return new Role(props);
  }
}
