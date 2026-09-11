"""Request/response shapes for the Gateway's Public (/v1/*) and Admin (/admin/v1/*) HTTP APIs.

Hand-authored, mirroring sdk-node's src/types.ts. Field names match the JSON wire format exactly
(camelCase), not snake_case, to avoid a conversion layer that could mis-map a field. Every
dataclass is frozen. Request dataclasses use `Optional[X] = None` for an omittable field (dropped
from the body, not sent as null); response dataclasses use `Optional[X]` without a default for a
field that's always present but may be null.

Depends on nothing but the Python standard library.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Literal, Optional, TypeVar

# --- Shared -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class GatewayErrorPayload:
    """The {code, message} envelope every error response from this API returns."""

    code: str
    message: str
    details: Optional[dict] = None


# --- Public API: /v1/models ---------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderModelMetadata:
    providerId: str
    modelId: str
    displayName: str
    contextWindowTokens: int
    maxOutputTokens: int
    supportsStreaming: bool


@dataclass(frozen=True)
class ListModelsResponse:
    data: list[ProviderModelMetadata]


# --- Public API: /v1/chat/completions -------------------------------------------------------

ChatMessageRole = Literal["system", "user", "assistant"]


@dataclass(frozen=True)
class ChatMessage:
    role: ChatMessageRole
    content: str


@dataclass(frozen=True)
class ChatCompletionRequest:
    """`provider` is optional -- omitting it falls back to the tenant's stored RoutingPolicy
    (server-side, currently restricted to a stored "manual" policy). No `stream` field --
    streaming is content-negotiated via `Accept: text/event-stream`, toggled by GatewayClient's
    own `stream` keyword argument.
    """

    model: str
    messages: list[ChatMessage]
    provider: Optional[str] = None
    temperature: Optional[float] = None
    maxOutputTokens: Optional[int] = None


FinishReason = Literal["stop", "length", "content_filter", "error"]


@dataclass(frozen=True)
class TokenUsage:
    promptTokens: int
    completionTokens: int
    totalTokens: int


@dataclass(frozen=True)
class ChatCompletionResponse:
    id: str
    model: str
    message: ChatMessage
    usage: TokenUsage
    finishReason: FinishReason


# Mirrors sdk-node's ChatCompletionStreamEvent union, except `error` -- the wire format sends only
# the client-safe {code, message} pair. Each variant is its own frozen dataclass; streaming.py
# yields whichever matches the frame's "type" field.
@dataclass(frozen=True)
class ChatCompletionStartEvent:
    type: Literal["start"]
    id: str
    model: str


@dataclass(frozen=True)
class ChatCompletionDeltaEvent:
    type: Literal["delta"]
    content: str


@dataclass(frozen=True)
class ChatCompletionDoneEvent:
    type: Literal["done"]
    finishReason: FinishReason
    usage: TokenUsage


@dataclass(frozen=True)
class ChatCompletionErrorEvent:
    type: Literal["error"]
    code: str
    message: str


ChatCompletionStreamEvent = (
    ChatCompletionStartEvent | ChatCompletionDeltaEvent | ChatCompletionDoneEvent | ChatCompletionErrorEvent
)

# --- Public API: /v1/batches -----------------------------------------------------------------

BatchRequestClass = Literal["batch", "background"]
BatchRequestStatus = Literal["pending", "processing", "succeeded", "failed"]


@dataclass(frozen=True)
class CreateBatchRequest:
    provider: str
    model: str
    messages: list[ChatMessage]
    temperature: Optional[float] = None
    maxOutputTokens: Optional[int] = None
    webhookUrl: Optional[str] = None
    requestClass: Optional[BatchRequestClass] = None


@dataclass(frozen=True)
class CreateBatchResponse:
    id: str
    status: Literal["pending"]


@dataclass(frozen=True)
class BatchError:
    code: str
    message: str


@dataclass(frozen=True)
class GetBatchResponse:
    id: str
    status: BatchRequestStatus
    createdAt: str
    completedAt: Optional[str] = None
    # Present only when status is "succeeded" -- the ChatCompletionResponse.
    result: Optional[ChatCompletionResponse] = None
    # Present only when status is "failed".
    error: Optional[BatchError] = None


# --- Admin API: audit log -----------------------------------------------------------------------

AuditActorType = Literal["user", "api_key"]


@dataclass(frozen=True)
class AuditLogEntry:
    id: str
    organizationId: str
    projectId: Optional[str]
    actorType: AuditActorType
    actorId: str
    action: str
    targetType: Optional[str]
    targetId: Optional[str]
    metadata: Optional[dict]
    createdAt: str


@dataclass(frozen=True)
class ListAuditLogOptions:
    limit: Optional[int] = None
    cursor: Optional[str] = None


@dataclass(frozen=True)
class ListAuditLogResponse:
    entries: list[AuditLogEntry]
    nextCursor: Optional[str]


# --- Admin API: rate-limit / budget / routing policy resources ---------------------------------


@dataclass(frozen=True)
class RateLimitPolicy:
    capacity: float
    refillTokens: float
    refillIntervalMs: float


@dataclass(frozen=True)
class BudgetPolicy:
    period: Literal["daily", "monthly"]
    hardLimitMicros: float
    softLimitMicros: Optional[float]
    currency: str
    reservationMicros: Optional[float] = None


@dataclass(frozen=True)
class ProviderCandidate:
    providerId: str
    modelId: str


@dataclass(frozen=True)
class WeightedProviderCandidate:
    providerId: str
    modelId: str
    weight: float


@dataclass(frozen=True)
class ShadowRoutingConfig:
    candidate: ProviderCandidate
    sampleRate: float


@dataclass(frozen=True)
class ManualRoutingPolicy:
    type: Literal["manual"]
    providerId: str
    shadow: Optional[ShadowRoutingConfig] = None


@dataclass(frozen=True)
class RoundRobinRoutingPolicy:
    type: Literal["round_robin"]
    cursorKey: str
    candidates: list[ProviderCandidate]
    shadow: Optional[ShadowRoutingConfig] = None


@dataclass(frozen=True)
class WeightedRoutingPolicy:
    type: Literal["weighted"]
    candidates: list[WeightedProviderCandidate]
    shadow: Optional[ShadowRoutingConfig] = None


@dataclass(frozen=True)
class HealthAwareRoutingPolicy:
    type: Literal["health_aware"]
    candidates: list[ProviderCandidate]
    shadow: Optional[ShadowRoutingConfig] = None


@dataclass(frozen=True)
class StickyRoutingPolicy:
    type: Literal["sticky"]
    sessionKey: str
    candidates: list[ProviderCandidate]
    pinTtlMs: Optional[float] = None
    shadow: Optional[ShadowRoutingConfig] = None


RoutingPolicy = (
    ManualRoutingPolicy
    | RoundRobinRoutingPolicy
    | WeightedRoutingPolicy
    | HealthAwareRoutingPolicy
    | StickyRoutingPolicy
)

T = TypeVar("T")


@dataclass(frozen=True)
class PolicyResponse(Generic[T]):
    """GET response shape shared by every policy resource -- None means unconfigured at every scope."""

    policy: Optional[T]


@dataclass(frozen=True)
class PolicyScopeOptions:
    """Optional query-string scoping shared by every policy resource's GET/PUT."""

    projectId: Optional[str] = None


