import {
  ConfigScope,
  GLOBAL_CONFIG_SCOPE_ID,
  ConfigurationNotFoundError,
  toConfigKey,
} from "@llm-gateway/domain";
import type {
  ConfigurationRepository,
  ConfigurationRecord,
  DistributedCache,
  PubSub,
  PubSubHandler,
  ConfigKey,
} from "@llm-gateway/domain";
import { PostgresConfigurationService } from "./postgres-configuration.service.js";
import { ConfigurationWriterService } from "./configuration-writer.service.js";

// In-memory fakes for the three domain ports this subsystem depends on — no real Postgres or Redis.

class FakeConfigurationRepository implements ConfigurationRepository {
  private readonly rows = new Map<string, ConfigurationRecord>();
  findCallCount = 0;

  private rowKey(scope: ConfigScope, scopeId: string, key: ConfigKey): string {
    return `${scope}:${scopeId}:${key}`;
  }

  async find(
    scope: ConfigScope,
    scopeId: string,
    key: ConfigKey,
  ): Promise<ConfigurationRecord | null> {
    this.findCallCount += 1;
    return this.rows.get(this.rowKey(scope, scopeId, key)) ?? null;
  }

  async upsert(scope: ConfigScope, scopeId: string, key: ConfigKey, value: unknown): Promise<void> {
    this.rows.set(this.rowKey(scope, scopeId, key), { scope, scopeId, key, value });
  }

  async listByScope(scope: ConfigScope, scopeId: string): Promise<ConfigurationRecord[]> {
    return [...this.rows.values()].filter((row) => row.scope === scope && row.scopeId === scopeId);
  }
}

class FakeDistributedCache implements DistributedCache {
  private readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.store.has(key) ? (this.store.get(key) as T) : null);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class FakePubSub implements PubSub {
  private readonly channels = new Map<string, Set<PubSubHandler>>();

  async publish(channel: string, message: string): Promise<void> {
    for (const handler of this.channels.get(channel) ?? []) {
      handler(message);
    }
  }

  async subscribe(channel: string, handler: PubSubHandler) {
    const handlers = this.channels.get(channel) ?? new Set<PubSubHandler>();
    handlers.add(handler);
    this.channels.set(channel, handlers);
    return async () => {
      handlers.delete(handler);
    };
  }
}

function setup() {
  const repository = new FakeConfigurationRepository();
  const cache = new FakeDistributedCache();
  const pubSub = new FakePubSub();
  const service = new PostgresConfigurationService(repository, cache, pubSub);
  const writer = new ConfigurationWriterService(repository, pubSub);
  return { repository, cache, pubSub, service, writer };
}

describe("PostgresConfigurationService", () => {
  it("resolves a GLOBAL key from the repository on a cache miss", async () => {
    const { repository, service } = setup();
    const key = toConfigKey("routing.policy");
    await repository.upsert(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, key, { strategy: "manual" });

    const value = await service.get<{ strategy: string }>(key);

    expect(value).toEqual({ strategy: "manual" });
  });

  it("serves subsequent reads from cache without hitting the repository again", async () => {
    const { repository, service } = setup();
    const key = toConfigKey("routing.policy");
    await repository.upsert(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, key, { strategy: "manual" });

    await service.get(key);
    const callsAfterFirstRead = repository.findCallCount;
    await service.get(key);

    expect(repository.findCallCount).toBe(callsAfterFirstRead);
  });

  it("throws ConfigurationNotFoundError when the key does not exist anywhere", async () => {
    const { service } = setup();
    await expect(service.get(toConfigKey("does-not-exist"))).rejects.toBeInstanceOf(
      ConfigurationNotFoundError,
    );
  });

  it("getWithFallback resolves project scope before organization or global", async () => {
    const { repository, service } = setup();
    const key = toConfigKey("rate-limit.policy");
    await repository.upsert(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, key, { limit: 1 });
    await repository.upsert(ConfigScope.ORGANIZATION, "org_1", key, { limit: 10 });
    await repository.upsert(ConfigScope.PROJECT, "proj_1", key, { limit: 100 });

    const value = await service.getWithFallback<{ limit: number }>(key, {
      organizationId: "org_1",
      projectId: "proj_1",
    });

    expect(value).toEqual({ limit: 100 });
  });

  it("getWithFallback falls back to organization, then global, when narrower scopes are unset", async () => {
    const { repository, service } = setup();
    const key = toConfigKey("rate-limit.policy");
    await repository.upsert(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, key, { limit: 1 });
    await repository.upsert(ConfigScope.ORGANIZATION, "org_1", key, { limit: 10 });

    const value = await service.getWithFallback<{ limit: number }>(key, {
      organizationId: "org_1",
      projectId: "proj_without_override",
    });

    expect(value).toEqual({ limit: 10 });
  });

  it("evicts the cache and notifies subscribers when a write is published", async () => {
    const { service, writer } = setup();
    const key = toConfigKey("routing.policy");
    await writer.set(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, key, { strategy: "manual" });
    await service.start();

    const received: unknown[] = [];
    service.subscribe(key, (value) => received.push(value));

    await writer.set(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, key, { strategy: "weighted" });
    // start()'s invalidation handler is fire-and-forget (void this.handleInvalidation), and
    // handleInvalidation awaits cache-eviction + a repository re-fetch before notifying — let
    // that chain settle before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    expect(received).toEqual([{ strategy: "weighted" }]);

    await service.stop();
  });
});
