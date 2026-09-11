import { toConfigKey } from "@llm-gateway/domain";
import type { ConfigScope, ConfigurationRepository, ConfigurationRecord, ConfigKey } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

// The `as never` casts below are the single crossing point between @llm-gateway/domain's
// ConfigScope and Prisma's generated one (identical string values). Verify them, and the
// `scope_scopeId_key` compound-key field name, against the generated client the first time
// `pnpm prisma:generate` runs.

export class PrismaConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(
    scope: ConfigScope,
    scopeId: string,
    key: ConfigKey,
  ): Promise<ConfigurationRecord | null> {
    const row = await this.prisma.configurationEntry.findUnique({
      where: {
        scope_scopeId_key: { scope: scope as never, scopeId, key },
      },
    });
    if (!row) {
      return null;
    }
    return {
      scope: row.scope as unknown as ConfigScope,
      scopeId: row.scopeId,
      key: toConfigKey(row.key),
      value: row.value,
    };
  }

  async upsert(scope: ConfigScope, scopeId: string, key: ConfigKey, value: unknown): Promise<void> {
    await this.prisma.configurationEntry.upsert({
      where: {
        scope_scopeId_key: { scope: scope as never, scopeId, key },
      },
      create: {
        scope: scope as never,
        scopeId,
        key,
        value: value as never,
      },
      update: {
        value: value as never,
      },
    });
  }

  async listByScope(scope: ConfigScope, scopeId: string): Promise<ConfigurationRecord[]> {
    const rows = await this.prisma.configurationEntry.findMany({
      where: { scope: scope as never, scopeId },
    });
    return rows.map((row) => ({
      scope: row.scope as unknown as ConfigScope,
      scopeId: row.scopeId,
      key: toConfigKey(row.key),
      value: row.value,
    }));
  }
}
