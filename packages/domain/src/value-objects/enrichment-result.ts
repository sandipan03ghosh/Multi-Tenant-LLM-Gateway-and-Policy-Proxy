import type { CanonicalRequest } from "./canonical-request.js";

// A stage either transforms the request and continues, or rejects it with a client-facing
// reason. No separate "skip" outcome — a stage that doesn't act returns `continue` unchanged.
export type EnrichmentResult =
  | { readonly action: "continue"; readonly request: CanonicalRequest }
  | { readonly action: "reject"; readonly code: string; readonly reason: string };
