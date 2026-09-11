import { ConfigurationNotFoundError } from "@llm-gateway/domain";
import type { EnrichmentStage, EnrichmentResult, CanonicalRequest, TenantContext, ConfigurationService } from "@llm-gateway/domain";
import { SYSTEM_PROMPT_TEXT_CONFIG_KEY, toTenantScope } from "./enrichment-config-keys.js";

// Prepends an org/project-configured system prompt. Reads only from ConfigurationService, so an
// infra failure fails open (log + continue) rather than block on a non-safety-critical feature;
// "nothing configured" is the normal default.
export class SystemPromptInjectionStage implements EnrichmentStage {
  readonly name = "system_prompt_injection";

  constructor(private readonly configurationService: ConfigurationService) {}

  async apply(request: CanonicalRequest, tenant: TenantContext): Promise<EnrichmentResult> {
    let raw: unknown;
    try {
      // getWithFallback()'s generic is a compile-time hint only — the stored JSON could be any
      // shape, so read as `unknown` and validate below.
      raw = await this.configurationService.getWithFallback<unknown>(SYSTEM_PROMPT_TEXT_CONFIG_KEY, toTenantScope(tenant));
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return { action: "continue", request };
      }
      console.error("SystemPromptInjectionStage: ConfigurationService read failed (failing open):", error);
      return { action: "continue", request };
    }

    if (typeof raw !== "string") {
      console.error(`SystemPromptInjectionStage: configured value is not a string (failing open): ${typeof raw}`);
      return { action: "continue", request };
    }
    if (raw.trim().length === 0) {
      return { action: "continue", request };
    }

    return {
      action: "continue",
      request: {
        ...request,
        messages: [{ role: "system", content: raw }, ...request.messages],
      },
    };
  }
}
