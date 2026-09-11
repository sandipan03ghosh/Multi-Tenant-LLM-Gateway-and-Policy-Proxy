import type { GatewayErrorPayload } from "./types.js";

// One error class with fields, not a subclass per error code — callers branch on `.code` (a
// stable string contract). Thrown for any non-2xx response with the standard {code, message}
// envelope — the request reached the server and was rejected.
export class LlmGatewayApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LlmGatewayApiError";
  }

  static fromPayload(status: number, payload: GatewayErrorPayload): LlmGatewayApiError {
    return new LlmGatewayApiError(payload.code, payload.message, status, payload.details);
  }
}

// Thrown when every transport retry failed without ever receiving an HTTP response (DNS failure,
// connection refused/reset, timeout). Distinct from LlmGatewayApiError so a caller can tell "the
// server never saw this request" from "the server saw it and rejected it".
export class LlmGatewayNetworkError extends Error {
  constructor(
    message: string,
    public override readonly cause: unknown,
  ) {
    super(message);
    this.name = "LlmGatewayNetworkError";
  }
}
