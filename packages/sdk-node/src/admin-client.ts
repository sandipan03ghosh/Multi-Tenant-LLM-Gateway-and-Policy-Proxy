import { Transport } from "./transport.js";
import type { TransportOptions } from "./transport.js";
import type {
  ListAuditLogOptions,
  ListAuditLogResponse,
  PolicyResponse,
  PolicyScopeOptions,
  RateLimitPolicy,
  BudgetPolicy,
  RoutingPolicy,
  EnrichmentStages,
  EnrichmentSystemPrompt,
  EnrichmentDeniedTopics,
  EnrichmentPiiRedactionEnabled,
  ContentFilterFailureMode,
  EnrichmentContentFilterTimeoutMs,
  ListProvidersResponse,
  ProviderStatus,
  ListAlertChannelsResponse,
  SingleAlertChannelResponse,
  CreateAlertChannelRequest,
  UpdateAlertChannelRequest,
} from "./types.js";

export type AdminClientOptions = TransportOptions;

// Typed client for the Gateway's Admin API (/admin/v1/*). Most resources are organization-scoped
// (every method takes `organizationId`); providers and alert channels are global.
export class AdminClient {
  private readonly transport: Transport;

  constructor(options: AdminClientOptions) {
    this.transport = new Transport(options);
  }

  // --- Audit log ---------------------------------------------------------------------------

  async listAuditLog(organizationId: string, options: ListAuditLogOptions = {}): Promise<ListAuditLogResponse> {
    return this.transport.requestJson<ListAuditLogResponse>({
      method: "GET",
      path: `/admin/v1/organizations/${encodeURIComponent(organizationId)}/audit-log`,
      query: { limit: options.limit?.toString(), cursor: options.cursor },
    });
  }

  // --- Rate-limit / budget / routing policy ---------------------------------------------------

  async getRateLimitPolicy(organizationId: string, options?: PolicyScopeOptions): Promise<PolicyResponse<RateLimitPolicy>> {
    return this.getPolicy<RateLimitPolicy>(organizationId, "rate-limit-policy", options);
  }
  async setRateLimitPolicy(organizationId: string, policy: RateLimitPolicy, options?: PolicyScopeOptions): Promise<PolicyResponse<RateLimitPolicy>> {
    return this.setPolicy<RateLimitPolicy>(organizationId, "rate-limit-policy", policy, options);
  }

  async getBudgetPolicy(organizationId: string, options?: PolicyScopeOptions): Promise<PolicyResponse<BudgetPolicy>> {
    return this.getPolicy<BudgetPolicy>(organizationId, "budget-policy", options);
  }
  async setBudgetPolicy(organizationId: string, policy: BudgetPolicy, options?: PolicyScopeOptions): Promise<PolicyResponse<BudgetPolicy>> {
    return this.setPolicy<BudgetPolicy>(organizationId, "budget-policy", policy, options);
  }

  async getRoutingPolicy(organizationId: string, options?: PolicyScopeOptions): Promise<PolicyResponse<RoutingPolicy>> {
    return this.getPolicy<RoutingPolicy>(organizationId, "routing-policy", options);
  }
  async setRoutingPolicy(organizationId: string, policy: RoutingPolicy, options?: PolicyScopeOptions): Promise<PolicyResponse<RoutingPolicy>> {
    return this.setPolicy<RoutingPolicy>(organizationId, "routing-policy", policy, options);
  }

  // --- Enrichment policy (six sub-resources, one value type each) ---------------------------

  async getEnrichmentStages(organizationId: string, options?: PolicyScopeOptions): Promise<PolicyResponse<EnrichmentStages>> {
    return this.getPolicy<EnrichmentStages>(organizationId, "enrichment-policy/stages", options);
  }
  async setEnrichmentStages(organizationId: string, stages: EnrichmentStages, options?: PolicyScopeOptions): Promise<PolicyResponse<EnrichmentStages>> {
    return this.setPolicy<EnrichmentStages>(organizationId, "enrichment-policy/stages", stages, options);
  }

  async getEnrichmentSystemPrompt(organizationId: string, options?: PolicyScopeOptions): Promise<PolicyResponse<EnrichmentSystemPrompt>> {
    return this.getPolicy<EnrichmentSystemPrompt>(organizationId, "enrichment-policy/system-prompt", options);
  }
  async setEnrichmentSystemPrompt(
    organizationId: string,
    prompt: EnrichmentSystemPrompt,
    options?: PolicyScopeOptions,
  ): Promise<PolicyResponse<EnrichmentSystemPrompt>> {
    return this.setPolicy<EnrichmentSystemPrompt>(organizationId, "enrichment-policy/system-prompt", prompt, options);
  }

  async getEnrichmentDeniedTopics(organizationId: string, options?: PolicyScopeOptions): Promise<PolicyResponse<EnrichmentDeniedTopics>> {
    return this.getPolicy<EnrichmentDeniedTopics>(organizationId, "enrichment-policy/denied-topics", options);
  }
  async setEnrichmentDeniedTopics(
    organizationId: string,
    topics: EnrichmentDeniedTopics,
    options?: PolicyScopeOptions,
  ): Promise<PolicyResponse<EnrichmentDeniedTopics>> {
    return this.setPolicy<EnrichmentDeniedTopics>(organizationId, "enrichment-policy/denied-topics", topics, options);
  }

