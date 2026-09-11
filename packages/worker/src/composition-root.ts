import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPrismaClient,
  PostgresJobScheduler,
  PrismaBatchRequestRepository,
  PrismaConfigurationRepository,
  PrismaCostLedgerRepository,
  PrismaAlertChannelConfigRepository,
} from "@llm-gateway/adapters-postgres";
import {
  createRedisClient,
  RedisCircuitBreaker,
  RedisHealthTracker,
  RedisRoundRobinRoutingStrategy,
  RedisStickyRoutingStrategy,
  RedisRequestScheduler,
  RedisDistributedCache,
  RedisPubSub,
  RedisBudgetCounterStore,
} from "@llm-gateway/adapters-redis";
import { GeminiProviderAdapter } from "@llm-gateway/adapters-provider-gemini";
import { GroqProviderAdapter } from "@llm-gateway/adapters-provider-groq";
import { EnvVarSecretStore } from "@llm-gateway/adapters-security";
import { logger, metricsRegistry, Gauge } from "@llm-gateway/adapters-observability";
import {
  InMemoryProviderRegistry,
  ManualRoutingStrategy,
  WeightedRoutingStrategy,
  HealthAwareRoutingStrategy,
  HealthAwareProviderScorer,
  DefaultRoutingEngine,
  ExponentialBackoffRetryPolicy,
  DefaultShadowTrafficDispatcher,
  PostgresConfigurationService,
  DefaultBudgetEnforcer,
  DefaultAlertPublisher,
  PersistentWebhookAlertChannel,
} from "@llm-gateway/application";
import type { ProviderPort, ProviderModelMetadata, RoutingStrategy, AlertChannel } from "@llm-gateway/domain";
import { checkReadiness, buildVersionInfo } from "./health/health-checks.js";
import type { ReadinessResult, VersionInfo } from "./health/health-checks.js";
import type { Env } from "./config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Reads the package's own version at startup; fs.readFileSync avoids a resolveJsonModule dependency.
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as { version: string };

// Bounded (provider, model) set for the circuit_breaker_state gauge to report on — not for
// routing/catalog, which the worker doesn't have.
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

export interface WorkerComposition {
  readonly jobScheduler: PostgresJobScheduler;
  readonly routingEngine: DefaultRoutingEngine;
  readonly requestScheduler: RedisRequestScheduler;
  readonly batchRequestRepository: PrismaBatchRequestRepository;
  readonly budgetEnforcer: DefaultBudgetEnforcer;
  readonly checkReadiness: () => Promise<ReadinessResult>;
  readonly versionInfo: VersionInfo;
  readonly shutdown: () => Promise<void>;
}

