import type { CanonicalMessage } from "./canonical-request.js";

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

// Generalized across providers' finish-reason vocabularies — each adapter maps its provider's
// native reason onto this set.
export type FinishReason = "stop" | "length" | "content_filter" | "error";

// Provider-agnostic response shape — the counterpart to CanonicalRequest.
export interface CanonicalResponse {
  readonly id: string;
  readonly model: string;
  readonly message: CanonicalMessage;
  readonly usage: TokenUsage;
  readonly finishReason: FinishReason;
}
