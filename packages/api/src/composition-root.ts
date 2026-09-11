import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPrismaClient,
  PrismaConfigurationRepository,
  PrismaApiKeyRepository,
  PrismaProjectRepository,
  PrismaUserRepository,
  PrismaBatchRequestRepository,
  PrismaApiKeyRoleAssignmentRepository,
  PrismaUserRoleAssignmentRepository,
  PrismaRolePermissionRepository,
  PrismaAuditLogRepository,
  PrismaCostLedgerRepository,
  PrismaAlertChannelConfigRepository,
  PostgresJobScheduler,
} from "@llm-gateway/adapters-postgres";
import {
  createRedisClient,
  RedisDistributedCache,
  RedisPubSub,
  RedisCircuitBreaker,
  RedisHealthTracker,
  RedisRoundRobinRoutingStrategy,
  RedisStickyRoutingStrategy,
  RedisRequestScheduler,
  RedisTokenBucketAlgorithm,
  RedisBudgetCounterStore,
  RedisReplayCache,
} from "@llm-gateway/adapters-redis";
import { GeminiProviderAdapter } from "@llm-gateway/adapters-provider-gemini";
import { GroqProviderAdapter } from "@llm-gateway/adapters-provider-groq";
import { JoseJwtService, Argon2ApiKeyHasher, EnvVarSecretStore } from "@llm-gateway/adapters-security";
import { logger, metricsRegistry, Gauge } from "@llm-gateway/adapters-observability";
import {
  PostgresConfigurationService,
  StaticProviderCatalog,
  InMemoryProviderRegistry,
  ManualRoutingStrategy,
  WeightedRoutingStrategy,
  HealthAwareRoutingStrategy,
  HealthAwareProviderScorer,
  DefaultRoutingEngine,
  ExponentialBackoffRetryPolicy,
  DefaultShadowTrafficDispatcher,
  ApiKeyAuthenticator,
  JwtAuthenticator,
  SystemPromptInjectionStage,
  CompliancePolicyStage,
  ContentFilterStage,
  NoOpContentModerationPort,
  DefaultRequestEnrichmentPipeline,
  DefaultRateLimiter,
  DefaultCostEngine,
  DefaultBudgetEnforcer,
  DefaultRequestSignatureVerifier,
  DefaultAlertPublisher,
  PersistentWebhookAlertChannel,
  ConfigurationWriterService,
} from "@llm-gateway/application";
import type { ProviderPort, ProviderModelMetadata, RoutingStrategy, EnrichmentStage, JobEnqueuer, AlertChannel } from "@llm-gateway/domain";
import { checkReadiness, buildVersionInfo } from "./health/health-checks.js";
import type { ReadinessResult, VersionInfo } from "./health/health-checks.js";
import type { Env } from "./config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Reads the package's own version at startup; fs.readFileSync avoids a resolveJsonModule dependency.
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as { version: string };

// Known models for the two providers. Not read from ConfigurationService — config-driven catalog
// data is a later upgrade.
const KNOWN_MODELS: readonly ProviderModelMetadata[] = [
  {
    providerId: "gemini",
    modelId: "gemini-1.5-flash",
    displayName: "Gemini 1.5 Flash",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 8192,
    supportsStreaming: true,
  },
  {
    providerId: "groq",
    modelId: "openai/gpt-oss-20b",
    displayName: "GPT-OSS 20B (Groq)",
    contextWindowTokens: 128_000,
    maxOutputTokens: 32_768,
    supportsStreaming: true,
  },
];

export interface Composition {
  readonly routingEngine: DefaultRoutingEngine;
  readonly providerCatalog: StaticProviderCatalog;
  readonly providerRegistry: InMemoryProviderRegistry;
  readonly registeredProviderIds: readonly string[];
  readonly apiKeyAuthenticator: ApiKeyAuthenticator;
  readonly jwtAuthenticator: JwtAuthenticator;
  readonly enrichmentPipeline: DefaultRequestEnrichmentPipeline;
  readonly rateLimiter: DefaultRateLimiter;
  readonly costEngine: DefaultCostEngine;
  readonly budgetEnforcer: DefaultBudgetEnforcer;
  readonly requestSignatureVerifier: DefaultRequestSignatureVerifier;
  readonly requestScheduler: RedisRequestScheduler;
  readonly batchRequestRepository: PrismaBatchRequestRepository;
  readonly auditLogRepository: PrismaAuditLogRepository;
  readonly alertChannelConfigRepository: PrismaAlertChannelConfigRepository;
  readonly configurationService: PostgresConfigurationService;
  readonly configurationWriter: ConfigurationWriterService;
  readonly projectRepository: PrismaProjectRepository;
  // Pre-normalized to just the origin so admin-cors.middleware.ts only compares strings.
  // undefined when env.ADMIN_UI_ORIGIN isn't set (CORS stays off for /admin/v1/*).
  readonly adminUiOrigin: string | undefined;
  readonly checkReadiness: () => Promise<ReadinessResult>;
  readonly versionInfo: VersionInfo;
  readonly shutdown: () => Promise<void>;
}

