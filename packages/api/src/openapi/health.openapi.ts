import type { JsonSchema, OpenApiPathItem } from "./types.js";

// Mirrors health.routes.ts. No `security` — these four are unauthenticated so an orchestrator
// healthcheck never needs credentials.
const okStatusSchema: JsonSchema = {
  type: "object",
  properties: { status: { type: "string", enum: ["ok"] } },
  required: ["status"],
};

const dependencyCheckResultSchema: JsonSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    reason: { type: "string", enum: ["timeout", "unreachable"] },
  },
  required: ["ok"],
};

const readinessResultSchema: JsonSchema = {
  type: "object",
  properties: {
    ready: { type: "boolean" },
    checks: {
      type: "object",
      properties: {
        postgres: dependencyCheckResultSchema,
        redis: dependencyCheckResultSchema,
        configuration: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      },
      required: ["postgres", "redis", "configuration"],
    },
  },
  required: ["ready", "checks"],
};

const versionInfoSchema: JsonSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
    nodeEnv: { type: "string" },
    gitCommitSha: { type: "string" },
  },
  required: ["version", "nodeEnv", "gitCommitSha"],
};

export const healthPaths: Record<string, OpenApiPathItem> = {
  "/health": {
    get: {
      summary: "Process liveness (legacy path)",
      operationId: "getHealth",
      tags: ["Health"],
      security: [],
      responses: { "200": { description: "The process is up.", content: { "application/json": { schema: okStatusSchema } } } },
    },
  },
  "/live": {
    get: {
      summary: "Kubernetes-conventional liveness probe",
      description: "Never touches Postgres/Redis — always 200 as long as the process can respond at all.",
      operationId: "getLive",
      tags: ["Health"],
      security: [],
      responses: { "200": { description: "The process is up.", content: { "application/json": { schema: okStatusSchema } } } },
    },
  },
  "/ready": {
    get: {
      summary: "Readiness probe (Postgres + Redis + ConfigurationService)",
      operationId: "getReady",
      tags: ["Health"],
      security: [],
      responses: {
        "200": { description: "Every dependency is reachable.", content: { "application/json": { schema: readinessResultSchema } } },
        "503": { description: "At least one dependency is unreachable.", content: { "application/json": { schema: readinessResultSchema } } },
      },
    },
  },
  "/version": {
    get: {
      summary: "Running build/version info",
      operationId: "getVersion",
      tags: ["Health"],
      security: [],
      responses: { "200": { description: "Version metadata.", content: { "application/json": { schema: versionInfoSchema } } } },
    },
  },
};
