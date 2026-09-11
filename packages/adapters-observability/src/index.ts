// Observability adapter — OpenTelemetry tracing, Prometheus metrics, structured logging.
// Depends on @llm-gateway/domain only.
export { logger, configureLogger } from "./logging/logger.js";
export { runWithRequestId, getCurrentRequestId } from "./logging/request-context.js";
export { initTracing, shutdownTracing } from "./tracing/tracer.js";
export {
  withSpan,
  withProviderSpan,
  startManualSpan,
  runInSpanContext,
  endSpanWithOutcome,
  extractTraceContext,
} from "./tracing/with-span.js";
export type { Span } from "./tracing/with-span.js";
export {
  metricsRegistry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  providerRequestsTotal,
  providerRequestDurationSeconds,
  rateLimitRejectionsTotal,
  budgetChecksTotal,
  domainAlertsTotal,
} from "./metrics/registry.js";
export { startMetricsServer } from "./metrics/server.js";
export type { RouteHandler } from "./metrics/server.js";
// Re-exported so composition roots don't need their own prom-client dependency for the Gauge constructor.
export { Gauge } from "prom-client";
