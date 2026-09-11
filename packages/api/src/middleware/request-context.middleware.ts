import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger, runWithRequestId } from "@llm-gateway/adapters-observability";

const REQUEST_ID_HEADER = "x-request-id";
// Allowlist: alphanumeric plus hyphen/underscore, capped. An inbound X-Request-Id is untrusted
// input — this rejects anything that could carry a header/log injection payload or an unbounded value.
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

function resolveRequestId(inbound: string | string[] | undefined): string {
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  return candidate && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

// Mounted first, before body parsing — every request gets a requestId and a completion log line.
// Honors a valid inbound X-Request-Id for cross-service continuity, else generates a UUID.
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  res.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  // Reads requestId from this closure, not getCurrentRequestId() — the "finish" event fires from
  // Node's HTTP internals across an AsyncLocalStorage boundary that doesn't reliably preserve the store.
  res.on("finish", () => {
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        requestId,
      },
      "request completed",
    );
  });

  runWithRequestId(requestId, next);
}
