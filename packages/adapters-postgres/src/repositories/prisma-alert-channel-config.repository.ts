import { AlertChannelConfig } from "@llm-gateway/domain";
import type { AlertChannelConfigRepository, AlertChannelConfigId } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface AlertChannelRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaAlertChannelConfigRepository implements AlertChannelConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: AlertChannelConfigId): Promise<AlertChannelConfig | null> {
    const row = await this.prisma.alertChannel.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async listAll(): Promise<AlertChannelConfig[]> {
    const rows = await this.prisma.alertChannel.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((row) => this.toDomain(row));
  }

  async listEnabled(): Promise<AlertChannelConfig[]> {
    const rows = await this.prisma.alertChannel.findMany({ where: { enabled: true } });
    return rows.map((row) => this.toDomain(row));
  }

  async save(config: AlertChannelConfig): Promise<void> {
    await this.prisma.alertChannel.upsert({
      where: { id: config.id },
      create: {
        id: config.id,
        name: config.name,
        url: config.url,
        enabled: config.enabled,
        createdAt: config.createdAt,
      },
      update: {
        name: config.name,
        url: config.url,
        enabled: config.enabled,
      },
    });
  }

  async delete(id: AlertChannelConfigId): Promise<void> {
    await this.prisma.alertChannel.delete({ where: { id } });
  }

  private toDomain(row: AlertChannelRow): AlertChannelConfig {
    return AlertChannelConfig.create(row);
  }
}
