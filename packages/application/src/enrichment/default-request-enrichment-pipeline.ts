import { ConfigurationNotFoundError } from "@llm-gateway/domain";
import type {
  RequestEnrichmentPipeline,
  EnrichmentStage,
  EnrichmentResult,
  CanonicalRequest,
  TenantContext,
  ConfigurationService,
} from "@llm-gateway/domain";
import { withSpan } from "@llm-gateway/adapters-observability";
import { ENRICHMENT_STAGES_CONFIG_KEY, toTenantScope } from "./enrichment-config-keys.js";

// Signals that the configured enrichment.stages value exists but is the wrong shape — distinct
// from ConfigurationNotFoundError (nothing configured) so run() can fail closed on it rather than
// treating a broken config like "no policy".
class EnrichmentConfigInvalidError extends Error {}

// Runs the org/project's ordered chain of stages. The stage list is config-driven and resolved
// fresh per request via ConfigurationService; each stage reads its own settings.
export class DefaultRequestEnrichmentPipeline implements RequestEnrichmentPipeline {
  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly stages: ReadonlyMap<string, EnrichmentStage>,
  ) {}

  async run(request: CanonicalRequest, tenant: TenantContext): Promise<EnrichmentResult> {
    return withSpan("enrichment.run", () => this.runInner(request, tenant), {
      "tenant.organization_id": tenant.organizationId,
    });
  }

  private async runInner(request: CanonicalRequest, tenant: TenantContext): Promise<EnrichmentResult> {
    let stageNames: readonly string[];
    try {
      stageNames = await this.resolveStageNames(tenant);
    } catch (error) {
      if (error instanceof EnrichmentConfigInvalidError) {
        console.error("RequestEnrichmentPipeline: configured enrichment.stages value is invalid (failing closed):", error.message);
        return { action: "reject", code: "ENRICHMENT_CONFIG_INVALID", reason: "Request could not be processed" };
      }
      throw error;
    }

    let current = request;
    for (const name of stageNames) {
      const stage = this.stages.get(name);
      if (!stage) {
        // An unregistered stage name (e.g. a config typo) fails closed — skipping a configured
        // compliance stage would be worse than a clear reject.
        console.error(`RequestEnrichmentPipeline: unknown stage "${name}" in configured policy (failing closed)`);
        return { action: "reject", code: "ENRICHMENT_STAGE_NOT_FOUND", reason: "Request could not be processed" };
      }

      let result: EnrichmentResult;
      try {
        // Fixed span name, not interpolated with the stage name — span names stay low-cardinality;
        // which stage ran is the "enrichment.stage" attribute instead.
        result = await withSpan("enrichment.stage", () => stage.apply(current, tenant), {
          "enrichment.stage": name,
        });
      } catch (error) {
        // A stage is expected to handle its own errors and decide fail-open/fail-closed — a throw
        // here is a bug in the stage. Default to fail-closed since the pipeline can't know its
        // intended failure mode.
        console.error(`RequestEnrichmentPipeline: stage "${name}" threw unexpectedly (failing closed):`, error);
        return { action: "reject", code: "ENRICHMENT_STAGE_ERROR", reason: "Request could not be processed" };
      }

      if (result.action === "reject") {
        return result;
      }
      current = result.request;
    }

    return { action: "continue", request: current };
  }

  // Returns [] for "not configured"; throws EnrichmentConfigInvalidError for a
  // configured-but-malformed value so that case fails closed instead of behaving like "no policy".
  private async resolveStageNames(tenant: TenantContext): Promise<readonly string[]> {
    let raw: unknown;
    try {
      raw = await this.configurationService.getWithFallback<unknown>(ENRICHMENT_STAGES_CONFIG_KEY, toTenantScope(tenant));
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return [];
      }
      throw error;
    }
    if (!Array.isArray(raw) || !raw.every((name) => typeof name === "string")) {
      throw new EnrichmentConfigInvalidError(`enrichment.stages value is not a string[]: ${JSON.stringify(raw)}`);
    }
    return raw;
  }
}