// The only place concrete adapter classes are instantiated — everything downstream sees domain
// ports and application-layer services.
export async function buildComposition(env: Env): Promise<Composition> {
  // `new URL(...).origin` strips any path/query/fragment from ADMIN_UI_ORIGIN. It's already
  // .url()-validated in env.ts, so this can't throw.
  const adminUiOrigin = env.ADMIN_UI_ORIGIN ? new URL(env.ADMIN_UI_ORIGIN).origin : undefined;

  const prisma = createPrismaClient(env.DATABASE_URL);
  const redisCacheConnection = createRedisClient(env.REDIS_URL);
  const redisPublisherConnection = createRedisClient(env.REDIS_URL);

  // Set after configurationService.start(); /ready reads it through a closure (ConfigurationService
  // has no isReady() of its own).
  let configurationReady = false;

  // If anything below fails after these resources exist, tear them down before propagating —
  // otherwise a failed startup leaks DB/Redis connections and ConfigurationService subscriptions.
  let configurationService: PostgresConfigurationService | undefined;
  let costEngine: DefaultCostEngine | undefined;
  let providerRegistry: InMemoryProviderRegistry | undefined;
  try {
    const configurationRepository = new PrismaConfigurationRepository(prisma);
    const distributedCache = new RedisDistributedCache(redisCacheConnection);
    const configPubSub = new RedisPubSub(redisPublisherConnection);
    configurationService = new PostgresConfigurationService(
      configurationRepository,
      distributedCache,
      configPubSub,
    );
    await configurationService.start();
    configurationReady = true;

    // Companion write-side port — the Admin API uses this to change tenant-scoped policy. Reuses
    // the same repository/pub-sub instances, and every write publishes the cache-invalidation
    // signal configurationService.start() subscribed to, so changes take effect with no restart.
    const configurationWriter = new ConfigurationWriterService(configurationRepository, configPubSub);

    // Default self-hosted SecretStore — built from this process's validated Env. Provider API keys
    // resolve through it so a future cloud secret manager adapter is a swap-in here.
    const secretStore = new EnvVarSecretStore({ GEMINI_API_KEY: env.GEMINI_API_KEY, GROQ_API_KEY: env.GROQ_API_KEY });

    const providers: ProviderPort[] = [];
    const geminiApiKey = await secretStore.getSecret("GEMINI_API_KEY");
    if (geminiApiKey) {
      providers.push(new GeminiProviderAdapter({ apiKey: geminiApiKey }));
    }
    const groqApiKey = await secretStore.getSecret("GROQ_API_KEY");
    if (groqApiKey) {
      providers.push(new GroqProviderAdapter({ apiKey: groqApiKey }));
    }
    // env.ts already refuses to start with neither key set — this is defense in depth.
    if (providers.length === 0) {
      throw new Error(
        "No provider adapters constructed — this should be unreachable given env.ts's validation.",
      );
    }

    const registeredProviderIds = providers.map((provider) => provider.providerId);
    // Outer `let` so teardownOnFailedStartup can stop() it on a later throw. Awaited before
    // returning — until it resolves, provider.{id}.enabled subscriptions aren't active.
    providerRegistry = new InMemoryProviderRegistry(providers, configurationService);
    await providerRegistry.start();
    const providerCatalog = new StaticProviderCatalog(
      KNOWN_MODELS.filter((model) => registeredProviderIds.includes(model.providerId)),
    );

    // Built before the circuit breaker/health tracker: both take an AlertPublisher that needs a
    // JobEnqueuer. Typed as JobEnqueuer, not JobScheduler — the API process only enqueues
    // (budget_reconcile, deliver_webhook); the worker consumes them. Constructing it has no side
    // effects; PostgresJobScheduler only polls on an explicit .start().
    const jobEnqueuer: JobEnqueuer = new PostgresJobScheduler(prisma);
    // alertChannelConfigRepository is also exposed on Composition below for the Admin API's
    // /admin/v1/alert-channels router.
    const alertChannelConfigRepository = new PrismaAlertChannelConfigRepository(prisma);
    const alertChannels: AlertChannel[] = [new PersistentWebhookAlertChannel(alertChannelConfigRepository, jobEnqueuer)];
    const alertPublisher = new DefaultAlertPublisher(alertChannels);

    // All the Redis adapter classes below share redisCacheConnection safely: none issues a
    // blocking command or WATCH/MULTI directly on it — the transactional ones call .duplicate()
    // for their own transaction, the rest issue only plain non-transactional commands.
    const circuitBreaker = new RedisCircuitBreaker(redisCacheConnection, alertPublisher);
    const healthTracker = new RedisHealthTracker(redisCacheConnection, alertPublisher);
    const scorer = new HealthAwareProviderScorer(healthTracker);
    const strategies = new Map<string, RoutingStrategy>([
      ["manual", new ManualRoutingStrategy()],
      ["round_robin", new RedisRoundRobinRoutingStrategy(redisCacheConnection)],
      ["weighted", new WeightedRoutingStrategy()],
      ["health_aware", new HealthAwareRoutingStrategy()],
      ["sticky", new RedisStickyRoutingStrategy(redisCacheConnection)],
    ]);
    const retryPolicy = new ExponentialBackoffRetryPolicy();
    const shadowTrafficDispatcher = new DefaultShadowTrafficDispatcher(providerRegistry, healthTracker);
    const routingEngine = new DefaultRoutingEngine(
      strategies,
      scorer,
      providerRegistry,
      circuitBreaker,
      healthTracker,
      retryPolicy,
      shadowTrafficDispatcher,
    );

    // NoOpContentModerationPort is the default — always allows; a real moderation adapter is a swap-in.
    const contentModerationPort = new NoOpContentModerationPort();
    const enrichmentStages = new Map<string, EnrichmentStage>(
      [
        new SystemPromptInjectionStage(configurationService),
        new CompliancePolicyStage(configurationService),
        new ContentFilterStage(configurationService, contentModerationPort),
      ].map((stage) => [stage.name, stage]),
    );
    const enrichmentPipeline = new DefaultRequestEnrichmentPipeline(configurationService, enrichmentStages);

    const rateLimitAlgorithm = new RedisTokenBucketAlgorithm(redisCacheConnection);
    const rateLimiter = new DefaultRateLimiter(configurationService, rateLimitAlgorithm);

    const costLedgerRepository = new PrismaCostLedgerRepository(prisma);
    costEngine = new DefaultCostEngine(configurationService, costLedgerRepository);
    await costEngine.start();

    const budgetCounterStore = new RedisBudgetCounterStore(redisCacheConnection);
    const budgetEnforcer = new DefaultBudgetEnforcer(configurationService, budgetCounterStore, costLedgerRepository, jobEnqueuer, alertPublisher);

    const replayCache = new RedisReplayCache(redisCacheConnection);
    const requestSignatureVerifier = new DefaultRequestSignatureVerifier(configurationService, secretStore, replayCache);

    const requestScheduler = new RedisRequestScheduler(redisCacheConnection);
    const batchRequestRepository = new PrismaBatchRequestRepository(prisma);
    const auditLogRepository = new PrismaAuditLogRepository(prisma);

    const apiKeyRepository = new PrismaApiKeyRepository(prisma);
    const projectRepository = new PrismaProjectRepository(prisma);
    const userRepository = new PrismaUserRepository(prisma);
    const apiKeyHasher = new Argon2ApiKeyHasher();
    const apiKeyRoleAssignmentRepository = new PrismaApiKeyRoleAssignmentRepository(prisma);
    const userRoleAssignmentRepository = new PrismaUserRoleAssignmentRepository(prisma);
    const rolePermissionRepository = new PrismaRolePermissionRepository(prisma);
    const apiKeyAuthenticator = new ApiKeyAuthenticator(
      apiKeyRepository,
      projectRepository,
      apiKeyHasher,
      apiKeyRoleAssignmentRepository,
      rolePermissionRepository,
    );

    const jwtService = new JoseJwtService({
      secret: env.JWT_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    const jwtAuthenticator = new JwtAuthenticator(jwtService, userRepository, userRoleAssignmentRepository, rolePermissionRepository);

    // Both gauges read live adapter state at scrape time via collect(), not a polling loop. They
    // live here because adapters-observability can't depend on adapters-redis — the composition
    // root is the one place both the concrete instances and the registry are in scope.
    new Gauge({
      name: "circuit_breaker_state",
      help: "Circuit breaker state per provider/model: 0=closed, 1=half_open, 2=open.",
      labelNames: ["provider", "model"] as const,
      registers: [metricsRegistry],
      async collect() {
        for (const model of KNOWN_MODELS) {
          const state = await circuitBreaker.getState(model.providerId, model.modelId);
          const value = state === "closed" ? 0 : state === "half_open" ? 1 : 2;
          this.set({ provider: model.providerId, model: model.modelId }, value);
        }
      },
    });
    new Gauge({
      name: "scheduler_queue_depth",
      help: "Depth of the batch/background request scheduling queue, by request class.",
      labelNames: ["request_class"] as const,
      registers: [metricsRegistry],
      async collect() {
        const depths = await requestScheduler.getQueueDepths();
        this.set({ request_class: "batch" }, depths.batch);
        this.set({ request_class: "background" }, depths.background);
      },
    });

    const activeConfigurationService = configurationService;
    const activeCostEngine = costEngine;
    const activeProviderRegistry = providerRegistry;
    return {
      routingEngine,
      providerCatalog,
      providerRegistry: activeProviderRegistry,
      registeredProviderIds,
      apiKeyAuthenticator,
      jwtAuthenticator,
      enrichmentPipeline,
      rateLimiter,
      costEngine: activeCostEngine,
      budgetEnforcer,
      requestSignatureVerifier,
      requestScheduler,
      batchRequestRepository,
      auditLogRepository,
      alertChannelConfigRepository,
      configurationService: activeConfigurationService,
      configurationWriter,
      projectRepository,
      adminUiOrigin,
      checkReadiness: () => checkReadiness(prisma, redisCacheConnection, () => configurationReady),
      versionInfo: buildVersionInfo(packageJson.version, env.NODE_ENV, env.GIT_COMMIT_SHA),
      shutdown: async () => {
        activeProviderRegistry.stop();
        activeCostEngine.stop();
        await activeConfigurationService.stop();
        await prisma.$disconnect();
        redisCacheConnection.disconnect();
        redisPublisherConnection.disconnect();
      },
    };
  } catch (error) {
    await teardownOnFailedStartup(prisma, redisCacheConnection, redisPublisherConnection, configurationService, costEngine, providerRegistry);
    throw error;
  }
}

// Best-effort cleanup after a failed startup — each step independently guarded so one failure
// doesn't block the others, and none masks the original startup error.
async function teardownOnFailedStartup(
  prisma: { $disconnect: () => Promise<void> },
  redisCacheConnection: { disconnect: () => void },
  redisPublisherConnection: { disconnect: () => void },
  configurationService: PostgresConfigurationService | undefined,
  costEngine: DefaultCostEngine | undefined,
  providerRegistry: InMemoryProviderRegistry | undefined,
): Promise<void> {
  if (providerRegistry) {
    try {
      providerRegistry.stop();
    } catch (cleanupError) {
      logger.error({ err: cleanupError }, "Error stopping ProviderRegistry during failed-startup cleanup");
    }
  }
  if (costEngine) {
    try {
      costEngine.stop();
    } catch (cleanupError) {
      logger.error({ err: cleanupError }, "Error stopping CostEngine during failed-startup cleanup");
    }
  }
  if (configurationService) {
    try {
      await configurationService.stop();
    } catch (cleanupError) {
      logger.error({ err: cleanupError }, "Error stopping ConfigurationService during failed-startup cleanup");
    }
  }
  try {
    await prisma.$disconnect();
  } catch (cleanupError) {
    logger.error({ err: cleanupError }, "Error disconnecting Prisma during failed-startup cleanup");
  }
  try {
    redisCacheConnection.disconnect();
  } catch (cleanupError) {
    logger.error({ err: cleanupError }, "Error disconnecting Redis (cache) during failed-startup cleanup");
  }
  try {
    redisPublisherConnection.disconnect();
  } catch (cleanupError) {
    logger.error({ err: cleanupError }, "Error disconnecting Redis (publisher) during failed-startup cleanup");
  }
}
