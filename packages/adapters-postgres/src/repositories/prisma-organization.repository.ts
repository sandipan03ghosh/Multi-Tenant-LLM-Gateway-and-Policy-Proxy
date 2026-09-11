import { Organization } from "@llm-gateway/domain";
import type { OrganizationRepository, OrganizationId } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: OrganizationId): Promise<Organization | null> {
    const row = await this.prisma.organization.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const row = await this.prisma.organization.findUnique({ where: { slug } });
    return row ? this.toDomain(row) : null;
  }

  async save(organization: Organization): Promise<void> {
    await this.prisma.organization.upsert({
      where: { id: organization.id },
      create: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
      },
      update: {
        name: organization.name,
        slug: organization.slug,
      },
    });
  }

  private toDomain(row: OrganizationRow): Organization {
    return Organization.create(row);
  }
}
