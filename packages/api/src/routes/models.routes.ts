import { Router } from "express";
import type { StaticProviderCatalog } from "@llm-gateway/application";

// Requires authentication — no anonymous endpoints beyond /health. No permission check beyond
// "authenticated".
export function createModelsRouter(
  providerCatalog: StaticProviderCatalog,
  registeredProviderIds: readonly string[],
): Router {
  const router = Router();
  router.get("/v1/models", (_req, res) => {
    const models = registeredProviderIds.flatMap((providerId) => providerCatalog.listModels(providerId));
    res.status(200).json({ data: models });
  });
  return router;
}
