import { User } from "@llm-gateway/domain";
import type { UserRepository, OrganizationId, UserId } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface UserRow {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: UserId): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findByEmailInOrganization(
    organizationId: OrganizationId,
    email: string,
  ): Promise<User | null> {
    const row = await this.prisma.user.findUnique({
      where: { organizationId_email: { organizationId, email } },
    });
    return row ? this.toDomain(row) : null;
  }

  async save(user: User): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        passwordHash: user.passwordHash,
        createdAt: user.createdAt,
      },
      update: {
        email: user.email,
        passwordHash: user.passwordHash,
      },
    });
  }

  private toDomain(row: UserRow): User {
    return User.create(row);
  }
}
