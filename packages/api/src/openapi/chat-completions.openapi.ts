import { z } from "zod";
import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { DEFAULT_SECURITY } from "./security.js";
import { VALIDATION_FAILED_RESPONSE, UNAUTHENTICATED_RESPONSE } from "./errors.js";
import { chatCompletionRequestSchema } from "../routes/chat-completions.routes.js";

// Mirrors domain's CanonicalResponse exactly (canonical-response.ts).
const canonicalResponseSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    model: { type: "string" },
    message: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["system", "user", "assistant"] },
        content: { type: "string" },
      },
      required: ["role", "content"],
    },
    usage: {
      type: "object",
      properties: {
        promptTokens: { type: "integer" },
        completionTokens: { type: "integer" },
        totalTokens: { type: "integer" },
      },
      required: ["promptTokens", "completionTokens", "totalTokens"],
    },
    finishReason: { type: "string", enum: ["stop", "length", "content_filter", "error"] },
  },
  required: ["id", "model", "message", "usage", "finishReason"],
};

// Mirrors domain's CanonicalStreamEvent union — the payload of each `data:` line an SSE response
// emits. OpenAPI 3.1 has no first-class SSE construct; this is the closest approximation.
const canonicalStreamEventSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: { type: { const: "start" }, id: { type: "string" }, model: { type: "string" } },
      required: ["type", "id", "model"],
    },
    {
      type: "object",
      properties: { type: { const: "delta" }, content: { type: "string" } },
      required: ["type", "content"],
    },
    {
      type: "object",
      properties: {
        type: { const: "done" },
        finishReason: { type: "string", enum: ["stop", "length", "content_filter", "error"] },
        usage: {
          type: "object",
          properties: { promptTokens: { type: "integer" }, completionTokens: { type: "integer" }, totalTokens: { type: "integer" } },
          required: ["promptTokens", "completionTokens", "totalTokens"],
        },
      },
      required: ["type", "finishReason", "usage"],
    },
    {
      type: "object",
      properties: {
        type: { const: "error" },
        error: {
          type: "object",
          properties: { code: { type: "string" }, message: { type: "string" } },
          required: ["code", "message"],
        },
      },
      required: ["type", "error"],
    },
  ],
};

export const chatCompletionsPaths: Record<string, OpenApiPathItem> = {
  "/v1/chat/completions": {
    post: {
      summary: "Create a chat completion",
      description:
        "Streaming vs. JSON is content-negotiated on this same endpoint via `Accept: text/event-stream`. `provider` is optional — omitting it falls back to the tenant's stored routing policy, currently restricted to a stored \"manual\" policy.",
      operationId: "createChatCompletion",
      tags: ["Chat Completions"],
      security: DEFAULT_SECURITY,
      requestBody: {
        required: true,
        content: { "application/json": { schema: z.toJSONSchema(chatCompletionRequestSchema) } },
      },
      responses: {
        "200": {
          description: "The completion, as JSON (default) or an SSE event stream (Accept: text/event-stream).",
          content: {
            "application/json": { schema: canonicalResponseSchema },
            "text/event-stream": { schema: canonicalStreamEventSchema },
          },
        },
        "400": VALIDATION_FAILED_RESPONSE,
        "401": UNAUTHENTICATED_RESPONSE,
        "502": { description: "No provider was able to complete this request." },
      },
    },
  },
};
