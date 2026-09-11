import type { JsonSchema } from "./types.js";

// Mirrors auth.middleware.ts: X-API-Key for machine auth, Authorization: Bearer <jwt> for human auth.
export const SECURITY_SCHEMES: Record<string, JsonSchema> = {
  apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
  bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
};

// A logical OR of the two schemes (separate entries in the security array). Applied to every
// operation except the four unauthenticated health endpoints.
export const DEFAULT_SECURITY: readonly Record<string, readonly string[]>[] = [{ apiKeyAuth: [] }, { bearerAuth: [] }];
