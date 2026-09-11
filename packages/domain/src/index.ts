// Domain layer — entities, value objects, and port interfaces.
// This package must never import from any adapters-* package, api, worker, or any SDK/CLI.

export { ConfigScope, GLOBAL_CONFIG_SCOPE_ID } from "./value-objects/config-scope.js";
export type { TenantScope } from "./value-objects/config-scope.js";
export { toConfigKey } from "./value-objects/config-key.js";
export type { ConfigKey } from "./value-objects/config-key.js";

export type {
  ConfigurationRecord,
  ConfigurationRepository,
} from "./ports/configuration-repository.port.js";
export type { DistributedCache } from "./ports/distributed-cache.port.js";
export type { PubSub, PubSubHandler, PubSubUnsubscribe } from "./ports/pub-sub.port.js";
export type {
  ConfigurationService,
  ConfigChangeHandler,
  ConfigSubscriptionUnsubscribe,
} from "./ports/configuration-service.port.js";
export type { ConfigurationWriter } from "./ports/configuration-writer.port.js";

export { ConfigurationNotFoundError } from "./errors/configuration-not-found.error.js";
export { DomainValidationError } from "./errors/domain-validation.error.js";

// --- Tenancy: value objects ---
export {
  toOrganizationId,
  toProjectId,
  toUserId,
  toApiKeyId,
  toRoleId,
  toPermissionId,
  toAlertChannelConfigId,
} from "./value-objects/ids.js";
export type {
  OrganizationId,
  ProjectId,
  UserId,
  ApiKeyId,
  RoleId,
  PermissionId,
  AlertChannelConfigId,
} from "./value-objects/ids.js";
export { RoleScope } from "./value-objects/role-scope.js";

// --- Tenancy: entities ---
export { Organization } from "./entities/organization.entity.js";
export type { OrganizationProps } from "./entities/organization.entity.js";
export { Project } from "./entities/project.entity.js";
export type { ProjectProps } from "./entities/project.entity.js";
export { User } from "./entities/user.entity.js";
export type { UserProps } from "./entities/user.entity.js";
export { ApiKey } from "./entities/api-key.entity.js";
export type { ApiKeyProps } from "./entities/api-key.entity.js";
export { Role } from "./entities/role.entity.js";
export type { RoleProps } from "./entities/role.entity.js";
export { Permission } from "./entities/permission.entity.js";
export type { PermissionProps } from "./entities/permission.entity.js";

// --- Tenancy: repository ports ---
export type { OrganizationRepository } from "./ports/organization-repository.port.js";
export type { ProjectRepository } from "./ports/project-repository.port.js";
export type { UserRepository } from "./ports/user-repository.port.js";
export type { ApiKeyRepository } from "./ports/api-key-repository.port.js";
export type { RoleRepository } from "./ports/role-repository.port.js";
export type { PermissionRepository } from "./ports/permission-repository.port.js";
export type {
  UserRoleAssignment,
  UserRoleAssignmentRepository,
} from "./ports/user-role-assignment-repository.port.js";
export type {
  ApiKeyRoleAssignment,
  ApiKeyRoleAssignmentRepository,
} from "./ports/api-key-role-assignment-repository.port.js";
export type { RolePermissionRepository } from "./ports/role-permission-repository.port.js";

// --- Provider abstraction ---
export type { MessageRole, CanonicalMessage, CanonicalRequest } from "./value-objects/canonical-request.js";
export type { TokenUsage, FinishReason, CanonicalResponse } from "./value-objects/canonical-response.js";
export type { CanonicalStreamEvent } from "./value-objects/canonical-stream-event.js";
export type { ProviderModelMetadata } from "./value-objects/provider-model-metadata.js";
export { GatewayError } from "./errors/gateway.error.js";
export { ProviderNotFoundError } from "./errors/provider-not-found.error.js";
export { ProviderModelNotFoundError } from "./errors/provider-model-not-found.error.js";
export type { ProviderPort } from "./ports/provider.port.js";
export type { ProviderCatalog } from "./ports/provider-catalog.port.js";
export type { ProviderRegistry } from "./ports/provider-registry.port.js";

// --- Routing ---
export type {
  ManualRoutingPolicy,
  RoundRobinRoutingPolicy,
  WeightedRoutingPolicy,
  HealthAwareRoutingPolicy,
  StickyRoutingPolicy,
  RoutingPolicy,
} from "./value-objects/routing-policy.js";
export type { ProviderCandidate, RankedCandidate, WeightedCandidate } from "./value-objects/provider-candidate.js";
export type { ShadowRoutingConfig } from "./value-objects/shadow-routing-config.js";
export type { ShadowTrafficDispatcher } from "./ports/shadow-traffic-dispatcher.port.js";
export type { RoutingStrategy } from "./ports/routing-strategy.port.js";
export type { ProviderScorer } from "./ports/provider-scorer.port.js";
export type { RoutingEngine } from "./ports/routing-engine.port.js";
export { NoAvailableProviderError } from "./errors/no-available-provider.error.js";
export { RoutingStrategyNotFoundError } from "./errors/routing-strategy-not-found.error.js";

