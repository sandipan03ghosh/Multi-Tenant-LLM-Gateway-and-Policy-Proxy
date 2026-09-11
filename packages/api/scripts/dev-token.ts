import { createPrismaClient, PrismaOrganizationRepository, PrismaUserRepository } from "@llm-gateway/adapters-postgres";
import { JoseJwtService } from "@llm-gateway/adapters-security";

async function main() {
  const prisma = createPrismaClient(process.env.DATABASE_URL!);
  const org = await new PrismaOrganizationRepository(prisma).findBySlug("acme-corp");
  if (!org) throw new Error("Run `pnpm db:seed` first");
  const user = await new PrismaUserRepository(prisma).findByEmailInOrganization(org.id, "admin@acme-corp.dev");
  if (!user) throw new Error("seed user missing");

  const jwt = new JoseJwtService({
    secret: process.env.JWT_SECRET!,
    issuer: process.env.JWT_ISSUER!,
    audience: process.env.JWT_AUDIENCE!,
  });
  const token = await jwt.sign({ userId: user.id, organizationId: org.id }, 3600);
  console.log("ORG_ID =", org.id);
  console.log("TOKEN  =", token);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
