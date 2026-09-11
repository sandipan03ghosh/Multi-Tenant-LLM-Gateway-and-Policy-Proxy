import { Router } from "express";
import { ConfigurationNotFoundError, ConfigScope, toProjectId } from "@llm-gateway/domain";
import type {
  ConfigurationService,
  ConfigurationWriter,
  AuditLogRepository,
  ProjectRepository,
  ConfigKey,
  TenantContext,
} from "@llm-gateway/domain";
import { requirePermission } from "../../middleware/rbac.middleware.js";

export interface PolicyRouterOptions<T> {
  readonly configKey: ConfigKey;
  readonly readPermission: string;
  readonly writePermission: string;
  readonly isValidShape: (raw: unknown) => raw is T;
  readonly invalidBodyMessage: string;
  readonly auditAction: string;
}

// Shared GET/PUT shape for every tenant-scoped policy config value the Admin API exposes — one
// instance per policy; only the config key / permission codes / shape validator vary.
//
// GET returns the *effective* value (getWithFallback's project -> org -> global resolution),
// matching what the enforcement path reads. "Not configured anywhere" is 200 {policy: null}, not
// a 404 — no policy is a legitimate state for these opt-in policy types.
//
// PUT validates with the same type guard the enforcement path uses, then writes via
// ConfigurationWriter (Postgres, then a cache-invalidation publish), so the new policy takes
// effect gateway-wide with no restart. Every successful write is audited; reads are not.
export function createPolicyRouter<T>(
  configurationService: ConfigurationService,
  configurationWriter: ConfigurationWriter,
  projectRepository: ProjectRepository,
  auditLogRepository: AuditLogRepository,
  options: PolicyRouterOptions<T>,
): Router {
  const router = Router({ mergeParams: true });

  router.get("/", requirePermission(options.readPermission, auditLogRepository), async (req, res, next) => {
    const { orgId } = req.params;
    if (!orgId || Array.isArray(orgId)) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "orgId is required" });
      return;
    }

    let resolved: ScopedProjectIdResult;
    try {
      resolved = await resolveScopedProjectId(projectRepository, orgId, req.query.projectId);
    } catch (error) {
      next(error);
      return;
    }
    if (!resolved.ok) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "projectId does not belong to this organization" });
      return;
    }

    try {
      const policy = await configurationService.getWithFallback<T>(options.configKey, {
        organizationId: orgId,
        ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
      });
      res.status(200).json({ policy });
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        res.status(200).json({ policy: null });
        return;
      }
      next(error);
    }
  });

  router.put("/", requirePermission(options.writePermission, auditLogRepository), async (req, res, next) => {
    if (!options.isValidShape(req.body)) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: options.invalidBodyMessage });
      return;
    }

    const { orgId } = req.params;
    if (!orgId || Array.isArray(orgId)) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "orgId is required" });
      return;
    }

    // Guaranteed set by requireOrganizationScope ahead of every admin route — defense in depth.
    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    // requireOrganizationScope only confirms the CALLER belongs to :orgId, not that a
    // caller-supplied ?projectId= does — without this check, an admin could target another org's
    // project by supplying its id.
    let resolved: ScopedProjectIdResult;
    try {
      resolved = await resolveScopedProjectId(projectRepository, orgId, req.query.projectId);
    } catch (error) {
      next(error);
      return;
    }
    if (!resolved.ok) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "projectId does not belong to this organization" });
      return;
    }

    const scope = resolved.projectId ? ConfigScope.PROJECT : ConfigScope.ORGANIZATION;
    const scopeId = resolved.projectId ?? orgId;

    try {
      await configurationWriter.set(scope, scopeId, options.configKey, req.body);
    } catch (error) {
      next(error);
      return;
    }

    // Best-effort: a failure to record this entry must not turn a successful write into an error.
    auditLogRepository
      .create({
        organizationId: tenant.organizationId,
        projectId: tenant.projectId,
        actorType: tenant.subjectType,
        actorId: tenant.subjectId,
        action: options.auditAction,
        targetType: "configuration",
        targetId: `${scope}:${scopeId}`,
        metadata: { scope, scopeId },
      })
      .catch((error: unknown) => {
        console.error(`${options.auditAction}: failed to record audit log entry:`, error);
      });

    res.status(200).json({ policy: req.body });
  });

  return router;
}

type ScopedProjectIdResult = { readonly ok: true; readonly projectId: string | undefined } | { readonly ok: false };

// Resolves and ownership-validates the optional ?projectId= query param against :orgId — a
// foreign or nonexistent projectId resolves to {ok:false} (a 400), never silently treated as "no
// project scope". Does not catch projectRepository.findById()'s errors — an infra failure
// propagates to next(error) rather than becoming a misleading 400.
async function resolveScopedProjectId(
  projectRepository: ProjectRepository,
  orgId: string,
  rawProjectId: unknown,
): Promise<ScopedProjectIdResult> {
  if (typeof rawProjectId !== "string" || rawProjectId.length === 0) {
    return { ok: true, projectId: undefined };
  }
  const project = await projectRepository.findById(toProjectId(rawProjectId));
  if (!project || project.organizationId !== orgId) {
    return { ok: false };
  }
  return { ok: true, projectId: project.id };
}
