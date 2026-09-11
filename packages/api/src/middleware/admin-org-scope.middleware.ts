import type { Request, Response, NextFunction } from "express";

// requirePermission() only checks that the caller HAS a permission code, not which organization
// it applies to. This is the other half of org-scoped RBAC: an admin token for Org A must not
// act on Org B via the URL. Mounted ahead of every admin sub-router. Same 403/no-detail shape as
// requirePermission's denial, so "wrong org" and "missing permission" are indistinguishable.
export function requireOrganizationScope(req: Request, res: Response, next: NextFunction): void {
  const tenant = req.tenantContext;
  if (!tenant) {
    res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
    return;
  }
  if (tenant.organizationId !== req.params.orgId) {
    res.status(403).json({ code: "FORBIDDEN", message: "You do not have permission to perform this action" });
    return;
  }
  next();
}
