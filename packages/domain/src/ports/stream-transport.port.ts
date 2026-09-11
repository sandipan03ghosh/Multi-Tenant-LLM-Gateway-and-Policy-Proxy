import type { CanonicalStreamEvent } from "../value-objects/canonical-stream-event.js";

export type CloseReason = "completed" | "client_disconnect" | "error";

// Opaque request-scoped correlation info — minimal and framework-agnostic. A concrete transport
// associates it with its own connection out-of-band, not through this interface.
export interface RequestContext {
  readonly requestId: string;
}

export interface StreamHandle {
  readonly requestId: string;
}

// Transport delivery is separate from CanonicalStreamEvent production so a future WebSocket/HTTP2
// transport is a new implementation, not a provider-adapter change. SSE is the only one for now.
export interface StreamTransport {
  open(context: RequestContext): StreamHandle;
  send(handle: StreamHandle, event: CanonicalStreamEvent): void;
  close(handle: StreamHandle, reason: CloseReason): void;
}
