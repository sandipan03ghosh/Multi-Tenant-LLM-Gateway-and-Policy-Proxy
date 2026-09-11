import {
  ConfigScope,
  GLOBAL_CONFIG_SCOPE_ID,
  ConfigurationNotFoundError,
} from "@llm-gateway/domain";
import type {
  ConfigurationRepository,
  DistributedCache,
  PubSub,
  PubSubUnsubscribe,
  ConfigurationService,
  ConfigChangeHandler,
  ConfigSubscriptionUnsubscribe,
  ConfigKey,
  TenantScope,
} from "@llm-gateway/domain";
import {
  CONFIG_INVALIDATION_CHANNEL,
  buildCacheKey,
  decodeInvalidationMessage,
} from "./configuration-cache-keys.js";

const CACHE_TTL_SECONDS = 60;

// Cache-aside implementation of ConfigurationService. Depends only on domain ports — the
// concrete Postgres/Redis clients are injected by the composition root.
export class PostgresConfigurationService implements ConfigurationService {
  private readonly subscribers = new Map<ConfigKey, Set<ConfigChangeHandler>>();
  private invalidationUnsubscribe: PubSubUnsubscribe | undefined;

  constructor(
    private readonly repository: ConfigurationRepository,
    private readonly cache: DistributedCache,
    private readonly pubSub: PubSub,
  ) {}

  // Call once after construction so this instance reacts to invalidations published by any
  // process (including writes made through ConfigurationWriterService).
  async start(): Promise<void> {
    this.invalidationUnsubscribe = await this.pubSub.subscribe(
      CONFIG_INVALIDATION_CHANNEL,
      (raw) => {
        void this.handleInvalidation(raw);
      },
    );
  }

  async stop(): Promise<void> {
    await this.invalidationUnsubscribe?.();
    this.invalidationUnsubscribe = undefined;
  }

  async get<T>(key: ConfigKey): Promise<T> {
    return this.resolve<T>(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, key);
  }

  async getWithFallback<T>(key: ConfigKey, scope: TenantScope): Promise<T> {
    if (scope.projectId) {
      const value = await this.tryResolve<T>(ConfigScope.PROJECT, scope.projectId, key);
      if (value !== undefined) {
        return value;
      }
    }
    if (scope.organizationId) {
      const value = await this.tryResolve<T>(ConfigScope.ORGANIZATION, scope.organizationId, key);
      if (value !== undefined) {
        return value;
      }
    }
    return this.resolve<T>(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, key);
  }

  subscribe(key: ConfigKey, handler: ConfigChangeHandler): ConfigSubscriptionUnsubscribe {
    const handlers = this.subscribers.get(key) ?? new Set<ConfigChangeHandler>();
    handlers.add(handler);
    this.subscribers.set(key, handlers);
    return () => {
      handlers.delete(handler);
    };
  }

  private async resolve<T>(scope: ConfigScope, scopeId: string, key: ConfigKey): Promise<T> {
    const value = await this.tryResolve<T>(scope, scopeId, key);
    if (value === undefined) {
      throw new ConfigurationNotFoundError(key, scope, scopeId);
    }
    return value;
  }

  // Like resolve(), but returns undefined instead of throwing — lets getWithFallback() walk
  // project -> organization -> global without exceptions for control flow.
  private async tryResolve<T>(
    scope: ConfigScope,
    scopeId: string,
    key: ConfigKey,
  ): Promise<T | undefined> {
    const cacheKey = buildCacheKey(scope, scopeId, key);
    const cached = await this.cache.get<T>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const record = await this.repository.find(scope, scopeId, key);
    if (!record) {
      return undefined;
    }
    await this.cache.set(cacheKey, record.value as T, CACHE_TTL_SECONDS);
    return record.value as T;
  }

  private async handleInvalidation(raw: string): Promise<void> {
    let message;
    try {
      message = decodeInvalidationMessage(raw);
    } catch {
      // Malformed/foreign payload on the shared channel — drop it rather than crash the
      // subscriber loop for every other (valid) invalidation message.
      return;
    }

    const cacheKey = buildCacheKey(message.scope, message.scopeId, message.key);
    await this.cache.del(cacheKey);

    const handlers = this.subscribers.get(message.key);
    if (!handlers || handlers.size === 0) {
      return;
    }

    // subscribe() is keyed by ConfigKey alone, so notification re-resolves the GLOBAL value.
    // Tenant-scoped consumers should treat this as "something changed" and call getWithFallback().
    const value = await this.tryResolve(ConfigScope.GLOBAL, GLOBAL_CONFIG_SCOPE_ID, message.key);
    if (value === undefined) {
      return;
    }
    for (const handler of handlers) {
      handler(value);
    }
  }
}
