import { Role } from "@llm-gateway/domain";
import type { RoleRepository, OrganizationId, RoleId, RoleScope } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface RoleRow {
  id: string;
  organizationId: string | null;
  name: string;
  scope: string;
  createdAt: Date;
  updatedAt: Date;
}

// scope crosses the domain RoleScope / Prisma RoleScope boundary via `as never`. Verify the
// generated RoleScope type and the organizationId_name compound-key field name after the first
// `pnpm prisma:generate`.
export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: RoleId): Promise<Role | null> {
    const row = await this.prisma.role.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findByNameInOrganization(organizationId: OrganizationId, name: string): Promise<Role | null> {
    const row = await this.prisma.role.findUnique({
      where: { organizationId_name: { organizationId, name } },
    });
    return row ? this.toDomain(row) : null;
  }

  // A global/platform role has organizationId = null. findFirst with an explicit filter sidesteps
  // the uncertainty over whether the generated compound-key input accepts null.
  async findGlobalRoleByName(name: string): Promise<Role | null> {
    const row = await this.prisma.role.findFirst({ where: { organizationId: null, name } });
    return row ? this.toDomain(row) : null;
  }

  async listByOrganization(organizationId: OrganizationId): Promise<Role[]> {
    const rows = await this.prisma.role.findMany({ where: { organizationId } });
    return rows.map((row) => this.toDomain(row));
  }

  async save(role: Role): Promise<void> {
    await this.prisma.role.upsert({
      where: { id: role.id },
      create: {
        id: role.id,
        organizationId: role.organizationId,
        name: role.name,
        scope: role.scope as never,
        createdAt: role.createdAt,
      },
      update: {
        name: role.name,
        scope: role.scope as never,
      },
    });
  }

  private toDomain(row: RoleRow): Role {
    return Role.create({ ...row, scope: row.scope as RoleScope });
  }
}
