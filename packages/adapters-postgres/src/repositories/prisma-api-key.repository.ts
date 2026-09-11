import { ApiKey } from "@llm-gateway/domain";
import type { ApiKeyRepository, ApiKeyId, ProjectId } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface ApiKeyRow {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: ApiKeyId): Promise<ApiKey | null> {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findByPrefix(keyPrefix: string): Promise<ApiKey | null> {
    const row = await this.prisma.apiKey.findUnique({ where: { keyPrefix } });
    return row ? this.toDomain(row) : null;
  }

  async listByProject(projectId: ProjectId): Promise<ApiKey[]> {
    const rows = await this.prisma.apiKey.findMany({ where: { projectId } });
    return rows.map((row) => this.toDomain(row));
  }

  async save(apiKey: ApiKey): Promise<void> {
    await this.prisma.apiKey.upsert({
      where: { id: apiKey.id },
      create: {
        id: apiKey.id,
        projectId: apiKey.projectId,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        keyHash: apiKey.keyHash,
        createdAt: apiKey.createdAt,
        revokedAt: apiKey.revokedAt,
      },
      update: {
        name: apiKey.name,
        revokedAt: apiKey.revokedAt,
      },
    });
  }

  private toDomain(row: ApiKeyRow): ApiKey {
    return ApiKey.create(row);
  }
}
