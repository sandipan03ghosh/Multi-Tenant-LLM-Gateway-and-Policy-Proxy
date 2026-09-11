import type { RolePermissionRepository, RoleId } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

export class PrismaRolePermissionRepository implements RolePermissionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listPermissionCodesByRole(roleId: RoleId): Promise<string[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
    return rows.map((row) => row.permission.code);
  }
}
