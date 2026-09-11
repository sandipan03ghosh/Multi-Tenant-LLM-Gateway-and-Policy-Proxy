import { Router } from "express";
import { z } from "zod";
import type { AuditLogRepository } from "@llm-gateway/domain";
import { requirePermission } from "../../middleware/rbac.middleware.js";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

// Exported for the OpenAPI generator.
export const listAuditLogQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});

// GET /admin/v1/organizations/:orgId/audit-log — org-scoped, gated by the audit.log:read permission.
export function createAuditLogRouter(auditLogRepository: AuditLogRepository): Router {
  const router = Router({ mergeParams: true });

  router.get("/", requirePermission("audit.log:read", auditLogRepository), async (req, res, next) => {
    const parsed = listAuditLogQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Invalid query parameters",
        details: z.flattenError(parsed.error).fieldErrors,
      });
      return;
    }

    const { orgId } = req.params;
    if (!orgId || Array.isArray(orgId)) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "orgId is required" });
      return;
    }

    try {
      const page = await auditLogRepository.listByOrganization(orgId, {
        limit: parsed.data.limit ?? DEFAULT_LIMIT,
        ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
      });
      res.status(200).json({
        entries: page.entries.map((entry) => ({
          ...entry,
          createdAt: entry.createdAt.toISOString(),
        })),
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      // A malformed cursor throws in the Prisma adapter — client input, so a 400, not a 500.
      if (error instanceof Error && error.message === "Invalid audit log cursor") {
        res.status(400).json({ code: "VALIDATION_FAILED", message: "Invalid cursor" });
        return;
      }
      next(error);
    }
  });

  return router;
}