// --- Streaming ---
export type { StreamTransport, RequestContext, StreamHandle, CloseReason } from "./ports/stream-transport.port.js";

// --- Authentication ---
export type { AuthSubjectType, TenantContext } from "./value-objects/tenant-context.js";
export type { JwtClaims } from "./value-objects/jwt-claims.js";
export type { JwtService } from "./ports/jwt-service.port.js";
export type { ApiKeyHasher } from "./ports/api-key-hasher.port.js";
export { AuthenticationError } from "./errors/authentication.error.js";

// --- Resilience ---
export type { CircuitBreakerState, CircuitBreakerCheckResult } from "./value-objects/circuit-breaker-state.js";
export type { CircuitBreaker } from "./ports/circuit-breaker.port.js";
export type { HealthTracker } from "./ports/health-tracker.port.js";
export type { RetryPolicy } from "./ports/retry-policy.port.js";

// --- Request Enrichment Pipeline ---
export type { EnrichmentResult } from "./value-objects/enrichment-result.js";
export type { EnrichmentStage } from "./ports/enrichment-stage.port.js";
export type { RequestEnrichmentPipeline } from "./ports/enrichment-pipeline.port.js";
export type { ContentModerationPort, ModerationVerdict } from "./ports/content-moderation.port.js";

// --- Background Workers & Job Scheduling ---
export type { JobDefinition, ScheduleOptions, JobHandle, JobHandler } from "./value-objects/job.js";
export type { JobScheduler } from "./ports/job-scheduler.port.js";

// --- Request Scheduling & Priority Queue ---
export type { RequestClass, ScheduledRequest } from "./value-objects/scheduled-request.js";
export type { AdmissionDecision } from "./value-objects/admission-decision.js";
export type { QueueTicket, SchedulingCapacity } from "./value-objects/queue-ticket.js";
export type { RequestScheduler, DequeuedRequest } from "./ports/request-scheduler.port.js";

// --- Batch API ---
export type { BatchRequestStatus, BatchRequestRecord, CreateBatchRequestInput } from "./value-objects/batch-request.js";
export type { BatchRequestRepository } from "./ports/batch-request-repository.port.js";

// --- Audit Log ---
export type { AuditActorType, AuditLogEntry, CreateAuditLogEntryInput } from "./value-objects/audit-log-entry.js";
export type { AuditLogRepository, AuditLogListOptions, AuditLogPage } from "./ports/audit-log-repository.port.js";

// --- Rate Limiting ---
export type { RateLimitPolicy, RateLimitResult } from "./value-objects/rate-limit-policy.js";
export type { RateLimitAlgorithm } from "./ports/rate-limit-algorithm.port.js";

// --- Cost Engine ---
export type { CostBreakdown } from "./value-objects/cost-breakdown.js";
export type { CostLedgerEntry, CreateCostLedgerEntryInput } from "./value-objects/cost-ledger-entry.js";
export type { CostEngine } from "./ports/cost-engine.port.js";
export type { CostLedgerRepository } from "./ports/cost-ledger-repository.port.js";

// --- Budget Enforcement ---
export type { BudgetPolicy } from "./value-objects/budget-policy.js";
export type { BudgetCheckResult } from "./value-objects/budget-check-result.js";
export type { BudgetCounterStore } from "./ports/budget-counter-store.port.js";
export { BudgetCounterNotFoundError } from "./errors/budget-counter-not-found.error.js";
export type { JobEnqueuer } from "./ports/job-enqueuer.port.js";

// --- Secrets & Request Signing ---
export type { SecretStore } from "./ports/secret-store.port.js";
export type { ReplayCache } from "./ports/replay-cache.port.js";

// --- Alerting ---
export type { AlertSeverity, DomainAlertEvent } from "./value-objects/domain-alert-event.js";
export type { AlertPublisher } from "./ports/alert-publisher.port.js";
export type { AlertChannel } from "./ports/alert-channel.port.js";
export { AlertChannelConfig } from "./entities/alert-channel-config.entity.js";
export type { AlertChannelConfigProps } from "./entities/alert-channel-config.entity.js";
export type { AlertChannelConfigRepository } from "./ports/alert-channel-config-repository.port.js";
