import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";

// One process-wide Registry — every metric here plus composition-root gauges is exposed from the
// single /metrics endpoint.
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

// LLM completions run for seconds — prom-client's default ms-scale buckets would put almost
// every request in the +Inf bucket and make histogram_quantile() meaningless.
const LATENCY_BUCKETS_SECONDS = [0.1, 0.5, 1, 2, 5, 10, 30, 60];

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled, by method/route/status.",
  labelNames: ["method", "route", "status"] as const,
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds, by method/route/status.",
  labelNames: ["method", "route", "status"] as const,
  buckets: LATENCY_BUCKETS_SECONDS,
  registers: [metricsRegistry],
});

export const providerRequestsTotal = new Counter({
  name: "provider_requests_total",
  help: "Total provider requests, by provider/model/outcome.",
  labelNames: ["provider", "model", "outcome"] as const,
  registers: [metricsRegistry],
});

export const providerRequestDurationSeconds = new Histogram({
  name: "provider_request_duration_seconds",
  help: "Provider request duration in seconds (time to first response/event), by provider/model/outcome.",
  labelNames: ["provider", "model", "outcome"] as const,
  buckets: LATENCY_BUCKETS_SECONDS,
  registers: [metricsRegistry],
});

// Gateway-wide, unlabeled by org/project — labeling by raw tenant id is unbounded label
// cardinality. Per-tenant detail belongs in the cost ledger or a reporting API, not Prometheus.
export const rateLimitRejectionsTotal = new Counter({
  name: "rate_limit_rejections_total",
  help: "Total requests rejected by rate limiting. Gateway-wide, not labeled by tenant — see this file's cardinality note.",
  registers: [metricsRegistry],
});

// "Remaining budget" is inherently per-tenant, so a gateway-wide gauge of it has no meaningful
// value. A checks-by-outcome counter is the closest cardinality-safe gateway-wide signal.
export const budgetChecksTotal = new Counter({
  name: "budget_checks_total",
  help: "Total budget checks, by outcome (allowed/rejected). Gateway-wide, not labeled by tenant — see this file's cardinality note.",
  labelNames: ["outcome"] as const,
  registers: [metricsRegistry],
});

// Incremented by DefaultAlertPublisher on every publish(). `type` is a small fixed set of alert
// strings this codebase defines — not user input, so no cardinality risk.
export const domainAlertsTotal = new Counter({
  name: "domain_alerts_total",
  help: "Total DomainAlertEvents published, by type/severity.",
  labelNames: ["type", "severity"] as const,
  registers: [metricsRegistry],
});
