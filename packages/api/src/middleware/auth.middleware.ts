import type { Request, Response, NextFunction } from "express";
import { AuthenticationError } from "@llm-gateway/domain";
import type { TenantContext } from "@llm-gateway/domain";
import type { ApiKeyAuthenticator, JwtAuthenticator } from "@llm-gateway/application";
import { withSpan } from "@llm-gateway/adapters-observability";

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

const BEARER_PREFIX = "Bearer ";

// X-API-Key for machine auth, Authorization: Bearer <jwt> for human auth. HTTP glue around the
// two framework-agnostic authenticators.
export function createAuthMiddleware(
  apiKeyAuthenticator: ApiKeyAuthenticator,
  jwtAuthenticator: JwtAuthenticator,
) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    await withSpan("middleware.auth", async () => {
      try {
        const apiKeyHeader = req.header("x-api-key");
        if (apiKeyHeader) {
          req.tenantContext = await apiKeyAuthenticator.authenticate(apiKeyHeader);
          next();
          return;
        }

        const authHeader = req.header("authorization");
        if (authHeader?.startsWith(BEARER_PREFIX)) {
          const token = authHeader.slice(BEARER_PREFIX.length);
          req.tenantContext = await jwtAuthenticator.authenticate(token);
          next();
          return;
        }

        res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      } catch (error) {
        if (error instanceof AuthenticationError) {
          // Same generic message regardless of which authenticator failed — avoids enumeration.
          res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication failed" });
          return;
        }
        next(error);
      }
    });
  };
}
