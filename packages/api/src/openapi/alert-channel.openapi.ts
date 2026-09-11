import { z } from "zod";
import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { DEFAULT_SECURITY } from "./security.js";
import { VALIDATION_FAILED_RESPONSE, UNAUTHENTICATED_RESPONSE, FORBIDDEN_RESPONSE, NOT_FOUND_RESPONSE } from "./errors.js";
import { createAlertChannelSchema, updateAlertChannelSchema } from "../routes/admin/alert-channel.routes.js";

// Mirrors SafeAlertChannelView — the `url` field is always redacted to protocol+host by every
// response; the full URL is stored for delivery but never re-exposed after creation.
const safeAlertChannelSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    url: { type: "string", description: "Redacted to protocol + host, e.g. \"https://hooks.slack.com/***\" — never the full stored URL." },
    enabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "name", "url", "enabled", "createdAt", "updatedAt"],
};

const orgIdImplied = "Global resource, not organization-scoped — see prisma/schema.prisma's AlertChannel model comment.";

// Global, not organization-scoped — gated by the global-only alert-channel:read/write permissions.
export const alertChannelPaths: Record<string, OpenApiPathItem> = {
  "/admin/v1/alert-channels": {
    get: {
      summary: "List every configured alert channel (redacted)",
      description: orgIdImplied,
      operationId: "listAlertChannels",
      tags: ["Admin / Alert Channels"],
      security: DEFAULT_SECURITY,
      responses: {
        "200": {
          description: "Every configured channel, including disabled ones, with redacted URLs.",
          content: {
            "application/json": {
              schema: { type: "object", properties: { alertChannels: { type: "array", items: safeAlertChannelSchema } }, required: ["alertChannels"] },
            },
          },
        },
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
      },
    },
    post: {
      summary: "Create an alert channel",
      description: orgIdImplied,
      operationId: "createAlertChannel",
      tags: ["Admin / Alert Channels"],
      security: DEFAULT_SECURITY,
      requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(createAlertChannelSchema) } } },
      responses: {
        "201": {
          description: "The created channel (redacted).",
          content: { "application/json": { schema: { type: "object", properties: { alertChannel: safeAlertChannelSchema }, required: ["alertChannel"] } } },
        },
        "400": VALIDATION_FAILED_RESPONSE,
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
      },
    },
  },
  "/admin/v1/alert-channels/{id}": {
    put: {
      summary: "Replace an alert channel's name/url/enabled state",
      description: orgIdImplied,
      operationId: "updateAlertChannel",
      tags: ["Admin / Alert Channels"],
      security: DEFAULT_SECURITY,
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(updateAlertChannelSchema) } } },
      responses: {
        "200": {
          description: "The updated channel (redacted).",
          content: { "application/json": { schema: { type: "object", properties: { alertChannel: safeAlertChannelSchema }, required: ["alertChannel"] } } },
        },
        "400": VALIDATION_FAILED_RESPONSE,
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
        "404": NOT_FOUND_RESPONSE,
      },
    },
    delete: {
      summary: "Delete an alert channel",
      description: orgIdImplied,
      operationId: "deleteAlertChannel",
      tags: ["Admin / Alert Channels"],
      security: DEFAULT_SECURITY,
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "204": { description: "Deleted." },
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
        "404": NOT_FOUND_RESPONSE,
      },
    },
  },
};
