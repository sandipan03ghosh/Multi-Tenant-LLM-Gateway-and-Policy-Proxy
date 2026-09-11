// Request/response shapes for the Gateway's Public (/v1/*) and Admin (/admin/v1/*) HTTP APIs.
// Hand-authored, kept in sync by hand with packages/api/src/openapi/*.ts. `generate:types`
// (package.json) runs openapi-typescript as an optional drift check, outside src/.
// Never imports from @llm-gateway/domain, application, or any adapter package.

// --- Shared -----------------------------------------------------------------------------------

/** The `{code, message}` envelope every error response from this API returns. */
export interface GatewayErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

// --- Public API: /v1/models ---------------------------------------------------------------------

export interface ProviderModelMetadata {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly supportsStreaming: boolean;
}

export interface ListModelsResponse {
  readonly data: readonly ProviderModelMetadata[];
}

// --- Public API: /v1/chat/completions -------------------------------------------------------

export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly content: string;
}

/**
 * `provider` is optional — omitting it falls back to the tenant's stored RoutingPolicy
 * (server-side, currently restricted to a stored "manual" policy). No `stream` field — streaming
 * is content-negotiated via `Accept: text/event-stream`, toggled by `ChatCompletionStreamOptions`.
 */
export interface ChatCompletionRequest {
  readonly provider?: string;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

/** Second argument to createChatCompletion() that selects the streaming overload. */
export interface ChatCompletionStreamOptions {
  readonly stream: true;
}

export type FinishReason = "stop" | "length" | "content_filter" | "error";

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChatCompletionResponse {
  readonly id: string;
  readonly model: string;
  readonly message: ChatMessage;
  readonly usage: TokenUsage;
  readonly finishReason: FinishReason;
}

// Mirrors domain's CanonicalStreamEvent, except `error` — the wire format (SseStreamTransport)
// sends only the client-safe { code, message } pair, never a full GatewayError.
export type ChatCompletionStreamEvent =
  | { readonly type: "start"; readonly id: string; readonly model: string }
  | { readonly type: "delta"; readonly content: string }
  | { readonly type: "done"; readonly finishReason: FinishReason; readonly usage: TokenUsage }
  | { readonly type: "error"; readonly code: string; readonly message: string };

// --- Public API: /v1/batches -----------------------------------------------------------------

export type BatchRequestClass = "batch" | "background";
export type BatchRequestStatus = "pending" | "processing" | "succeeded" | "failed";

export interface CreateBatchRequest {
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly webhookUrl?: string;
  readonly requestClass?: BatchRequestClass;
}

export interface CreateBatchResponse {
  readonly id: string;
  readonly status: "pending";
}

export interface GetBatchResponse {
  readonly id: string;
  readonly status: BatchRequestStatus;
  readonly createdAt: string;
  readonly completedAt?: string;
  /** Present only when status is "succeeded" — the ChatCompletionResponse. */
  readonly result?: ChatCompletionResponse;
  /** Present only when status is "failed". */
  readonly error?: { readonly code: string; readonly message: string };
}

// --- Admin API: audit log -----------------------------------------------------------------------

export type AuditActorType = "user" | "api_key";

export interface AuditLogEntry {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
}

export interface ListAuditLogOptions {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListAuditLogResponse {
  readonly entries: readonly AuditLogEntry[];
  readonly nextCursor: string | null;
}

// --- Admin API: rate-limit / budget / routing policy resources ---------------------------------

export interface RateLimitPolicy {
  readonly capacity: number;
  readonly refillTokens: number;
  readonly refillIntervalMs: number;
}

export interface BudgetPolicy {
  readonly period: "daily" | "monthly";
  readonly hardLimitMicros: number;
  readonly softLimitMicros: number | null;
  readonly currency: string;
  readonly reservationMicros?: number;
}

export interface ProviderCandidate {
  readonly providerId: string;
  readonly modelId: string;
}

export interface WeightedProviderCandidate extends ProviderCandidate {
  readonly weight: number;
}

export interface ShadowRoutingConfig {
  readonly candidate: ProviderCandidate;
  readonly sampleRate: number;
}

interface RoutingPolicyBase {
  readonly shadow?: ShadowRoutingConfig;
}

export interface ManualRoutingPolicy extends RoutingPolicyBase {
  readonly type: "manual";
  readonly providerId: string;
}
export interface RoundRobinRoutingPolicy extends RoutingPolicyBase {
  readonly type: "round_robin";
  readonly cursorKey: string;
  readonly candidates: readonly ProviderCandidate[];
}
export interface WeightedRoutingPolicy extends RoutingPolicyBase {
  readonly type: "weighted";
  readonly candidates: readonly WeightedProviderCandidate[];
}
export interface HealthAwareRoutingPolicy extends RoutingPolicyBase {
  readonly type: "health_aware";
  readonly candidates: readonly ProviderCandidate[];
}
export interface StickyRoutingPolicy extends RoutingPolicyBase {
  readonly type: "sticky";
  readonly sessionKey: string;
  readonly candidates: readonly ProviderCandidate[];
  readonly pinTtlMs?: number;
}

export type RoutingPolicy =
  | ManualRoutingPolicy
  | RoundRobinRoutingPolicy
  | WeightedRoutingPolicy
  | HealthAwareRoutingPolicy
  | StickyRoutingPolicy;

/** GET response shape shared by every policy resource — null means unconfigured at every scope. */
export interface PolicyResponse<T> {
  readonly policy: T | null;
}

/** Optional query-string scoping shared by every policy resource's GET/PUT. */
export interface PolicyScopeOptions {
  readonly projectId?: string;
}

// --- Admin API: enrichment policy (six sub-resources, one value type each) ---------------------
// Mirrors the six shape validators in enrichment-config-keys.ts.

/** Ordered list of enabled stage names, e.g. ["system_prompt_injection", "compliance_policy"]. */
export type EnrichmentStages = readonly string[];

export type EnrichmentSystemPrompt = string;

export type EnrichmentDeniedTopics = readonly string[];

export type EnrichmentPiiRedactionEnabled = boolean;

export type ContentFilterFailureMode = "fail_open" | "fail_closed";

export type EnrichmentContentFilterTimeoutMs = number;

// --- Admin API: providers ------------------------------------------------------------------------

export interface ProviderStatus {
  readonly providerId: string;
  readonly enabled: boolean;
}

export interface ListProvidersResponse {
  readonly providers: readonly ProviderStatus[];
}

// --- Admin API: alert channels ------------------------------------------------------------------

/** `url` is always redacted to protocol+host by the server — never the full stored value. */
export interface AlertChannel {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAlertChannelRequest {
  readonly name: string;
  readonly url: string;
  readonly enabled?: boolean;
}

export interface UpdateAlertChannelRequest {
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
}

export interface ListAlertChannelsResponse {
  readonly alertChannels: readonly AlertChannel[];
}

export interface SingleAlertChannelResponse {
  readonly alertChannel: AlertChannel;
}
