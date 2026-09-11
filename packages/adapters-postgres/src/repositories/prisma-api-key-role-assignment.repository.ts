import { toApiKeyId, toProjectId, toRoleId } from "@llm-gateway/domain";
import type {
  ApiKeyRoleAssignment,
  ApiKeyRoleAssignmentRepository,
  ApiKeyId,
} from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface ApiKeyRoleAssignmentRow {
  id: string;
  apiKeyId: string;
  roleId: string;
  projectId: string | null;
  createdAt: Date;
}

// Same rationale as PrismaUserRoleAssignmentRepository: plain insert, no upsert, because of the
// nullable projectId inside this table's unique constraint.
export class PrismaApiKeyRoleAssignmentRepository implements ApiKeyRoleAssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByApiKey(apiKeyId: ApiKeyId): Promise<ApiKeyRoleAssignment[]> {
    const rows = await this.prisma.apiKeyRoleAssignment.findMany({ where: { apiKeyId } });
    return rows.map((row) => this.toDomain(row));
  }

  async create(
    assignment: Omit<ApiKeyRoleAssignment, "id" | "createdAt">,
  ): Promise<ApiKeyRoleAssignment> {
    const row = await this.prisma.apiKeyRoleAssignment.create({
      data: {
        apiKeyId: assignment.apiKeyId,
        roleId: assignment.roleId,
        projectId: assignment.projectId,
      },
    });
    return this.toDomain(row);
  }

  private toDomain(row: ApiKeyRoleAssignmentRow): ApiKeyRoleAssignment {
    return {
      id: row.id,
      apiKeyId: toApiKeyId(row.apiKeyId),
      roleId: toRoleId(row.roleId),
      projectId: row.projectId ? toProjectId(row.projectId) : null,
      createdAt: row.createdAt,
    };
  }
}
