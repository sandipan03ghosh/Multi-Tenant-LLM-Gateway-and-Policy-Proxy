import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { DEFAULT_SECURITY } from "./security.js";
import { VALIDATION_FAILED_RESPONSE, UNAUTHENTICATED_RESPONSE, FORBIDDEN_RESPONSE } from "./errors.js";

export interface PolicyResourceSpec {
  /** Path segment under /admin/v1/organizations/{orgId}/, e.g. "rate-limit-policy". */
  readonly path: string;
  readonly resourceName: string;
  readonly readPermission: string;
  readonly writePermission: string;
  readonly valueSchema: JsonSchema;
  readonly invalidBodyMessage: string;
}

// Mirrors createPolicyRouter() — one GET/PUT shape reused by every tenant-scoped policy resource.
// GET returns the effective value (getWithFallback resolution) as `{ policy: T | null }`; "not
// configured anywhere" is 200 with a null policy, not a 404. PUT validates with the enforcement
// path's shape guard and returns `{ policy: T }`.
export function buildPolicyResourcePath(spec: PolicyResourceSpec): OpenApiPathItem {
  const projectIdParam = {
    name: "projectId",
    in: "query" as const,
    description: "Narrow to one project's explicitly-set value rather than the org-wide effective value.",
    schema: { type: "string" },
  };
  const orgIdParam = { name: "orgId", in: "path" as const, required: true, schema: { type: "string" } };

  return {
    get: {
      summary: `Get the effective ${spec.resourceName}`,
      operationId: `get${capitalize(spec.path)}`,
      tags: ["Admin / Policy"],
      security: DEFAULT_SECURITY,
      parameters: [orgIdParam, projectIdParam],
      responses: {
        "200": {
          description: `The effective ${spec.resourceName}, or null if unconfigured at every scope.`,
          content: {
            "application/json": {
              schema: { type: "object", properties: { policy: { oneOf: [spec.valueSchema, { type: "null" }] } }, required: ["policy"] },
            },
          },
        },
        "400": VALIDATION_FAILED_RESPONSE,
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
      },
    },
    put: {
      summary: `Set the ${spec.resourceName} at this organization (or one of its projects, via ?projectId=)`,
      description: spec.invalidBodyMessage,
      operationId: `set${capitalize(spec.path)}`,
      tags: ["Admin / Policy"],
      security: DEFAULT_SECURITY,
      parameters: [orgIdParam, projectIdParam],
      requestBody: { required: true, content: { "application/json": { schema: spec.valueSchema } } },
      responses: {
        "200": {
          description: "The value that was written.",
          content: { "application/json": { schema: { type: "object", properties: { policy: spec.valueSchema }, required: ["policy"] } } },
        },
        "400": VALIDATION_FAILED_RESPONSE,
        "401": UNAUTHENTICATED_RESPONSE,
        "403": FORBIDDEN_RESPONSE,
      },
    },
  };
}

function capitalize(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
