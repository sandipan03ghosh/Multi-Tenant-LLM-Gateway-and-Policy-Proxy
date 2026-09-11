import { AuthenticationError } from "@llm-gateway/domain";
import type {
  ApiKeyRepository,
  ProjectRepository,
  ApiKeyRoleAssignmentRepository,
  RolePermissionRepository,
  ApiKeyHasher,
  TenantContext,
} from "@llm-gateway/domain";
import { resolveEffectivePermissions } from "./permission-resolution.js";

// Framework-agnostic: takes an already-extracted raw key string ("{prefix}.{secret}"), not an
// HTTP request. Express middleware does the header parsing.
export class ApiKeyAuthenticator {
  constructor(
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly hasher: ApiKeyHasher,
    private readonly apiKeyRoleAssignmentRepository: ApiKeyRoleAssignmentRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
  ) {}

  async authenticate(rawKey: string): Promise<TenantContext> {
    const prefix = this.extractPrefix(rawKey);
    if (!prefix) {
      throw new AuthenticationError();
    }

    const apiKey = await this.apiKeyRepository.findByPrefix(prefix);
    if (!apiKey || apiKey.isRevoked()) {
      throw new AuthenticationError();
    }

    const valid = await this.hasher.verify(rawKey, apiKey.keyHash);
    if (!valid) {
      throw new AuthenticationError();
    }

    const project = await this.projectRepository.findById(apiKey.projectId);
    if (!project) {
      // An ApiKey pointing at a deleted Project — surfaces as a generic auth failure, not a 500.
      throw new AuthenticationError();
    }

    const assignments = await this.apiKeyRoleAssignmentRepository.listByApiKey(apiKey.id);
    const permissions = await resolveEffectivePermissions(assignments, project.id, this.rolePermissionRepository);

    return {
      organizationId: project.organizationId,
      projectId: project.id,
      subjectType: "api_key",
      subjectId: apiKey.id,
      permissions,
    };
  }

  private extractPrefix(rawKey: string): string | null {
    const separatorIndex = rawKey.indexOf(".");
    if (separatorIndex <= 0) {
      return null;
    }
    return rawKey.slice(0, separatorIndex);
  }
}
