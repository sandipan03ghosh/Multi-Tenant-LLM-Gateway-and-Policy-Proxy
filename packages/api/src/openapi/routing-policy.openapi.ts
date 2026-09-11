import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { buildPolicyResourcePath } from "./policy-resource.openapi.js";

const providerCandidateSchema: JsonSchema = {
  type: "object",
  properties: { providerId: { type: "string" }, modelId: { type: "string" } },
  required: ["providerId", "modelId"],
};
const weightedCandidateSchema: JsonSchema = {
  type: "object",
  properties: { providerId: { type: "string" }, modelId: { type: "string" }, weight: { type: "number" } },
  required: ["providerId", "modelId", "weight"],
};
const shadowRoutingConfigSchema: JsonSchema = {
  type: "object",
  properties: { candidate: providerCandidateSchema, sampleRate: { type: "number", minimum: 0, maximum: 1 } },
  required: ["candidate", "sampleRate"],
};

// Mirrors isValidRoutingPolicyShape / the RoutingPolicy domain union variant-for-variant. Only a
// stored "manual" policy is honored by the optional-provider fallback today, but this endpoint
// accepts and stores any of the five variants, so all are documented.
const routingPolicySchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: { type: { const: "manual" }, providerId: { type: "string" }, shadow: shadowRoutingConfigSchema },
      required: ["type", "providerId"],
    },
    {
      type: "object",
      properties: {
        type: { const: "round_robin" },
        cursorKey: { type: "string" },
        candidates: { type: "array", items: providerCandidateSchema, minItems: 1 },
        shadow: shadowRoutingConfigSchema,
      },
      required: ["type", "cursorKey", "candidates"],
    },
    {
      type: "object",
      properties: {
        type: { const: "weighted" },
        candidates: { type: "array", items: weightedCandidateSchema, minItems: 1 },
        shadow: shadowRoutingConfigSchema,
      },
      required: ["type", "candidates"],
    },
    {
      type: "object",
      properties: {
        type: { const: "health_aware" },
        candidates: { type: "array", items: providerCandidateSchema, minItems: 1 },
        shadow: shadowRoutingConfigSchema,
      },
      required: ["type", "candidates"],
    },
    {
      type: "object",
      properties: {
        type: { const: "sticky" },
        sessionKey: { type: "string" },
        candidates: { type: "array", items: providerCandidateSchema, minItems: 1 },
        pinTtlMs: { type: "number" },
        shadow: shadowRoutingConfigSchema,
      },
      required: ["type", "sessionKey", "candidates"],
    },
  ],
};

export const routingPolicyPaths: Record<string, OpenApiPathItem> = {
  "/admin/v1/organizations/{orgId}/routing-policy": buildPolicyResourcePath({
    path: "routing-policy",
    resourceName: "RoutingPolicy",
    readPermission: "routing.policy:read",
    writePermission: "routing.policy:write",
    valueSchema: routingPolicySchema,
    invalidBodyMessage: "Request body is not a valid RoutingPolicy",
  }),
};
