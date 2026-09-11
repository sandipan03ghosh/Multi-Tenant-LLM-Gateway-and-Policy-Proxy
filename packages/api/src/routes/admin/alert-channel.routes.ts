import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { AlertChannelConfig, DomainValidationError, toAlertChannelConfigId } from "@llm-gateway/domain";
import type { AlertChannelConfig as AlertChannelConfigType, AlertChannelConfigRepository, AuditLogRepository, TenantContext } from "@llm-gateway/domain";
import { requirePermission } from "../../middleware/rbac.middleware.js";

// Redacts everything after protocol+host — webhook URLs commonly embed a secret in the path or
// query, so only the origin is safe to return from a read endpoint. `host` includes the port and
// carries no secret. The full URL is still stored and used by deliver_webhook; this redaction is
// only in this GET response-shaping step (POST/PUT echo the caller's own submitted value).
function redactWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    // Shouldn't happen (validated at write time), but a GET must never throw over a stored value.
    return "[unparseable url]";
  }
}

interface SafeAlertChannelView {
  readonly id: string;
  readonly name: string;
  readonly url: string; // redacted — protocol + host only
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toSafeAlertChannelView(config: AlertChannelConfigType): SafeAlertChannelView {
  return {
    id: config.id,
    name: config.name,
    url: redactWebhookUrl(config.url),
    enabled: config.enabled,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  };
}

// toAlertChannelConfigId throws rather than returning a result — this wrapper translates that
// throw into the same 400 VALIDATION_FAILED shape used elsewhere in this file.
function parseAlertChannelId(raw: string | string[] | undefined): { ok: true; id: ReturnType<typeof toAlertChannelConfigId> } | { ok: false } {
  if (!raw || Array.isArray(raw)) {
    return { ok: false };
  }
  try {
    return { ok: true, id: toAlertChannelConfigId(raw) };
  } catch {
    return { ok: false };
  }
}

// Exported for the OpenAPI generator.
export const createAlertChannelSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  enabled: z.boolean().optional(),
});

export const updateAlertChannelSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  enabled: z.boolean(),
});

// /admin/v1/alert-channels — global, not organization-scoped, gated by the global-only
// alert-channel:read/write permissions. The first multi-row CRUD resource in this Admin API
// (everything before was a single GET/PUT config-key pair).
export function createAlertChannelRouter(
  alertChannelConfigRepository: AlertChannelConfigRepository,
  auditLogRepository: AuditLogRepository,
): Router {
  const router = Router();

  router.get("/", requirePermission("alert-channel:read", auditLogRepository), async (_req, res, next) => {
    try {
      const configs = await alertChannelConfigRepository.listAll();
      res.status(200).json({ alertChannels: configs.map(toSafeAlertChannelView) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", requirePermission("alert-channel:write", auditLogRepository), async (req, res, next) => {
    const parsed = createAlertChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Invalid request body",
        details: z.flattenError(parsed.error).fieldErrors,
      });
      return;
    }

    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    const now = new Date();
    let config: AlertChannelConfigType;
    try {
      config = AlertChannelConfig.create({
        id: randomUUID(),
        name: parsed.data.name,
        url: parsed.data.url,
        enabled: parsed.data.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof DomainValidationError) {
        res.status(400).json({ code: "VALIDATION_FAILED", message: error.message });
        return;
      }
      next(error);
      return;
    }

    try {
      await alertChannelConfigRepository.save(config);
    } catch (error) {
      next(error);
      return;
    }

    auditLogRepository
      .create({
        organizationId: tenant.organizationId,
        projectId: tenant.projectId,
        actorType: tenant.subjectType,
        actorId: tenant.subjectId,
        action: "admin.alert_channel.created",
        targetType: "alert_channel",
        targetId: config.id,
        metadata: { name: config.name },
      })
      .catch((error: unknown) => {
        console.error("admin.alert_channel.created: failed to record audit log entry:", error);
      });

    res.status(201).json({ alertChannel: toSafeAlertChannelView(config) });
  });

  router.put("/:id", requirePermission("alert-channel:write", auditLogRepository), async (req, res, next) => {
    const parsedId = parseAlertChannelId(req.params.id);
    if (!parsedId.ok) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "Invalid alert channel id" });
      return;
    }

    const parsed = updateAlertChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Invalid request body",
        details: z.flattenError(parsed.error).fieldErrors,
      });
      return;
    }

    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    let existing: AlertChannelConfigType | null;
    try {
      existing = await alertChannelConfigRepository.findById(parsedId.id);
    } catch (error) {
      next(error);
      return;
    }
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", message: `No alert channel with id ${String(req.params.id)}` });
      return;
    }

    let config: AlertChannelConfigType;
    try {
      config = AlertChannelConfig.create({
        id: existing.id,
        name: parsed.data.name,
        url: parsed.data.url,
        enabled: parsed.data.enabled,
        createdAt: existing.createdAt,
        updatedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof DomainValidationError) {
        res.status(400).json({ code: "VALIDATION_FAILED", message: error.message });
        return;
      }
      next(error);
      return;
    }

    try {
      await alertChannelConfigRepository.save(config);
    } catch (error) {
      next(error);
      return;
    }

    auditLogRepository
      .create({
        organizationId: tenant.organizationId,
        projectId: tenant.projectId,
        actorType: tenant.subjectType,
        actorId: tenant.subjectId,
        action: "admin.alert_channel.updated",
        targetType: "alert_channel",
        targetId: config.id,
        metadata: { name: config.name, enabled: config.enabled },
      })
      .catch((error: unknown) => {
        console.error("admin.alert_channel.updated: failed to record audit log entry:", error);
      });

    res.status(200).json({ alertChannel: toSafeAlertChannelView(config) });
  });

  router.delete("/:id", requirePermission("alert-channel:write", auditLogRepository), async (req, res, next) => {
    const parsedId = parseAlertChannelId(req.params.id);
    if (!parsedId.ok) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "Invalid alert channel id" });
      return;
    }

    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    let existing: AlertChannelConfigType | null;
    try {
      existing = await alertChannelConfigRepository.findById(parsedId.id);
    } catch (error) {
      next(error);
      return;
    }
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", message: `No alert channel with id ${String(req.params.id)}` });
      return;
    }

    try {
      await alertChannelConfigRepository.delete(parsedId.id);
    } catch (error) {
      next(error);
      return;
    }

    auditLogRepository
      .create({
        organizationId: tenant.organizationId,
        projectId: tenant.projectId,
        actorType: tenant.subjectType,
        actorId: tenant.subjectId,
        action: "admin.alert_channel.deleted",
        targetType: "alert_channel",
        targetId: parsedId.id,
        metadata: { name: existing.name },
      })
      .catch((error: unknown) => {
        console.error("admin.alert_channel.deleted: failed to record audit log entry:", error);
      });

    res.status(204).send();
  });

  return router;
}
