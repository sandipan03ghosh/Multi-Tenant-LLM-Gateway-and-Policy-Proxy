import type { OpenApiDocument } from "./types.js";
import { SECURITY_SCHEMES } from "./security.js";
import { healthPaths } from "./health.openapi.js";
import { modelsPaths } from "./models.openapi.js";
import { chatCompletionsPaths } from "./chat-completions.openapi.js";
import { batchesPaths } from "./batches.openapi.js";
import { auditLogPaths } from "./audit-log.openapi.js";
import { rateLimitPolicyPaths } from "./rate-limit-policy.openapi.js";
import { budgetPolicyPaths } from "./budget-policy.openapi.js";
import { routingPolicyPaths } from "./routing-policy.openapi.js";
import { enrichmentPolicyPaths } from "./enrichment-policy.openapi.js";
import { providerPaths } from "./provider.openapi.js";
import { alertChannelPaths } from "./alert-channel.openapi.js";

// Assembles the full OpenAPI 3.1 document from every route group's own fragment. The version is a
// literal, decoupled from the package's semver so the API contract version bumps only on an
// actual contract change.
export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: "LLM Gateway API",
      version: "1.0.0",
      description:
        "Public API (/v1/*) and Admin API (/admin/v1/*) for the LLM Gateway. Generated from this repository's own zod schemas and domain shape validators. A static artifact — the running gateway never serves it.",
    },
    servers: [{ url: "/", description: "Relative to wherever this gateway is deployed." }],
    paths: {
      ...healthPaths,
      ...modelsPaths,
      ...chatCompletionsPaths,
      ...batchesPaths,
      ...auditLogPaths,
      ...rateLimitPolicyPaths,
      ...budgetPolicyPaths,
      ...routingPolicyPaths,
      ...enrichmentPolicyPaths,
      ...providerPaths,
      ...alertChannelPaths,
    },
    components: {
      securitySchemes: SECURITY_SCHEMES,
    },
  };
}