  async getEnrichmentPiiRedaction(organizationId: string, options?: PolicyScopeOptions): Promise<PolicyResponse<EnrichmentPiiRedactionEnabled>> {
    return this.getPolicy<EnrichmentPiiRedactionEnabled>(organizationId, "enrichment-policy/pii-redaction", options);
  }
  async setEnrichmentPiiRedaction(
    organizationId: string,
    enabled: EnrichmentPiiRedactionEnabled,
    options?: PolicyScopeOptions,
  ): Promise<PolicyResponse<EnrichmentPiiRedactionEnabled>> {
    return this.setPolicy<EnrichmentPiiRedactionEnabled>(organizationId, "enrichment-policy/pii-redaction", enabled, options);
  }

  async getEnrichmentContentFilterFailureMode(
    organizationId: string,
    options?: PolicyScopeOptions,
  ): Promise<PolicyResponse<ContentFilterFailureMode>> {
    return this.getPolicy<ContentFilterFailureMode>(organizationId, "enrichment-policy/content-filter-failure-mode", options);
  }
  async setEnrichmentContentFilterFailureMode(
    organizationId: string,
    mode: ContentFilterFailureMode,
    options?: PolicyScopeOptions,
  ): Promise<PolicyResponse<ContentFilterFailureMode>> {
    return this.setPolicy<ContentFilterFailureMode>(organizationId, "enrichment-policy/content-filter-failure-mode", mode, options);
  }

  async getEnrichmentContentFilterTimeoutMs(
    organizationId: string,
    options?: PolicyScopeOptions,
  ): Promise<PolicyResponse<EnrichmentContentFilterTimeoutMs>> {
    return this.getPolicy<EnrichmentContentFilterTimeoutMs>(organizationId, "enrichment-policy/content-filter-timeout-ms", options);
  }
  async setEnrichmentContentFilterTimeoutMs(
    organizationId: string,
    timeoutMs: EnrichmentContentFilterTimeoutMs,
    options?: PolicyScopeOptions,
  ): Promise<PolicyResponse<EnrichmentContentFilterTimeoutMs>> {
    return this.setPolicy<EnrichmentContentFilterTimeoutMs>(organizationId, "enrichment-policy/content-filter-timeout-ms", timeoutMs, options);
  }

  // Shared GET/PUT shape for every policy resource above — mirrors createPolicyRouter() server-side.
  private async getPolicy<T>(organizationId: string, resourcePath: string, options?: PolicyScopeOptions): Promise<PolicyResponse<T>> {
    return this.transport.requestJson<PolicyResponse<T>>({
      method: "GET",
      path: `/admin/v1/organizations/${encodeURIComponent(organizationId)}/${resourcePath}`,
      query: { projectId: options?.projectId },
    });
  }

  private async setPolicy<T>(organizationId: string, resourcePath: string, value: T, options?: PolicyScopeOptions): Promise<PolicyResponse<T>> {
    return this.transport.requestJson<PolicyResponse<T>>({
      method: "PUT",
      path: `/admin/v1/organizations/${encodeURIComponent(organizationId)}/${resourcePath}`,
      query: { projectId: options?.projectId },
      body: value,
    });
  }

  // --- Providers (global) -------------------------------------------------------------------

  async listProviders(): Promise<ListProvidersResponse> {
    return this.transport.requestJson<ListProvidersResponse>({ method: "GET", path: "/admin/v1/providers" });
  }

  async setProviderEnabled(providerId: string, enabled: boolean): Promise<ProviderStatus> {
    return this.transport.requestJson<ProviderStatus>({
      method: "PUT",
      path: `/admin/v1/providers/${encodeURIComponent(providerId)}/enabled`,
      body: { enabled },
    });
  }

  // --- Alert channels (global) ---------------------------------------------------------------

  async listAlertChannels(): Promise<ListAlertChannelsResponse> {
    return this.transport.requestJson<ListAlertChannelsResponse>({ method: "GET", path: "/admin/v1/alert-channels" });
  }

  async createAlertChannel(request: CreateAlertChannelRequest): Promise<SingleAlertChannelResponse> {
    return this.transport.requestJson<SingleAlertChannelResponse>({ method: "POST", path: "/admin/v1/alert-channels", body: request });
  }

  async updateAlertChannel(id: string, request: UpdateAlertChannelRequest): Promise<SingleAlertChannelResponse> {
    return this.transport.requestJson<SingleAlertChannelResponse>({
      method: "PUT",
      path: `/admin/v1/alert-channels/${encodeURIComponent(id)}`,
      body: request,
    });
  }

  async deleteAlertChannel(id: string): Promise<void> {
    await this.transport.requestJson<void>({ method: "DELETE", path: `/admin/v1/alert-channels/${encodeURIComponent(id)}` });
  }
}
