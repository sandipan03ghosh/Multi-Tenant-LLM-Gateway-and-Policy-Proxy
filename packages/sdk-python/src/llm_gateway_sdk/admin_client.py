"""Typed client for the Gateway's Admin API (/admin/v1/*). Most resources are organization-scoped
(every method takes organization_id); providers and alert channels are global.
"""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote

from . import _codec
from .transport import Transport
from .types import (
    BudgetPolicy,
    ContentFilterFailureMode,
    CreateAlertChannelRequest,
    EnrichmentContentFilterTimeoutMs,
    EnrichmentDeniedTopics,
    EnrichmentPiiRedactionEnabled,
    EnrichmentStages,
    EnrichmentSystemPrompt,
    ListAlertChannelsResponse,
    ListAuditLogOptions,
    ListAuditLogResponse,
    ListProvidersResponse,
    PolicyResponse,
    PolicyScopeOptions,
    ProviderStatus,
    RateLimitPolicy,
    RoutingPolicy,
    SingleAlertChannelResponse,
    UpdateAlertChannelRequest,
)


class AdminClient:
    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        bearer_token: Optional[str] = None,
        max_retries: Optional[int] = None,
        retry_base_delay_seconds: Optional[float] = None,
        timeout_seconds: Optional[float] = None,
    ) -> None:
        kwargs = {}
        if max_retries is not None:
            kwargs["max_retries"] = max_retries
        if retry_base_delay_seconds is not None:
            kwargs["retry_base_delay_seconds"] = retry_base_delay_seconds
        if timeout_seconds is not None:
            kwargs["timeout_seconds"] = timeout_seconds
        self._transport = Transport(base_url, api_key=api_key, bearer_token=bearer_token, **kwargs)

    # --- Audit log ---------------------------------------------------------------------------

    def list_audit_log(self, organization_id: str, options: Optional[ListAuditLogOptions] = None) -> ListAuditLogResponse:
        options = options or ListAuditLogOptions()
        return self._transport.request_json(
            "GET",
            f"/admin/v1/organizations/{quote(organization_id, safe='')}/audit-log",
            ListAuditLogResponse,
            query={"limit": str(options.limit) if options.limit is not None else None, "cursor": options.cursor},
        )

    # --- Rate-limit / budget / routing policy ---------------------------------------------------

    def get_rate_limit_policy(self, organization_id: str, options: Optional[PolicyScopeOptions] = None) -> PolicyResponse[RateLimitPolicy]:
        return self._get_policy(organization_id, "rate-limit-policy", RateLimitPolicy, options)

    def set_rate_limit_policy(
        self, organization_id: str, policy: RateLimitPolicy, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[RateLimitPolicy]:
        return self._set_policy(organization_id, "rate-limit-policy", policy, RateLimitPolicy, options)

    def get_budget_policy(self, organization_id: str, options: Optional[PolicyScopeOptions] = None) -> PolicyResponse[BudgetPolicy]:
        return self._get_policy(organization_id, "budget-policy", BudgetPolicy, options)

    def set_budget_policy(
        self, organization_id: str, policy: BudgetPolicy, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[BudgetPolicy]:
        return self._set_policy(organization_id, "budget-policy", policy, BudgetPolicy, options)

    def get_routing_policy(self, organization_id: str, options: Optional[PolicyScopeOptions] = None) -> PolicyResponse[RoutingPolicy]:
        return self._get_policy(organization_id, "routing-policy", RoutingPolicy, options)

    def set_routing_policy(
        self, organization_id: str, policy: RoutingPolicy, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[RoutingPolicy]:
        return self._set_policy(organization_id, "routing-policy", policy, RoutingPolicy, options)

    # --- Enrichment policy (six sub-resources, one value type each) ---------------------------

    def get_enrichment_stages(self, organization_id: str, options: Optional[PolicyScopeOptions] = None) -> PolicyResponse[EnrichmentStages]:
        return self._get_policy(organization_id, "enrichment-policy/stages", EnrichmentStages, options)

    def set_enrichment_stages(
        self, organization_id: str, stages: EnrichmentStages, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentStages]:
        return self._set_policy(organization_id, "enrichment-policy/stages", stages, EnrichmentStages, options)

    def get_enrichment_system_prompt(
        self, organization_id: str, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentSystemPrompt]:
        return self._get_policy(organization_id, "enrichment-policy/system-prompt", EnrichmentSystemPrompt, options)

    def set_enrichment_system_prompt(
        self, organization_id: str, prompt: EnrichmentSystemPrompt, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentSystemPrompt]:
        return self._set_policy(organization_id, "enrichment-policy/system-prompt", prompt, EnrichmentSystemPrompt, options)

    def get_enrichment_denied_topics(
        self, organization_id: str, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentDeniedTopics]:
        return self._get_policy(organization_id, "enrichment-policy/denied-topics", EnrichmentDeniedTopics, options)

    def set_enrichment_denied_topics(
        self, organization_id: str, topics: EnrichmentDeniedTopics, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentDeniedTopics]:
        return self._set_policy(organization_id, "enrichment-policy/denied-topics", topics, EnrichmentDeniedTopics, options)

    def get_enrichment_pii_redaction(
        self, organization_id: str, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentPiiRedactionEnabled]:
        return self._get_policy(organization_id, "enrichment-policy/pii-redaction", EnrichmentPiiRedactionEnabled, options)

    def set_enrichment_pii_redaction(
        self, organization_id: str, enabled: EnrichmentPiiRedactionEnabled, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentPiiRedactionEnabled]:
        return self._set_policy(organization_id, "enrichment-policy/pii-redaction", enabled, EnrichmentPiiRedactionEnabled, options)

    def get_enrichment_content_filter_failure_mode(
        self, organization_id: str, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[ContentFilterFailureMode]:
        return self._get_policy(organization_id, "enrichment-policy/content-filter-failure-mode", ContentFilterFailureMode, options)

    def set_enrichment_content_filter_failure_mode(
        self, organization_id: str, mode: ContentFilterFailureMode, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[ContentFilterFailureMode]:
        return self._set_policy(organization_id, "enrichment-policy/content-filter-failure-mode", mode, ContentFilterFailureMode, options)

    def get_enrichment_content_filter_timeout_ms(
        self, organization_id: str, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentContentFilterTimeoutMs]:
        return self._get_policy(organization_id, "enrichment-policy/content-filter-timeout-ms", EnrichmentContentFilterTimeoutMs, options)

    def set_enrichment_content_filter_timeout_ms(
        self, organization_id: str, timeout_ms: EnrichmentContentFilterTimeoutMs, options: Optional[PolicyScopeOptions] = None
    ) -> PolicyResponse[EnrichmentContentFilterTimeoutMs]:
        return self._set_policy(
            organization_id, "enrichment-policy/content-filter-timeout-ms", timeout_ms, EnrichmentContentFilterTimeoutMs, options
        )

    # Shared GET/PUT shape for every policy resource above -- mirrors createPolicyRouter() server-side.
    # Fetches the raw {"policy": ...} envelope with decode=False and constructs PolicyResponse
    # manually, decoding only the inner value against the caller-supplied `value_type` (PolicyResponse[T]
    # can't be decoded generically -- see _codec.py).
    def _get_policy(self, organization_id: str, resource_path: str, value_type: Any, options: Optional[PolicyScopeOptions]) -> PolicyResponse:
        options = options or PolicyScopeOptions()
        raw = self._transport.request_json(
            "GET",
            f"/admin/v1/organizations/{quote(organization_id, safe='')}/{resource_path}",
            None,
            query={"projectId": options.projectId},
            decode=False,
        )
        return PolicyResponse(policy=_codec.decode(value_type, raw.get("policy")))

    def _set_policy(
        self, organization_id: str, resource_path: str, value: Any, value_type: Any, options: Optional[PolicyScopeOptions]
    ) -> PolicyResponse:
        options = options or PolicyScopeOptions()
        raw = self._transport.request_json(
            "PUT",
            f"/admin/v1/organizations/{quote(organization_id, safe='')}/{resource_path}",
            None,
            query={"projectId": options.projectId},
            body=value,
            decode=False,
        )
        return PolicyResponse(policy=_codec.decode(value_type, raw.get("policy")))

    # --- Providers (global) -------------------------------------------------------------------

    def list_providers(self) -> ListProvidersResponse:
        return self._transport.request_json("GET", "/admin/v1/providers", ListProvidersResponse)

    def set_provider_enabled(self, provider_id: str, enabled: bool) -> ProviderStatus:
        return self._transport.request_json(
            "PUT", f"/admin/v1/providers/{quote(provider_id, safe='')}/enabled", ProviderStatus, body={"enabled": enabled}
        )

    # --- Alert channels (global) ---------------------------------------------------------------

    def list_alert_channels(self) -> ListAlertChannelsResponse:
        return self._transport.request_json("GET", "/admin/v1/alert-channels", ListAlertChannelsResponse)

    def create_alert_channel(self, request: CreateAlertChannelRequest) -> SingleAlertChannelResponse:
        return self._transport.request_json("POST", "/admin/v1/alert-channels", SingleAlertChannelResponse, body=request)

    def update_alert_channel(self, channel_id: str, request: UpdateAlertChannelRequest) -> SingleAlertChannelResponse:
        return self._transport.request_json(
            "PUT", f"/admin/v1/alert-channels/{quote(channel_id, safe='')}", SingleAlertChannelResponse, body=request
        )

    def delete_alert_channel(self, channel_id: str) -> None:
        self._transport.request_json("DELETE", f"/admin/v1/alert-channels/{quote(channel_id, safe='')}", None)
