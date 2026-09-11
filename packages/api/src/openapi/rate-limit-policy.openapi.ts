import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { buildPolicyResourcePath } from "./policy-resource.openapi.js";

// Mirrors isValidPolicyShape in default-rate-limiter.ts exactly.
const rateLimitPolicySchema: JsonSchema = {
  type: "object",
  properties: {
    capacity: { type: "number", exclusiveMinimum: 0, description: "The burst ceiling — maximum tokens the bucket can hold." },
    refillTokens: { type: "number", minimum: 0, description: "Tokens added back per refillIntervalMs." },
    refillIntervalMs: { type: "number", exclusiveMinimum: 0 },
  },
  required: ["capacity", "refillTokens", "refillIntervalMs"],
};

export const rateLimitPolicyPaths: Record<string, OpenApiPathItem> = {
  "/admin/v1/organizations/{orgId}/rate-limit-policy": buildPolicyResourcePath({
    path: "rate-limit-policy",
    resourceName: "RateLimitPolicy",
    readPermission: "rate-limit.policy:read",
    writePermission: "rate-limit.policy:write",
    valueSchema: rateLimitPolicySchema,
    invalidBodyMessage: "Request body is not a valid RateLimitPolicy",
  }),
};
