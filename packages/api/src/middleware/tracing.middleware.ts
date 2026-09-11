import type { Request, Response, NextFunction } from "express";
import {
  extractTraceContext,
  startManualSpan,
  runInSpanContext,
  endSpanWithOutcome,
} from "@llm-gateway/adapters-observability";

// Creates the single root span for this request's lifetime — every downstream span nests under it.
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // W3C traceparent propagation: if an upstream caller already started a trace, this request's
  // root span nests under it instead of starting a fresh one.
  // No cast needed — IncomingHttpHeaders is already structurally a Record<string, string | string[] | undefined>.
  const parentContext = extractTraceContext(req.headers);
  const span = startManualSpan(
    "http.request",
    { "http.method": req.method, "http.route": req.path },
    parentContext,
  );

  let ended = false;
  const endOnce = (outcome: "ok" | "error"): void => {
    if (ended) {
      return;
    }
    ended = true;
    span.setAttribute("http.status_code", res.statusCode);
    endSpanWithOutcome(span, outcome);
  };

  res.on("finish", () => endOnce(res.statusCode >= 500 ? "error" : "ok"));
  // "close" fires when the client disconnects before the response finishes — without this, an
  // aborted request's root span would stay open forever. (`ended` guards the post-"finish" case.)
  res.on("close", () => endOnce("error"));

  runInSpanContext(span, next);
}
