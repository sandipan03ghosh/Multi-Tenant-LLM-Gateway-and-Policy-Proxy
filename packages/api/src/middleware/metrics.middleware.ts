import type { Request, Response, NextFunction } from "express";
import { httpRequestsTotal, httpRequestDurationSeconds } from "@llm-gateway/adapters-observability";

// Mounted early so every request is counted, including ones that fail before a router. The
// "route" label is read in the "finish" listener (after Express has matched req.route), so it's
// the normalized route pattern (e.g. "/v1/batches/:id"), not the raw path — the raw path would
// put resource ids into a label value and explode cardinality.
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    // req.route is loosely typed (`any`) — narrow explicitly rather than letting `any` reach the metric labels.
    const route = (req.route as { path?: string } | undefined)?.path ?? "unmatched";
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
  });
  next();
}
