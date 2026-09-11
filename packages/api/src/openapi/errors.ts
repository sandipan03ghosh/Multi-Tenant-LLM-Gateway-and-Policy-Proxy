import type { JsonSchema, OpenApiResponse } from "./types.js";

// Every route responds to an error with the same { code, message } envelope (optionally +
// details for a zod-validation failure), constructed directly at each site rather than a shared
// helper — but the shape is consistent, so this one schema is accurate.
export const errorEnvelopeSchema: JsonSchema = {
  type: "object",
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    details: { type: "object", additionalProperties: true },
  },
  required: ["code", "message"],
};

function errorResponse(description: string): OpenApiResponse {
  return { description, content: { "application/json": { schema: errorEnvelopeSchema } } };
}

export const VALIDATION_FAILED_RESPONSE = errorResponse("The request body or query parameters failed validation.");
export const UNAUTHENTICATED_RESPONSE = errorResponse("No valid credential (X-API-Key or Authorization: Bearer) was presented.");
export const FORBIDDEN_RESPONSE = errorResponse("The authenticated caller lacks the required permission.");
export const NOT_FOUND_RESPONSE = errorResponse("The requested resource does not exist.");
export const INTERNAL_ERROR_RESPONSE = errorResponse("An unexpected server error occurred.");
