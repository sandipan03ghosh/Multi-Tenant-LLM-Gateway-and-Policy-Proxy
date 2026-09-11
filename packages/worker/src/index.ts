import { logger, configureLogger, initTracing, shutdownTracing, startMetricsServer } from "@llm-gateway/adapters-observability";
import type { RouteHandler } from "@llm-gateway/adapters-observability";
import { loadEnv } from "./config/env.js";
import { buildWorkerComposition } from "./composition-root.js";
import { createProcessScheduledRequestHandler } from "./jobs/process-scheduled-request.handler.js";
import { createDeliverWebhookHandler } from "./jobs/deliver-webhook.handler.js";
import { createBudgetReconcileHandler } from "./jobs/budget-reconcile.handler.js";
import { DrainLoop } from "./scheduling/drain-loop.js";
import type { ReadinessResult, VersionInfo } from "./health/health-checks.js";

// Upper bound on how long shutdown waits for composition.shutdown() before moving on regardless,
// so a single hung dependency can't block the tracing flush / process exit that follow.
const SHUTDOWN_TIMEOUT_MS = 10_000;

// The same four operational routes as the API, served on the worker's one bare HTTP server
// (startMetricsServer's extraRoutes) — the worker has no other HTTP surface.
function buildHealthRoutes(checkReadiness: () => Promise<ReadinessResult>, versionInfo: VersionInfo): Record<string, RouteHandler> {
  const respondJson = (res: Parameters<RouteHandler>[1], status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  return {
    "/health": (_req, res) => respondJson(res, 200, { status: "ok" }),
    // Liveness: never touches Postgres/Redis. Always 200 while the process can respond.
    "/live": (_req, res) => respondJson(res, 200, { status: "ok" }),
    "/ready": async (_req, res) => {
      const result = await checkReadiness();
      respondJson(res, result.ready ? 200 : 503, result);
    },
    "/version": (_req, res) => respondJson(res, 200, versionInfo),
  };
}

async function main(): Promise<void> {
  // Registered before anything else, including loadEnv() — initTracing() needs no validated config.
  initTracing("gateway-worker");

  const env = loadEnv();
  configureLogger(env.LOG_LEVEL);
  const composition = await buildWorkerComposition(env);

  composition.jobScheduler.registerHandler(
    "process_scheduled_request",
    createProcessScheduledRequestHandler(composition.routingEngine, composition.batchRequestRepository, composition.jobScheduler),
  );
  composition.jobScheduler.registerHandler(
    "deliver_webhook",
    // allowInsecureHttp is a dev/test convenience only — never set outside development.
    createDeliverWebhookHandler({ allowInsecureHttp: env.NODE_ENV !== "production" }),
  );
  composition.jobScheduler.registerHandler(
    "budget_reconcile",
    createBudgetReconcileHandler(composition.budgetEnforcer, composition.jobScheduler),
  );
  composition.jobScheduler.start();

  const drainLoop = new DrainLoop(composition.requestScheduler, composition.jobScheduler, composition.batchRequestRepository);
  drainLoop.start();

  // The worker's HTTP surface — a bare server exposing /metrics plus /health, /live, /ready,
  // /version. Started after buildWorkerComposition() so gauges and readiness state are in place.
  const metricsServer = startMetricsServer(
    env.METRICS_PORT,
    buildHealthRoutes(composition.checkReadiness, composition.versionInfo),
  );
  logger.info(`Metrics/health server listening on port ${env.METRICS_PORT}`);

  logger.info("Worker started: polling for jobs and draining the scheduled-request queue.");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down...`);

    drainLoop.stop();
    try {
      // Raced against SHUTDOWN_TIMEOUT_MS so a hung dependency can't block the steps that follow.
      await Promise.race([
        composition.shutdown(),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            logger.warn(`composition.shutdown() did not complete within ${SHUTDOWN_TIMEOUT_MS}ms — proceeding with shutdown anyway`);
            resolve();
          }, SHUTDOWN_TIMEOUT_MS).unref();
        }),
      ]);
    } catch (error) {
      logger.error({ err: error }, "Error during worker shutdown");
    }

    // Closed here in the shutdown handler, not left for process exit.
    await new Promise<void>((resolve) => metricsServer.close(() => resolve()));

    // Flushes BatchSpanProcessor's buffered spans, otherwise the last batch is dropped on exit.
    try {
      await shutdownTracing();
    } catch (error) {
      logger.error({ err: error }, "Error flushing tracing during shutdown");
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "Fatal startup error");
  process.exit(1);
});
