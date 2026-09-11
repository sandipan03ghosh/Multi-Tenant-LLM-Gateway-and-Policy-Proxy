// Application layer — use-case orchestration. May depend on @llm-gateway/domain only; must never
// import a concrete adapter, api, worker, or any SDK/CLI package.

export { PostgresConfigurationService } from "./configuration/postgres-configuration.service.js";
export { ConfigurationWriterService } from "./configuration/configuration-writer.service.js";
export {
  CONFIG_INVALIDATION_CHANNEL,
  buildCacheKey,
  encodeInvalidationMessage,
  decodeInvalidationMessage,
} from "./configuration/configuration-cache-keys.js";
export type { ConfigInvalidationMessage } from "./configuration/configuration-cache-keys.js";

export { StaticProviderCatalog } from "./providers/static-provider-catalog.js";
export { InMemoryProviderRegistry } from "./providers/in-memory-provider-registry.js";
export { providerEnabledConfigKey } from "./providers/provider-config-keys.js";

export { ManualRoutingStrategy } from "./routing/manual-routing-strategy.js";
export { WeightedRoutingStrategy } from "./routing/weighted-routing-strategy.js";
export { HealthAwareRoutingStrategy } from "./routing/health-aware-routing-strategy.js";
export { PassthroughProviderScorer } from "./routing/passthrough-provider-scorer.js";
export { HealthAwareProviderScorer } from "./routing/health-aware-provider-scorer.js";
export { DefaultRoutingEngine } from "./routing/default-routing-engine.js";
export { ExponentialBackoffRetryPolicy } from "./routing/exponential-backoff-retry-policy.js";
export type { ExponentialBackoffRetryPolicyConfig } from "./routing/exponential-backoff-retry-policy.js";
export { DefaultShadowTrafficDispatcher } from "./routing/default-shadow-traffic-dispatcher.js";
export { ROUTING_POLICY_CONFIG_KEY, isValidRoutingPolicyShape } from "./routing/routing-policy-shape.js";

export { ApiKeyAuthenticator } from "./auth/api-key-authenticator.js";
export { JwtAuthenticator } from "./auth/jwt-authenticator.js";

export {
  ENRICHMENT_STAGES_CONFIG_KEY,
  SYSTEM_PROMPT_TEXT_CONFIG_KEY,
  COMPLIANCE_DENIED_TOPICS_CONFIG_KEY,
  COMPLIANCE_PII_REDACTION_ENABLED_CONFIG_KEY,
  CONTENT_FILTER_FAILURE_MODE_CONFIG_KEY,
  CONTENT_FILTER_TIMEOUT_MS_CONFIG_KEY,
  DEFAULT_CONTENT_FILTER_FAILURE_MODE,
  DEFAULT_CONTENT_FILTER_TIMEOUT_MS,
  toTenantScope,
  isValidStageListShape,
  isValidSystemPromptShape,
  isValidDeniedTopicsShape,
  isValidPiiRedactionEnabledShape,
  isValidContentFilterFailureModeShape,
  isValidContentFilterTimeoutMsShape,
} from "./enrichment/enrichment-config-keys.js";
export type { ContentFilterFailureMode } from "./enrichment/enrichment-config-keys.js";
export { SystemPromptInjectionStage } from "./enrichment/system-prompt-injection.stage.js";
export { CompliancePolicyStage } from "./enrichment/compliance-policy.stage.js";
export { ContentFilterStage } from "./enrichment/content-filter.stage.js";
export { NoOpContentModerationPort } from "./enrichment/no-op-content-moderation.js";
export { DefaultRequestEnrichmentPipeline } from "./enrichment/default-request-enrichment-pipeline.js";

export { RATE_LIMIT_POLICY_CONFIG_KEY } from "./rate-limiting/rate-limit-config-keys.js";
export { DefaultRateLimiter, isValidPolicyShape } from "./rate-limiting/default-rate-limiter.js";

export { PRICING_TABLE_CONFIG_KEY, pricingKey, isValidPricingTable } from "./cost/pricing-config-keys.js";
export type { PricingTableEntry, PricingTable } from "./cost/pricing-config-keys.js";
export { DefaultCostEngine } from "./cost/default-cost-engine.js";

export { BUDGET_POLICY_CONFIG_KEY } from "./budget/budget-config-keys.js";
export { resolvePeriod } from "./budget/budget-period.js";
export type { ResolvedPeriod } from "./budget/budget-period.js";
export { DefaultBudgetEnforcer, RECONCILE_INTERVAL_MS, isValidBudgetPolicyShape } from "./budget/default-budget-enforcer.js";
export type { BudgetReservation } from "./budget/default-budget-enforcer.js";

export { REQUEST_SIGNING_ENABLED_CONFIG_KEY, projectSigningKeySecretKey } from "./security/request-signing-config-keys.js";
export { DefaultRequestSignatureVerifier } from "./security/default-request-signature-verifier.js";
export type { SignatureVerificationResult } from "./security/default-request-signature-verifier.js";

export { DefaultAlertPublisher } from "./alerting/default-alert-publisher.js";
export { PersistentWebhookAlertChannel } from "./alerting/persistent-webhook-alert-channel.js";
