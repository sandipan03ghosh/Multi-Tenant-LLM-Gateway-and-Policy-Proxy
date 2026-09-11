import type { Project } from "../entities/project.entity.js";
import type { OrganizationId, ProjectId } from "../value-objects/ids.js";

// Implemented by adapters-postgres. listByOrganization is scoped by design — there is no listAll().
export interface ProjectRepository {
  findById(id: ProjectId): Promise<Project | null>;
  findBySlugInOrganization(organizationId: OrganizationId, slug: string): Promise<Project | null>;
  listByOrganization(organizationId: OrganizationId): Promise<Project[]>;
  save(project: Project): Promise<void>;
}
