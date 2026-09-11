import type { Request, Response, NextFunction } from "express";

// The Admin Web UI calls /admin/v1/* from its own browser origin. Deliberately narrow:
//
//  - Mounted ONLY in front of /admin/v1/* — /v1/* is server-to-server and never needs browser CORS.
//  - `allowedOrigin` must already be a pre-normalized origin string; this module only does exact
//    string comparison. Normalization happens once, at startup, in composition-root.ts.
//  - Never `*`, and the Origin header is never reflected unconditionally.
//  - No Access-Control-Allow-Credentials: auth here is header-based, never cookies.
//  - Must run BEFORE auth: an OPTIONS preflight carries no credentials, so auth-first would 401 it.
export function createAdminCorsMiddleware(allowedOrigin: string | undefined) {
  return function adminCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const requestOrigin = req.header("origin");
    if (allowedOrigin && requestOrigin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      // Vary: Origin so a shared cache/proxy never serves one origin's preflight response to another.
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "X-API-Key, Authorization, Content-Type");
    }

    if (req.method === "OPTIONS") {
      // Always answered here (with no CORS headers if the origin didn't match) — the browser
      // needs a response to a preflight, and no real route has its own OPTIONS handler.
      res.status(204).end();
      return;
    }

    next();
  };
}
