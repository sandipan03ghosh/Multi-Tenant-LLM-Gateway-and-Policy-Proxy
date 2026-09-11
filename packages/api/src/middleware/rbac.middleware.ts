import type { Request, Response, NextFunction } from "express";
import type { AuditLogRepository } from "@llm-gateway/domain";

// Checks the required permission against req.tenantContext.permissions (populated by
// createAuthMiddleware) before a handler runs. A failed check returns 403 with no detail about
// which permission would have worked. A denial is recorded to the audit log, best-effort — a
// failure to record it must not turn a correct 403 into a 500.
export function requirePermission(code: string, auditLogRepository: AuditLogRepository) {
  return function rbacMiddleware(req: Request, res: Response, next: NextFunction): void {
    const tenant = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }
    if (!tenant.permissions.includes(code)) {
      res.status(403).json({ code: "FORBIDDEN", message: "You do not have permission to perform this action" });
      auditLogRepository
        .create({
          organizationId: tenant.organizationId,
          projectId: tenant.projectId,
          actorType: tenant.subjectType,
          actorId: tenant.subjectId,
          action: "rbac.permission_denied",
          targetType: "permission",
          targetId: code,
          metadata: { path: req.path, method: req.method },
        })
        .catch((error: unknown) => {
          console.error("requirePermission: failed to record audit log entry for a denial:", error);
        });
      return;
    }
    next();
  };
}
