import type { User } from "../entities/user.entity.js";
import type { OrganizationId, UserId } from "../value-objects/ids.js";

// Implemented by adapters-postgres.
export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmailInOrganization(organizationId: OrganizationId, email: string): Promise<User | null>;
  save(user: User): Promise<void>;
}
