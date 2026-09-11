import type { ProjectId, RoleId, UserId } from "../value-objects/ids.js";

// Plain data, not an entity — a role assignment has no behavior. projectId is null when the
// bound Role has scope = ORGANIZATION, required when scope = PROJECT — enforced by the
// application layer that creates these, not here.
export interface UserRoleAssignment {
  readonly id: string;
  readonly userId: UserId;
  readonly roleId: RoleId;
  readonly projectId: ProjectId | null;
  readonly createdAt: Date;
}

// Implemented by adapters-postgres.
export interface UserRoleAssignmentRepository {
  listByUser(userId: UserId): Promise<UserRoleAssignment[]>;
  create(
    assignment: Omit<UserRoleAssignment, "id" | "createdAt">,
  ): Promise<UserRoleAssignment>;
}
