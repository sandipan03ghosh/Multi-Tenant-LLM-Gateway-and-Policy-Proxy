import { Router } from "express";
import { z } from "zod";
import { ProviderModelNotFoundError } from "@llm-gateway/domain";
import type { CanonicalRequest, ScheduledRequest, RoutingPolicy, TenantContext } from "@llm-gateway/domain";
import type { DefaultRequestEnrichmentPipeline, StaticProviderCatalog } from "@llm-gateway/application";
import type { RedisRequestScheduler } from "@llm-gateway/adapters-redis";
import type { PrismaBatchRequestRepository } from "@llm-gateway/adapters-postgres";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

// Exported for the OpenAPI generator.
export const createBatchRequestSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  // Format-validated here for fast feedback; the SSRF guard (private/loopback targets) lives at
  // delivery time in the worker's deliver-webhook handler, immune to a POST-time TOCTOU gap.
  webhookUrl: z.string().url().optional(),
  requestClass: z.enum(["batch", "background"]).default("batch"),
});

// POST /v1/batches (202 + job handle), GET /v1/batches/{id}. Requires authentication.
export function createBatchesRouter(
  providerCatalog: StaticProviderCatalog,
  enrichmentPipeline: DefaultRequestEnrichmentPipeline,
  requestScheduler: RedisRequestScheduler,
  batchRequestRepository: PrismaBatchRequestRepository,
): Router {
  const router = Router();

  router.post("/v1/batches", async (req, res, next) => {
    const parsed = createBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Invalid request body",
        details: z.flattenError(parsed.error).fieldErrors,
      });
      return;
    }
    const { provider, model, messages, temperature, maxOutputTokens, webhookUrl, requestClass } = parsed.data;

    try {
      providerCatalog.getModel(provider, model);
    } catch (error) {
      if (error instanceof ProviderModelNotFoundError) {
        res.status(400).json({ code: "MODEL_NOT_FOUND", message: error.message });
        return;
      }
      next(error);
      return;
    }

    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    const requestedCanonicalRequest: CanonicalRequest = {
      model,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    };

    let enrichmentResult;
    try {
      enrichmentResult = await enrichmentPipeline.run(requestedCanonicalRequest, tenant);
    } catch (error) {
      next(error);
      return;
    }
    if (enrichmentResult.action === "reject") {
      res.status(400).json({ code: enrichmentResult.code, message: enrichmentResult.reason });
      return;
    }

    const routingPolicy: RoutingPolicy = { type: "manual", providerId: provider };
    const scheduledRequest: ScheduledRequest = {
      requestClass,
      tenant,
      canonicalRequest: enrichmentResult.request,
      routingPolicy,
    };

    // No admit() call: batch/background always resolve to "queue", so it would be a redundant round trip.
    let ticket;
    try {
      ticket = await requestScheduler.enqueue(scheduledRequest);
    } catch (error) {
      next(error);
      return;
    }

    try {
      await batchRequestRepository.create({
        id: ticket.ticketId,
        organizationId: tenant.organizationId,
        projectId: tenant.projectId ?? null,
        requestClass,
        canonicalRequest: enrichmentResult.request,
        routingPolicy,
        webhookUrl: webhookUrl ?? null,
      });
    } catch (error) {
      // The request is already queued in Redis and will execute even though its tracking row
      // failed to persist — an accepted narrow gap. The client sees a failed POST and can retry.
      console.error(`POST /v1/batches: enqueued ticket ${ticket.ticketId} but failed to persist its tracking row:`, error);
      next(error);
      return;
    }

    res.status(202).json({ id: ticket.ticketId, status: "pending" });
  });

  router.get("/v1/batches/:id", async (req, res, next) => {
    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    try {
      const record = await batchRequestRepository.findById(req.params.id, tenant.organizationId, tenant.projectId ?? null);
      if (!record) {
        // Same shape whether the id doesn't exist or belongs to another tenant — avoids leaking which.
        res.status(404).json({ code: "BATCH_NOT_FOUND", message: "Batch request not found" });
        return;
      }

      const response: Record<string, unknown> = {
        id: record.id,
        status: record.status,
        createdAt: record.createdAt.toISOString(),
      };
      if (record.completedAt) {
        response.completedAt = record.completedAt.toISOString();
      }
      if (record.status === "succeeded" && record.result) {
        response.result = record.result;
      }
      if (record.status === "failed") {
        response.error = { code: record.errorCode, message: record.errorMessage };
      }
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
