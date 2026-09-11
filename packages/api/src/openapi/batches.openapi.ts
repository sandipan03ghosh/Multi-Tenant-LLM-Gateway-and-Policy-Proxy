import { z } from "zod";
import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { DEFAULT_SECURITY } from "./security.js";
import { VALIDATION_FAILED_RESPONSE, UNAUTHENTICATED_RESPONSE, NOT_FOUND_RESPONSE } from "./errors.js";
import { createBatchRequestSchema } from "../routes/batches.routes.js";

const batchStatusResponseSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["pending", "processing", "succeeded", "failed"] },
    createdAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time" },
    result: { type: "object", additionalProperties: true, description: "Present only when status is \"succeeded\" — the CanonicalResponse." },
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" } },
      description: "Present only when status is \"failed\".",
    },
  },
  required: ["id", "status", "createdAt"],
};

export const batchesPaths: Record<string, OpenApiPathItem> = {
  "/v1/batches": {
    post: {
      summary: "Enqueue a batch or background request",
      operationId: "createBatch",
      tags: ["Batches"],
      security: DEFAULT_SECURITY,
      requestBody: {
        required: true,
        content: { "application/json": { schema: z.toJSONSchema(createBatchRequestSchema) } },
      },
      responses: {
        "202": {
          description: "Accepted — the request has been queued.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { id: { type: "string" }, status: { const: "pending" } },
                required: ["id", "status"],
              },
            },
          },
        },
        "400": VALIDATION_FAILED_RESPONSE,
        "401": UNAUTHENTICATED_RESPONSE,
      },
    },
  },
  "/v1/batches/{id}": {
    get: {
      summary: "Get a batch/background request's current status and result",
      operationId: "getBatch",
      tags: ["Batches"],
      security: DEFAULT_SECURITY,
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "The batch's current status.", content: { "application/json": { schema: batchStatusResponseSchema } } },
        "401": UNAUTHENTICATED_RESPONSE,
        "404": NOT_FOUND_RESPONSE,
      },
    },
  },
};
