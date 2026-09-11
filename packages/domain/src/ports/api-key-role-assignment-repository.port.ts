import type { ApiKeyId, ProjectId, RoleId } from "../value-objects/ids.js";

// Same shape/rationale as UserRoleAssignment (see user-role-assignment-repository.port.ts), for
// machine identities instead of human ones.
export interface ApiKeyRoleAssignment {
  readonly id: string;
  readonly apiKeyId: ApiKeyId;
  readonly roleId: RoleId;
  readonly projectId: ProjectId | null;
  readonly createdAt: Date;
}

// Implemented by adapters-postgres.
export interface ApiKeyRoleAssignmentRepository {
  listByApiKey(apiKeyId: ApiKeyId): Promise<ApiKeyRoleAssignment[]>;
  create(
    assignment: Omit<ApiKeyRoleAssignment, "id" | "createdAt">,
  ): Promise<ApiKeyRoleAssignment>;
}
