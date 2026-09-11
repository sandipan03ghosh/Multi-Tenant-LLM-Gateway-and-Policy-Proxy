import type { Response } from "express";
import type { StreamTransport, RequestContext, StreamHandle, CloseReason, CanonicalStreamEvent } from "@llm-gateway/domain";

// The concrete SSE implementation of StreamTransport. Lives in packages/api because it's Express
// response glue, constructed fresh per request around that request's own `res`.
export class SseStreamTransport implements StreamTransport {
  constructor(private readonly res: Response) {}

  open(context: RequestContext): StreamHandle {
    this.res.status(200);
    this.res.setHeader("Content-Type", "text/event-stream");
    this.res.setHeader("Cache-Control", "no-cache, no-transform");
    this.res.setHeader("Connection", "keep-alive");
    this.res.flushHeaders();
    return { requestId: context.requestId };
  }

  send(_handle: StreamHandle, event: CanonicalStreamEvent): void {
    if (this.isDead()) {
      // The client disconnected between events — drop silently rather than write() to a dead
      // stream, which can throw synchronously and propagate out of the driving loop.
      return;
    }
    this.res.write(`event: ${event.type}\n`);
    this.res.write(`data: ${JSON.stringify(this.toWirePayload(event))}\n\n`);
  }

  close(handle: StreamHandle, reason: CloseReason): void {
    if (this.isDead()) {
      // Already ended/destroyed — most commonly a client disconnect. end() again would be redundant.
      return;
    }
    if (reason === "error") {
      console.error(`SSE stream (requestId=${handle.requestId}) closing due to a stream error`);
    }
    this.res.end();
  }

  private isDead(): boolean {
    return this.res.writableEnded || this.res.destroyed;
  }

  // `error` carries a full GatewayError internally (including `cause`) — strip it to the
  // client-safe code/message so a raw provider error/stack trace never reaches the wire.
  private toWirePayload(event: CanonicalStreamEvent): unknown {
    if (event.type === "error") {
      return { type: "error", code: event.error.code, message: event.error.message };
    }
    return event;
  }
}
