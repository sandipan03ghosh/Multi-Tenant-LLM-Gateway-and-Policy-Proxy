import type { Request, Response, NextFunction } from "express";
import type { TenantContext } from "@llm-gateway/domain";
import type { DefaultRequestSignatureVerifier } from "@llm-gateway/application";

declare global {
  namespace Express {
    interface Request {
      // Populated by app.ts's express.json({ verify }) — the exact bytes received, since the
      // signature must cover what was sent, not a re-serialization of the parsed body.
      rawBody?: Buffer;
    }
  }
}

const TIMESTAMP_HEADER = "x-gateway-timestamp";
const NONCE_HEADER = "x-gateway-nonce";
const SIGNATURE_HEADER = "x-gateway-signature";

// Request signing is optional per project, layered on top of API-key auth — mounted after auth,
// before rate-limit/budget. Thin HTTP glue: header/raw-body extraction and status mapping. Every
// signing decision lives in DefaultRequestSignatureVerifier.
export function createRequestSigningMiddleware(verifier: DefaultRequestSignatureVerifier) {
  return async function requestSigningMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    let enabled: boolean;
    try {
      enabled = await verifier.isEnabledForProject(tenant);
    } catch (error) {
      next(error);
      return;
    }
    if (!enabled) {
      next();
      return;
    }

    const timestamp = req.header(TIMESTAMP_HEADER);
    const nonce = req.header(NONCE_HEADER);
    const signature = req.header(SIGNATURE_HEADER);
    if (!timestamp || !nonce || !signature) {
      res.status(401).json({ code: "INVALID_SIGNATURE", message: "Request signature required" });
      return;
    }

    let result;
    try {
      result = await verifier.verify(tenant, req.rawBody ?? Buffer.alloc(0), timestamp, nonce, signature);
    } catch (error) {
      next(error);
      return;
    }
    if (!result.valid) {
      // reason is logged server-side only — the client always gets the same generic message.
      console.error(`requestSigningMiddleware: signature verification failed for project=${tenant.projectId ?? "-"}: ${result.reason ?? "unknown"}`);
      res.status(401).json({ code: "INVALID_SIGNATURE", message: "Request signature is invalid or expired" });
      return;
    }
    next();
  };
}