// The worker's composition root — mirrors the API's routing/resilience wiring (to execute a
// dequeued request), but omits enrichment/auth: a ScheduledRequest's canonicalRequest is already
// enriched, and the worker serves no HTTP. ConfigurationService is still needed — for
// DefaultBudgetEnforcer.reconcile() and for provider enable/disable subscriptions, since the
// worker re-executes routing independently and must honor an admin-disabled provider.
export async function buildWorkerComposition(env: Env): Promise<WorkerComposition> {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redisConnection = createRedisClient(env.REDIS_URL);
  const redisPublisherConnection = createRedisClient(env.REDIS_URL);

  // Set after configurationService.start(); /ready reads it through a closure (ConfigurationService
  // has no isReady() of its own).
  let configurationReady = false;

  // If anything below throws after these resources exist, tear them down before propagating —
  // otherwise a failed startup leaks DB/Redis connections and ConfigurationService subscriptions.
  let configurationService: PostgresConfigurationService | undefined;
  let providerRegistry: InMemoryProviderRegistry | undefined;
  try {
    const configurationRepository = new PrismaConfigurationRepository(prisma);
    const distributedCache = new RedisDistributedCache(redisConnection);
    const configPubSub = new RedisPubSub(redisPublisherConnection);
    configurationService = new PostgresConfigurationService(configurationRepository, distributedCache, configPubSub);
    await configurationService.start();
    configurationReady = true;

    // Built from this process's validated Env, never from process.env directly.
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
    if (providers.length === 0) {
      throw new Error("No provider adapters constructed — this should be unreachable given env.ts's validation.");
    }
    // Outer `let` so teardownOnFailedStartup can stop() it on a later throw. Awaited before returning.
    providerRegistry = new InMemoryProviderRegistry(providers, configurationService);
    await providerRegistry.start();

    // Built before the circuit breaker/health tracker: both take an AlertPublisher that needs a
    // JobEnqueuer. The worker is both producer and consumer of budget_reconcile jobs (the API only
    // enqueues them).
    const jobScheduler = new PostgresJobScheduler(prisma);
    // The worker builds its own AlertPublisher for its own circuit-breaker/health/budget alerts.
    const alertChannelConfigRepository = new PrismaAlertChannelConfigRepository(prisma);
    const alertChannels: AlertChannel[] = [new PersistentWebhookAlertChannel(alertChannelConfigRepository, jobScheduler)];
    const alertPublisher = new DefaultAlertPublisher(alertChannels);

    // Shared connection is safe: none of these issue a blocking command or WATCH/MULTI on it
    // directly — the transactional ones call .duplicate() for their own transaction.
    const circuitBreaker = new RedisCircuitBreaker(redisConnection, alertPublisher);
    const healthTracker = new RedisHealthTracker(redisConnection, alertPublisher);
    const scorer = new HealthAwareProviderScorer(healthTracker);
    const strategies = new Map<string, RoutingStrategy>([
      ["manual", new ManualRoutingStrategy()],
      ["round_robin", new RedisRoundRobinRoutingStrategy(redisConnection)],
      ["weighted", new WeightedRoutingStrategy()],
      ["health_aware", new HealthAwareRoutingStrategy()],
      ["sticky", new RedisStickyRoutingStrategy(redisConnection)],
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

    const requestScheduler = new RedisRequestScheduler(redisConnection);
    const batchRequestRepository = new PrismaBatchRequestRepository(prisma);

    const costLedgerRepository = new PrismaCostLedgerRepository(prisma);
    const budgetCounterStore = new RedisBudgetCounterStore(redisConnection);
    const budgetEnforcer = new DefaultBudgetEnforcer(configurationService, budgetCounterStore, costLedgerRepository, jobScheduler, alertPublisher);

    // Same gauges as the API process, registered into this process's metricsRegistry — Prometheus
    // scrapes api and worker as separate targets even though both read the same Redis state.
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
    const activeProviderRegistry = providerRegistry;
    return {
      jobScheduler,
      routingEngine,
      requestScheduler,
      batchRequestRepository,
      budgetEnforcer,
      checkReadiness: () => checkReadiness(prisma, redisConnection, () => configurationReady),
      versionInfo: buildVersionInfo(packageJson.version, env.NODE_ENV, env.GIT_COMMIT_SHA),
      shutdown: async () => {
        activeProviderRegistry.stop();
        jobScheduler.stop();
        await activeConfigurationService.stop();
        await prisma.$disconnect();
        redisConnection.disconnect();
        redisPublisherConnection.disconnect();
      },
    };
  } catch (error) {
    await teardownOnFailedStartup(prisma, redisConnection, redisPublisherConnection, configurationService, providerRegistry);
    throw error;
  }
}

// Best-effort cleanup after a failed startup — each step independently guarded so one failure
// doesn't block the others, and none masks the original startup error.
async function teardownOnFailedStartup(
  prisma: { $disconnect: () => Promise<void> },
  redisConnection: { disconnect: () => void },
  redisPublisherConnection: { disconnect: () => void },
  configurationService: PostgresConfigurationService | undefined,
  providerRegistry: InMemoryProviderRegistry | undefined,
): Promise<void> {
  if (providerRegistry) {
    try {
      providerRegistry.stop();
    } catch (cleanupError) {
      logger.error({ err: cleanupError }, "Error stopping ProviderRegistry during failed worker-startup cleanup");
    }
  }
  if (configurationService) {
    try {
      await configurationService.stop();
    } catch (cleanupError) {
      logger.error({ err: cleanupError }, "Error stopping ConfigurationService during failed worker-startup cleanup");
    }
  }
  try {
    await prisma.$disconnect();
  } catch (cleanupError) {
    logger.error({ err: cleanupError }, "Error disconnecting Prisma during failed worker-startup cleanup");
  }
  try {
    redisConnection.disconnect();
  } catch (cleanupError) {
    logger.error({ err: cleanupError }, "Error disconnecting Redis during failed worker-startup cleanup");
  }
  try {
    redisPublisherConnection.disconnect();
  } catch (cleanupError) {
    logger.error({ err: cleanupError }, "Error disconnecting Redis (publisher) during failed worker-startup cleanup");
  }
}
