import { z } from "zod";
import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { DEFAULT_SECURITY } from "./security.js";
import { VALIDATION_FAILED_RESPONSE, UNAUTHENTICATED_RESPONSE, FORBIDDEN_RESPONSE } from "./errors.js";
import { listAuditLogQuerySchema } from "../routes/admin/audit-log.routes.js";

// Mirrors domain's AuditLogEntry exactly.
const auditLogEntrySchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    organizationId: { type: "string" },
    projectId: { type: "string", nullable: true },
    actorType: { type: "string", enum: ["user", "api_key"] },
    actorId: { type: "string" },
    action: { type: "string" },
    targetType: { type: "string", nullable: true },
    targetId: { type: "string", nullable: true },
    metadata: { type: "object", additionalProperties: true, nullable: true },
    createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "organizationId", "projectId", "actorType", "actorId", "action", "targetType", "targetId", "metadata", "createdAt"],
};

const queryJsonSchema = z.toJSONSchema(listAuditLogQuerySchema) as { properties?: Record<string, JsonSchema> };

export const auditLogPaths: Record<string, OpenApiPathItem> = {
  "/admin/v1/organizations/{orgId}/audit-log": {
    get: {
      summary: "List this organization's audit log, newest first (cursor-paginated)",
      operationId: "listAuditLog",
      tags: ["Admin / Audit Log"],
      security: DEFAULT_SECURITY,
      parameters: [
        { name: "orgId", in: "path", required: true, schema: { type: "string" } },
        { name: "limit", in: "query", schema: queryJsonSchema.properties?.limit ?? { type: "integer" } },
        { name: "cursor", in: "query", schema: queryJsonSchema.properties?.cursor ?? { type: "string" } },
      ],
      responses: {
        "200": {
          description: "A page of audit log entries.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  entries: { type: "array", items: auditLogEntrySchema },
                  nextCursor: { type: "string", nullable: true },
                },
                required: ["entries", "nextCursor"],
              },
            },
          },
        },
        "400": VALIDATION_FAILED_RESPONSE,
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
      },
    },
  },
};
