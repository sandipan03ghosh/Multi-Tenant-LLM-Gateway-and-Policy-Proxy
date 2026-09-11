import { Router } from "express";
import { ConfigScope, GLOBAL_CONFIG_SCOPE_ID } from "@llm-gateway/domain";
import type { ConfigurationWriter, ProviderRegistry, AuditLogRepository, TenantContext } from "@llm-gateway/domain";
import { providerEnabledConfigKey } from "@llm-gateway/application";
import { requirePermission } from "../../middleware/rbac.middleware.js";

// GET /admin/v1/providers, PUT /admin/v1/providers/:providerId/enabled.
//
// Not mounted under /organizations/:orgId — provider availability is a gateway-operator concern,
// not per-tenant. Gated by the global-only provider:read / provider:write permissions, which
// only a platform role carries.
export function createProviderRouter(
  providerRegistry: ProviderRegistry,
  registeredProviderIds: readonly string[],
  configurationWriter: ConfigurationWriter,
  auditLogRepository: AuditLogRepository,
): Router {
  const router = Router();

  router.get("/", requirePermission("provider:read", auditLogRepository), (_req, res) => {
    const providers = registeredProviderIds.map((providerId) => ({
      providerId,
      enabled: providerRegistry.isEnabled(providerId),
    }));
    res.status(200).json({ providers });
  });

  router.put("/:providerId/enabled", requirePermission("provider:write", auditLogRepository), async (req, res, next) => {
    const { providerId } = req.params;
    if (!providerId || Array.isArray(providerId)) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "providerId is required" });
      return;
    }
    // Validated against the adapters this process was constructed with — an arbitrary string
    // would write a config entry InMemoryProviderRegistry never reads.
    if (!registeredProviderIds.includes(providerId)) {
      res.status(404).json({ code: "NOT_FOUND", message: `Unknown provider: ${providerId}` });
      return;
    }

    // req.body is untyped (`any`) — read via `unknown` so the check below is a real type guard.
    const body: unknown = req.body;
    if (typeof body !== "object" || body === null || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "Request body must be { enabled: boolean }" });
      return;
    }
    const enabled = (body as { enabled: boolean }).enabled;

    // Guaranteed set for any request that reached requirePermission above — defense in depth.
    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    try {
      await configurationWriter.set(
        ConfigScope.GLOBAL,
        GLOBAL_CONFIG_SCOPE_ID,
        providerEnabledConfigKey(providerId),
        enabled,
      );
    } catch (error) {
      next(error);
      return;
    }

    // Best-effort, matching every other Admin mutation's audit write.
    auditLogRepository
      .create({
        organizationId: tenant.organizationId,
        projectId: tenant.projectId,
        actorType: tenant.subjectType,
        actorId: tenant.subjectId,
        action: "admin.provider.enabled_changed",
        targetType: "provider",
        targetId: providerId,
        metadata: { enabled },
      })
      .catch((error: unknown) => {
        console.error("admin.provider.enabled_changed: failed to record audit log entry:", error);
      });

    res.status(200).json({ providerId, enabled });
  });

  return router;
}
