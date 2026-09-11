import { logger, configureLogger, initTracing, shutdownTracing, startMetricsServer } from "@llm-gateway/adapters-observability";
import { loadEnv } from "./config/env.js";
import { buildComposition } from "./composition-root.js";
import { createApp } from "./app.js";

// Upper bound on how long shutdown waits for in-flight requests before moving on regardless —
// so a single connection that never completes can't hang the whole shutdown path.
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  // Registered before anything else, including loadEnv() — initTracing() needs no validated config.
  initTracing("gateway-api");

  const env = loadEnv();
  configureLogger(env.LOG_LEVEL);
  const composition = await buildComposition(env);
  const app = createApp(composition);

  const server = app.listen(env.API_PORT, () => {
    logger.info(`Gateway API listening on port ${env.API_PORT}`);
  });

  // Separate port, separate bare server — started after buildComposition() so its gauges are in
  // place before Prometheus can scrape them.
  const metricsServer = startMetricsServer(env.METRICS_PORT);
  logger.info(`Metrics server listening on port ${env.METRICS_PORT}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down...`);

    try {
      // server.close() stops accepting new connections and calls back once in-flight requests
      // finish, so an active request never loses its DB/cache connection mid-flight. Raced against
      // SHUTDOWN_TIMEOUT_MS so a stuck connection can't block shutdown forever.
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            logger.warn(`server.close() did not complete within ${SHUTDOWN_TIMEOUT_MS}ms — proceeding with shutdown anyway`);
            resolve();
          }, SHUTDOWN_TIMEOUT_MS).unref();
        }),
      ]);
    } finally {
      // Always attempted, even if server.close() failed or timed out.
      await composition.shutdown();
    }

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
