import { toConfigKey } from "@llm-gateway/domain";
import type { ConfigKey, TenantContext, TenantScope } from "@llm-gateway/domain";

// Shared by the pipeline and every stage. Built conditionally because exactOptionalPropertyTypes
// rejects explicitly assigning `undefined` to an optional field.
export function toTenantScope(tenant: TenantContext): TenantScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.projectId ? { projectId: tenant.projectId } : {}),
  };
}

// Centralized so the pipeline and each stage don't duplicate magic key strings.

// Ordered list of enabled stage names, e.g. ["system_prompt_injection", "compliance_policy",
// "content_filter"]. Absent means no enrichment policy is configured.
export const ENRICHMENT_STAGES_CONFIG_KEY: ConfigKey = toConfigKey("enrichment.stages");

export const SYSTEM_PROMPT_TEXT_CONFIG_KEY: ConfigKey = toConfigKey("enrichment.system-prompt.text");

export const COMPLIANCE_DENIED_TOPICS_CONFIG_KEY: ConfigKey = toConfigKey("enrichment.compliance.denied-topics");
export const COMPLIANCE_PII_REDACTION_ENABLED_CONFIG_KEY: ConfigKey = toConfigKey(
  "enrichment.compliance.pii-redaction-enabled",
);

export type ContentFilterFailureMode = "fail_open" | "fail_closed";
export const CONTENT_FILTER_FAILURE_MODE_CONFIG_KEY: ConfigKey = toConfigKey("enrichment.content-filter.failure-mode");
export const CONTENT_FILTER_TIMEOUT_MS_CONFIG_KEY: ConfigKey = toConfigKey("enrichment.content-filter.timeout-ms");
export const DEFAULT_CONTENT_FILTER_FAILURE_MODE: ContentFilterFailureMode = "fail_open";
export const DEFAULT_CONTENT_FILTER_TIMEOUT_MS = 2_000;

// Shape validators — exported so the Admin API's enrichment-policy write endpoints validate with
// these exact rules rather than a copy that could drift. Hand-written type guards, not zod.
export function isValidStageListShape(raw: unknown): raw is string[] {
  return Array.isArray(raw) && raw.every((name) => typeof name === "string" && name.length > 0);
}

export function isValidSystemPromptShape(raw: unknown): raw is string {
  return typeof raw === "string";
}

export function isValidDeniedTopicsShape(raw: unknown): raw is string[] {
  return Array.isArray(raw) && raw.every((topic) => typeof topic === "string");
}

export function isValidPiiRedactionEnabledShape(raw: unknown): raw is boolean {
  return typeof raw === "boolean";
}

export function isValidContentFilterFailureModeShape(raw: unknown): raw is ContentFilterFailureMode {
  return raw === "fail_open" || raw === "fail_closed";
}

export function isValidContentFilterTimeoutMsShape(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0;
}
