// Mirrors the RoleScope enum in prisma/schema.prisma by value, not by import — domain must never
// depend on the generated Prisma client.
export enum RoleScope {
  ORGANIZATION = "ORGANIZATION",
  PROJECT = "PROJECT",
}
