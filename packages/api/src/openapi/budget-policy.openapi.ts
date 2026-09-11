import type { JsonSchema, OpenApiPathItem } from "./types.js";
import { buildPolicyResourcePath } from "./policy-resource.openapi.js";

// Mirrors isValidBudgetPolicyShape in default-budget-enforcer.ts exactly.
const budgetPolicySchema: JsonSchema = {
  type: "object",
  properties: {
    period: { type: "string", enum: ["daily", "monthly"] },
    hardLimitMicros: { type: "number", exclusiveMinimum: 0, description: "Integer micros (1 unit = 1e-6 of `currency`)." },
    softLimitMicros: { oneOf: [{ type: "number", minimum: 0 }, { type: "null" }], description: "Crossing this logs a warning; it is not a hard-stop." },
    currency: { type: "string", minLength: 1 },
    reservationMicros: { type: "number", exclusiveMinimum: 0, description: "Optional; defaults to 1000 micros when omitted." },
  },
  required: ["period", "hardLimitMicros", "softLimitMicros", "currency"],
};

export const budgetPolicyPaths: Record<string, OpenApiPathItem> = {
  "/admin/v1/organizations/{orgId}/budget-policy": buildPolicyResourcePath({
    path: "budget-policy",
    resourceName: "BudgetPolicy",
    readPermission: "budget.policy:read",
    writePermission: "budget.policy:write",
    valueSchema: budgetPolicySchema,
    invalidBodyMessage: "Request body is not a valid BudgetPolicy",
  }),
};