# --- Admin API: enrichment policy (six sub-resources, one value type each) ---------------------
# Mirrors the six shape validators in enrichment-config-keys.ts.

EnrichmentStages = list[str]
EnrichmentSystemPrompt = str
EnrichmentDeniedTopics = list[str]
EnrichmentPiiRedactionEnabled = bool
ContentFilterFailureMode = Literal["fail_open", "fail_closed"]
EnrichmentContentFilterTimeoutMs = float

# --- Admin API: providers ------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderStatus:
    providerId: str
    enabled: bool


@dataclass(frozen=True)
class ListProvidersResponse:
    providers: list[ProviderStatus]


# --- Admin API: alert channels ------------------------------------------------------------------


@dataclass(frozen=True)
class AlertChannel:
    """`url` is always redacted to protocol+host by the server -- never the full stored value."""

    id: str
    name: str
    url: str
    enabled: bool
    createdAt: str
    updatedAt: str


@dataclass(frozen=True)
class CreateAlertChannelRequest:
    name: str
    url: str
    enabled: Optional[bool] = None


@dataclass(frozen=True)
class UpdateAlertChannelRequest:
    name: str
    url: str
    enabled: bool


@dataclass(frozen=True)
class ListAlertChannelsResponse:
    alertChannels: list[AlertChannel]


@dataclass(frozen=True)
class SingleAlertChannelResponse:
    alertChannel: AlertChannel
