import type { CanonicalRequest } from "../value-objects/canonical-request.js";
import type { CanonicalResponse } from "../value-objects/canonical-response.js";
import type { CanonicalStreamEvent } from "../value-objects/canonical-stream-event.js";
import type { GatewayError } from "../errors/gateway.error.js";

// Implemented once per provider (adapters-provider-gemini, adapters-provider-groq, ...).
// `signal`, when provided, must abort the underlying upstream call/connection — a client
// disconnect mid-stream must stop the provider call, not just stop forwarding bytes.
export interface ProviderPort {
  readonly providerId: string;
  complete(request: CanonicalRequest): Promise<CanonicalResponse>;
  stream(request: CanonicalRequest, signal?: AbortSignal): AsyncIterable<CanonicalStreamEvent>;
  translateError(raw: unknown): GatewayError;
}
