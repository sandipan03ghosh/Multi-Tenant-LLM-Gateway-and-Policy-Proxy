import type { Organization } from "../entities/organization.entity.js";
import type { OrganizationId } from "../value-objects/ids.js";

// Implemented by adapters-postgres. No unscoped "get all" — a caller always identifies exactly
// which organization it means.
export interface OrganizationRepository {
  findById(id: OrganizationId): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  save(organization: Organization): Promise<void>;
}
