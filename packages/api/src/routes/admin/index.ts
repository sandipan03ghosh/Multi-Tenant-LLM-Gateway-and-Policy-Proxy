import { Router } from "express";
import type {
  AuditLogRepository,
  ConfigurationService,
  ConfigurationWriter,
  ProjectRepository,
  ProviderRegistry,
  AlertChannelConfigRepository,
} from "@llm-gateway/domain";
import { requireOrganizationScope } from "../../middleware/admin-org-scope.middleware.js";
import { createAuditLogRouter } from "./audit-log.routes.js";
import { createRateLimitPolicyRouter } from "./rate-limit-policy.routes.js";
import { createBudgetPolicyRouter } from "./budget-policy.routes.js";
import { createRoutingPolicyRouter } from "./routing-policy.routes.js";
import { createEnrichmentPolicyRouter } from "./enrichment-policy.routes.js";
import { createProviderRouter } from "./provider.routes.js";
import { createAlertChannelRouter } from "./alert-channel.routes.js";

// An options object rather than an ever-growing positional parameter list.
export interface AdminRouterDependencies {
  readonly auditLogRepository: AuditLogRepository;
  readonly configurationService: ConfigurationService;
  readonly configurationWriter: ConfigurationWriter;
  readonly projectRepository: ProjectRepository;
  readonly providerRegistry: ProviderRegistry;
  readonly registeredProviderIds: readonly string[];
  readonly alertChannelConfigRepository: AlertChannelConfigRepository;
}

// /admin/v1/*. Two mounting shapes:
//  - Most resources are organization-scoped, under /organizations/:orgId — requireOrganizationScope
//    runs first, so a mismatched org is rejected before a permission code is evaluated.
//  - Provider and alert-channel management are global resources with no owning organization,
//    mounted directly, gated by requirePermission alone (a global/platform role satisfies it).
export function createAdminRouter(deps: AdminRouterDependencies): Router {
  const router = Router();

  const orgScoped = Router({ mergeParams: true });
  orgScoped.use(requireOrganizationScope);
  orgScoped.use("/audit-log", createAuditLogRouter(deps.auditLogRepository));
  orgScoped.use(
    "/rate-limit-policy",
    createRateLimitPolicyRouter(deps.configurationService, deps.configurationWriter, deps.projectRepository, deps.auditLogRepository),
  );
  orgScoped.use(
    "/budget-policy",
    createBudgetPolicyRouter(deps.configurationService, deps.configurationWriter, deps.projectRepository, deps.auditLogRepository),
  );
  orgScoped.use(
    "/routing-policy",
    createRoutingPolicyRouter(deps.configurationService, deps.configurationWriter, deps.projectRepository, deps.auditLogRepository),
  );
  orgScoped.use(
    "/enrichment-policy",
    createEnrichmentPolicyRouter(deps.configurationService, deps.configurationWriter, deps.projectRepository, deps.auditLogRepository),
  );

  router.use("/organizations/:orgId", orgScoped);

  router.use(
    "/providers",
    createProviderRouter(deps.providerRegistry, deps.registeredProviderIds, deps.configurationWriter, deps.auditLogRepository),
  );
  router.use("/alert-channels", createAlertChannelRouter(deps.alertChannelConfigRepository, deps.auditLogRepository));

  return router;
}
