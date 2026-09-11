import { ConfigurationNotFoundError } from "@llm-gateway/domain";
import type {
  EnrichmentStage,
  EnrichmentResult,
  CanonicalRequest,
  TenantContext,
  ConfigurationService,
  TenantScope,
  ContentModerationPort,
  ModerationVerdict,
} from "@llm-gateway/domain";
import {
  CONTENT_FILTER_FAILURE_MODE_CONFIG_KEY,
  CONTENT_FILTER_TIMEOUT_MS_CONFIG_KEY,
  DEFAULT_CONTENT_FILTER_FAILURE_MODE,
  DEFAULT_CONTENT_FILTER_TIMEOUT_MS,
  toTenantScope,
} from "./enrichment-config-keys.js";
import type { ContentFilterFailureMode } from "./enrichment-config-keys.js";

// Delegates to a pluggable ContentModerationPort — the one built-in stage that calls an external
// service, so it gets a real timeout + configurable fail-open/fail-closed for that call. Reading
// this stage's own tuning config (failure mode, timeout) defaults safely on an infra failure,
// since the moderation call's outcome is what's safety-critical, not the config read. Scans only
// non-"system" messages.
export class ContentFilterStage implements EnrichmentStage {
  readonly name = "content_filter";

  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly contentModerationPort: ContentModerationPort,
  ) {}

  async apply(request: CanonicalRequest, tenant: TenantContext): Promise<EnrichmentResult> {
    const scope = toTenantScope(tenant);
    const failureMode = await this.readFailureMode(scope);
    const timeoutMs = await this.readTimeoutMs(scope);

    for (const message of request.messages) {
      if (message.role === "system") {
        continue;
      }

      let verdict: ModerationVerdict;
      try {
        verdict = await this.moderateWithTimeout(message.content, timeoutMs);
      } catch (error) {
        console.error(`ContentFilterStage: moderation call failed (mode=${failureMode}):`, error);
        if (failureMode === "fail_closed") {
          return {
            action: "reject",
            code: "CONTENT_FILTER_UNAVAILABLE",
            reason: "Content moderation is currently unavailable",
          };
        }
        continue;
      }

      if (!verdict.allowed) {
        return { action: "reject", code: "CONTENT_POLICY_VIOLATION", reason: verdict.reason };
      }
    }

    return { action: "continue", request };
  }

  // Aborts the underlying moderation call via AbortSignal when the timeout elapses, not just
  // racing a timer and leaving the call running in the background.
  private async moderateWithTimeout(content: string, timeoutMs: number): Promise<ModerationVerdict> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Content moderation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.contentModerationPort.moderate(content, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readFailureMode(scope: TenantScope): Promise<ContentFilterFailureMode> {
    let raw: unknown;
    try {
      raw = await this.configurationService.getWithFallback<unknown>(CONTENT_FILTER_FAILURE_MODE_CONFIG_KEY, scope);
    } catch (error) {
      if (!(error instanceof ConfigurationNotFoundError)) {
        console.error("ContentFilterStage: ConfigurationService read failed for failure-mode (using default):", error);
      }
      return DEFAULT_CONTENT_FILTER_FAILURE_MODE;
    }
    if (raw === "fail_open" || raw === "fail_closed") {
      return raw;
    }
    console.error(`ContentFilterStage: configured failure-mode value is invalid (using default ${DEFAULT_CONTENT_FILTER_FAILURE_MODE}): ${String(raw)}`);
    return DEFAULT_CONTENT_FILTER_FAILURE_MODE;
  }

  private async readTimeoutMs(scope: TenantScope): Promise<number> {
    let raw: unknown;
    try {
      raw = await this.configurationService.getWithFallback<unknown>(CONTENT_FILTER_TIMEOUT_MS_CONFIG_KEY, scope);
    } catch (error) {
      if (!(error instanceof ConfigurationNotFoundError)) {
        console.error("ContentFilterStage: ConfigurationService read failed for timeout-ms (using default):", error);
      }
      return DEFAULT_CONTENT_FILTER_TIMEOUT_MS;
    }
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    console.error(`ContentFilterStage: configured timeout-ms value is invalid (using default ${DEFAULT_CONTENT_FILTER_TIMEOUT_MS}): ${String(raw)}`);
    return DEFAULT_CONTENT_FILTER_TIMEOUT_MS;
  }
}
