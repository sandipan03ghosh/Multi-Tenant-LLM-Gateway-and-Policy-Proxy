// Wires PrismaClient with the mandatory driver adapter (Prisma 7 requires one). The generated
// client at ./generated/prisma does not exist until `pnpm prisma:generate` is run.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type { PrismaClient } from "./generated/prisma/client.js";
