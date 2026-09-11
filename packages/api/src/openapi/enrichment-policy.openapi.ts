import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { buildPolicyResourcePath } from "./policy-resource.openapi.js";

// Mirrors the six shape validators in enrichment-config-keys.ts, one per sub-resource. All six
// share the enrichment.policy:read/write permission pair.
const stagesSchema: JsonSchema = {
  type: "array",
  items: { type: "string", minLength: 1 },
  description: 'Ordered list of enabled stage names, e.g. ["system_prompt_injection", "compliance_policy", "content_filter"].',
};
const systemPromptSchema: JsonSchema = { type: "string" };
const deniedTopicsSchema: JsonSchema = { type: "array", items: { type: "string" } };
const piiRedactionSchema: JsonSchema = { type: "boolean" };
const contentFilterFailureModeSchema: JsonSchema = { type: "string", enum: ["fail_open", "fail_closed"] };
const contentFilterTimeoutMsSchema: JsonSchema = { type: "number", exclusiveMinimum: 0 };

export const enrichmentPolicyPaths: Record<string, OpenApiPathItem> = {
  "/admin/v1/organizations/{orgId}/enrichment-policy/stages": buildPolicyResourcePath({
    path: "enrichment-policy-stages",
    resourceName: "enrichment stage list",
    readPermission: "enrichment.policy:read",
    writePermission: "enrichment.policy:write",
    valueSchema: stagesSchema,
    invalidBodyMessage: "Request body is not a valid stage-name array",
  }),
  "/admin/v1/organizations/{orgId}/enrichment-policy/system-prompt": buildPolicyResourcePath({
    path: "enrichment-policy-system-prompt",
    resourceName: "system prompt text",
    readPermission: "enrichment.policy:read",
    writePermission: "enrichment.policy:write",
    valueSchema: systemPromptSchema,
    invalidBodyMessage: "Request body is not a valid system-prompt string",
  }),
  "/admin/v1/organizations/{orgId}/enrichment-policy/denied-topics": buildPolicyResourcePath({
    path: "enrichment-policy-denied-topics",
    resourceName: "denied-topics list",
    readPermission: "enrichment.policy:read",
    writePermission: "enrichment.policy:write",
    valueSchema: deniedTopicsSchema,
    invalidBodyMessage: "Request body is not a valid denied-topics array",
  }),
  "/admin/v1/organizations/{orgId}/enrichment-policy/pii-redaction": buildPolicyResourcePath({
    path: "enrichment-policy-pii-redaction",
    resourceName: "PII redaction flag",
    readPermission: "enrichment.policy:read",
    writePermission: "enrichment.policy:write",
    valueSchema: piiRedactionSchema,
    invalidBodyMessage: "Request body is not a valid boolean",
  }),
  "/admin/v1/organizations/{orgId}/enrichment-policy/content-filter-failure-mode": buildPolicyResourcePath({
    path: "enrichment-policy-content-filter-failure-mode",
    resourceName: "content-filter failure mode",
    readPermission: "enrichment.policy:read",
    writePermission: "enrichment.policy:write",
    valueSchema: contentFilterFailureModeSchema,
    invalidBodyMessage: 'Request body must be "fail_open" or "fail_closed"',
  }),
  "/admin/v1/organizations/{orgId}/enrichment-policy/content-filter-timeout-ms": buildPolicyResourcePath({
    path: "enrichment-policy-content-filter-timeout-ms",
    resourceName: "content-filter timeout (ms)",
    readPermission: "enrichment.policy:read",
    writePermission: "enrichment.policy:write",
    valueSchema: contentFilterTimeoutMsSchema,
    invalidBodyMessage: "Request body is not a valid positive number",
  }),
};
