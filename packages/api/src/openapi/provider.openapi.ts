import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { DEFAULT_SECURITY } from "./security.js";
import { VALIDATION_FAILED_RESPONSE, UNAUTHENTICATED_RESPONSE, FORBIDDEN_RESPONSE, NOT_FOUND_RESPONSE } from "./errors.js";

const providerStatusSchema: JsonSchema = {
  type: "object",
  properties: { providerId: { type: "string" }, enabled: { type: "boolean" } },
  required: ["providerId", "enabled"],
};

// Global, not organization-scoped — gated by the global-only provider:read/write permissions.
export const providerPaths: Record<string, OpenApiPathItem> = {
  "/admin/v1/providers": {
    get: {
      summary: "List every registered provider adapter and its current enabled state",
      operationId: "listProviders",
      tags: ["Admin / Providers"],
      security: DEFAULT_SECURITY,
      responses: {
        "200": {
          description: "Every provider this process was constructed with.",
          content: {
            "application/json": {
              schema: { type: "object", properties: { providers: { type: "array", items: providerStatusSchema } }, required: ["providers"] },
            },
          },
        },
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
      },
    },
  },
  "/admin/v1/providers/{providerId}/enabled": {
    put: {
      summary: "Enable or disable a provider gateway-wide (zero-restart, propagates via ConfigurationService pub/sub)",
      operationId: "setProviderEnabled",
      tags: ["Admin / Providers"],
      security: DEFAULT_SECURITY,
      parameters: [
        {
          name: "providerId",
          in: "path",
          required: true,
          description: "Must be one of the ids returned by GET /admin/v1/providers — an unknown id is rejected, not silently accepted.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] },
          },
        },
      },
      responses: {
        "200": { description: "The new state.", content: { "application/json": { schema: providerStatusSchema } } },
        "400": VALIDATION_FAILED_RESPONSE,
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
        "404": NOT_FOUND_RESPONSE,
      },
    },
  },
};
