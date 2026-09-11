import { Project } from "@llm-gateway/domain";
import type { ProjectRepository, OrganizationId, ProjectId } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface ProjectRow {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: ProjectId): Promise<Project | null> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findBySlugInOrganization(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<Project | null> {
    const row = await this.prisma.project.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
    });
    return row ? this.toDomain(row) : null;
  }

  async listByOrganization(organizationId: OrganizationId): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({ where: { organizationId } });
    return rows.map((row) => this.toDomain(row));
  }

  async save(project: Project): Promise<void> {
    await this.prisma.project.upsert({
      where: { id: project.id },
      create: {
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        slug: project.slug,
        createdAt: project.createdAt,
      },
      update: {
        name: project.name,
        slug: project.slug,
      },
    });
  }

  private toDomain(row: ProjectRow): Project {
    return Project.create(row);
  }
}
