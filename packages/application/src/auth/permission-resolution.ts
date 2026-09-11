import type { RoleId, ProjectId, RolePermissionRepository } from "@llm-gateway/domain";

interface RoleAssignmentLike {
  readonly roleId: RoleId;
  readonly projectId: ProjectId | null;
}

// Shared by ApiKeyAuthenticator and JwtAuthenticator. An assignment applies if it's org-wide
// (its projectId is null) or matches the caller's current projectId exactly.
export async function resolveEffectivePermissions(
  assignments: readonly RoleAssignmentLike[],
  currentProjectId: ProjectId | null,
  rolePermissionRepository: RolePermissionRepository,
): Promise<readonly string[]> {
  const applicable = assignments.filter(
    (assignment) => assignment.projectId === null || assignment.projectId === currentProjectId,
  );
  const codeLists = await Promise.all(
    applicable.map((assignment) => rolePermissionRepository.listPermissionCodesByRole(assignment.roleId)),
  );
  return [...new Set(codeLists.flat())];
}
