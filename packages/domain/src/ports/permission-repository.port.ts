import type { Permission } from "../entities/permission.entity.js";

// Implemented by adapters-postgres. The permission catalog is small and seeded — list() returns
// the whole catalog.
export interface PermissionRepository {
  findByCode(code: string): Promise<Permission | null>;
  list(): Promise<Permission[]>;
}
