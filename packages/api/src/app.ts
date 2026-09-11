import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { logger } from "@llm-gateway/adapters-observability";
import { requestContextMiddleware } from "./middleware/request-context.middleware.js";
import { tracingMiddleware } from "./middleware/tracing.middleware.js";
import { metricsMiddleware } from "./middleware/metrics.middleware.js";
import { createAuthMiddleware } from "./middleware/auth.middleware.js";
import { createAdminCorsMiddleware } from "./middleware/admin-cors.middleware.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.middleware.js";
import { createBudgetMiddleware } from "./middleware/budget.middleware.js";
import { createRequestSigningMiddleware } from "./middleware/request-signing.middleware.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createModelsRouter } from "./routes/models.routes.js";
import { createChatCompletionsRouter } from "./routes/chat-completions.routes.js";
import { createBatchesRouter } from "./routes/batches.routes.js";
import { createAdminRouter } from "./routes/admin/index.js";
import type { Composition } from "./composition-root.js";

export function createApp(composition: Composition): Express {
  const app = express();

  // Before anything else, including body parsing — so every request gets a requestId and a
  // completion log line.
  app.use(requestContextMiddleware);

  // Creates the single root span every downstream span nests under.
  app.use(tracingMiddleware);

  // Records http request metrics for every request, including ones that never reach a router.
  app.use(metricsMiddleware);

  // Captures the exact received bytes onto req.rawBody — request-signing.middleware.ts verifies
  // the client's HMAC over what it actually sent, not a re-serialization.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request).rawBody = Buffer.from(buf);
      },
    }),
  );

  // Health/live/ready/version before auth — unauthenticated, so an orchestrator's healthcheck
  // needs no credentials.
  app.use(createHealthRouter(composition.checkReadiness, composition.versionInfo));

  // Before auth: a CORS preflight (OPTIONS) carries no credentials, so auth-first would 401 the
  // preflight and the browser would abort the real request. Scoped to /admin/v1/* only.
  app.use("/admin/v1", createAdminCorsMiddleware(composition.adminUiOrigin));

  const authMiddleware = createAuthMiddleware(composition.apiKeyAuthenticator, composition.jwtAuthenticator);
  app.use(authMiddleware);

  // Auth -> Request Signing -> Rate Limit -> Budget Reserve apply to every route below.
  // Enrichment runs inside each route handler, still after these.
  app.use(createRequestSigningMiddleware(composition.requestSignatureVerifier));
  app.use(createRateLimitMiddleware(composition.rateLimiter));
  app.use(createBudgetMiddleware(composition.budgetEnforcer));

  app.use(createModelsRouter(composition.providerCatalog, composition.registeredProviderIds));
  app.use(
    createChatCompletionsRouter(
      composition.routingEngine,
      composition.providerCatalog,
      composition.enrichmentPipeline,
      composition.costEngine,
      composition.budgetEnforcer,
      composition.configurationService,
    ),
  );
  app.use(
    createBatchesRouter(
      composition.providerCatalog,
      composition.enrichmentPipeline,
      composition.requestScheduler,
      composition.batchRequestRepository,
    ),
  );

  // /admin/v1/* — RBAC-gated operator surface, mostly organization-scoped plus a few global
  // resources (providers, alert-channels). requireOrganizationScope/requirePermission() are
  // enforced inside createAdminRouter.
  app.use(
    "/admin/v1",
    createAdminRouter({
      auditLogRepository: composition.auditLogRepository,
      configurationService: composition.configurationService,
      configurationWriter: composition.configurationWriter,
      projectRepository: composition.projectRepository,
      providerRegistry: composition.providerRegistry,
      registeredProviderIds: composition.registeredProviderIds,
      alertChannelConfigRepository: composition.alertChannelConfigRepository,
    }),
  );

  // Fallback error handler — expected failures are handled at their own route; anything reaching
  // here is unexpected, so it responds with a fixed generic message and logs the real error.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: error }, "Unhandled error");
    res.status(500).json({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" });
  });

  return app;
}
