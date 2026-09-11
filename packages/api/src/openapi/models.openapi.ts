import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { DEFAULT_SECURITY } from "./security.js";
import { UNAUTHENTICATED_RESPONSE } from "./errors.js";

// Mirrors models.routes.ts / domain's ProviderModelMetadata exactly.
const providerModelMetadataSchema: JsonSchema = {
  type: "object",
  properties: {
    providerId: { type: "string" },
    modelId: { type: "string" },
    displayName: { type: "string" },
    contextWindowTokens: { type: "integer" },
    maxOutputTokens: { type: "integer" },
    supportsStreaming: { type: "boolean" },
  },
  required: ["providerId", "modelId", "displayName", "contextWindowTokens", "maxOutputTokens", "supportsStreaming"],
};

export const modelsPaths: Record<string, OpenApiPathItem> = {
  "/v1/models": {
    get: {
      summary: "List available models across every registered, enabled provider",
      operationId: "listModels",
      tags: ["Models"],
      security: DEFAULT_SECURITY,
      responses: {
        "200": {
          description: "The catalog of models this gateway can currently route to.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { type: "array", items: providerModelMetadataSchema } },
                required: ["data"],
              },
            },
          },
        },
        "401": UNAUTHENTICATED_RESPONSE,
      },
    },
  },
};
