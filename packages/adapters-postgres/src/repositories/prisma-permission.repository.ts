import { Permission } from "@llm-gateway/domain";
import type { PermissionRepository } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface PermissionRow {
  id: string;
  code: string;
  description: string;
}

export class PrismaPermissionRepository implements PermissionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByCode(code: string): Promise<Permission | null> {
    const row = await this.prisma.permission.findUnique({ where: { code } });
    return row ? this.toDomain(row) : null;
  }

  async list(): Promise<Permission[]> {
    const rows = await this.prisma.permission.findMany();
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: PermissionRow): Permission {
    return Permission.create(row);
  }
}
