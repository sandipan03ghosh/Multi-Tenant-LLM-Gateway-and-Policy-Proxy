import { toProjectId, toRoleId, toUserId } from "@llm-gateway/domain";
import type {
  UserRoleAssignment,
  UserRoleAssignmentRepository,
  UserId,
} from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface UserRoleAssignmentRow {
  id: string;
  userId: string;
  roleId: string;
  projectId: string | null;
  createdAt: Date;
}

// No upsert — the compound unique constraint includes a nullable projectId, so create() is a
// plain insert. Callers needing dedup do their own find-first check.
export class PrismaUserRoleAssignmentRepository implements UserRoleAssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByUser(userId: UserId): Promise<UserRoleAssignment[]> {
    const rows = await this.prisma.userRoleAssignment.findMany({ where: { userId } });
    return rows.map((row) => this.toDomain(row));
  }

  async create(
    assignment: Omit<UserRoleAssignment, "id" | "createdAt">,
  ): Promise<UserRoleAssignment> {
    const row = await this.prisma.userRoleAssignment.create({
      data: {
        userId: assignment.userId,
        roleId: assignment.roleId,
        projectId: assignment.projectId,
      },
    });
    return this.toDomain(row);
  }

  private toDomain(row: UserRoleAssignmentRow): UserRoleAssignment {
    return {
      id: row.id,
      userId: toUserId(row.userId),
      roleId: toRoleId(row.roleId),
      projectId: row.projectId ? toProjectId(row.projectId) : null,
      createdAt: row.createdAt,
    };
  }
}
