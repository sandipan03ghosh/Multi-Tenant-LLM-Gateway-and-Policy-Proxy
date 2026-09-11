import { AuthenticationError, toUserId } from "@llm-gateway/domain";
import type { JwtService, UserRepository, UserRoleAssignmentRepository, RolePermissionRepository, TenantContext } from "@llm-gateway/domain";
import { resolveEffectivePermissions } from "./permission-resolution.js";

// Framework-agnostic: takes an already-extracted raw token string, not an HTTP request.
// Re-fetches the User on every call rather than trusting the JWT payload alone, so a
// deleted/deactivated user's still-valid token stops working immediately — one DB read per
// authenticated request for that guarantee.
export class JwtAuthenticator {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
    private readonly userRoleAssignmentRepository: UserRoleAssignmentRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
  ) {}

  async authenticate(token: string): Promise<TenantContext> {
    let claims;
    try {
      claims = await this.jwtService.verify(token);
    } catch {
      throw new AuthenticationError();
    }

    const user = await this.userRepository.findById(toUserId(claims.userId));
    if (!user) {
      throw new AuthenticationError();
    }

    // A JWT-authenticated user has no inherent projectId — only org-wide role assignments apply.
    const assignments = await this.userRoleAssignmentRepository.listByUser(user.id);
    const permissions = await resolveEffectivePermissions(assignments, null, this.rolePermissionRepository);

    return {
      organizationId: user.organizationId,
      projectId: null,
      subjectType: "user",
      subjectId: user.id,
      permissions,
    };
  }
}
