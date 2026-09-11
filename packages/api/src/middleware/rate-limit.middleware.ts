import type { Request, Response, NextFunction } from "express";
import type { TenantContext } from "@llm-gateway/domain";
import type { DefaultRateLimiter } from "@llm-gateway/application";
import { withSpan, rateLimitRejectionsTotal } from "@llm-gateway/adapters-observability";

// Rate Limit sits after Auth and before Enrichment — mounted globally, ahead of every business
// router, so it covers chat-completions/batches/models alike.
export function createRateLimitMiddleware(rateLimiter: DefaultRateLimiter) {
  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    await withSpan("middleware.rateLimit", async () => {
      // Guaranteed set by the auth middleware ahead of this one — defense in depth.
      const tenant: TenantContext | undefined = req.tenantContext;
      if (!tenant) {
        res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
        return;
      }

      try {
        const result = await rateLimiter.checkAndConsume(tenant);
        if (!result.allowed) {
          rateLimitRejectionsTotal.inc();
          if (result.retryAfterMs !== undefined) {
            res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000).toString());
          }
          res.status(429).json({ code: "RATE_LIMIT_EXCEEDED", message: "Rate limit exceeded" });
          return;
        }
        next();
      } catch (error) {
        next(error);
      }
    });
  };
}
