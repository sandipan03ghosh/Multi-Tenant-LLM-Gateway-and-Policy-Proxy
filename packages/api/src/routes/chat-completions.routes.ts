import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { GatewayError, NoAvailableProviderError, ProviderModelNotFoundError, ConfigurationNotFoundError } from "@llm-gateway/domain";
import type { CanonicalRequest, CanonicalStreamEvent, CloseReason, TenantContext, ConfigurationService, RoutingPolicy } from "@llm-gateway/domain";
import { ROUTING_POLICY_CONFIG_KEY, toTenantScope } from "@llm-gateway/application";
import type {
  DefaultRoutingEngine,
  StaticProviderCatalog,
  DefaultRequestEnrichmentPipeline,
  DefaultCostEngine,
  DefaultBudgetEnforcer,
  ResolvedPeriod,
} from "@llm-gateway/application";
import { withSpan, startManualSpan, runInSpanContext, endSpanWithOutcome } from "@llm-gateway/adapters-observability";
import type { Span } from "@llm-gateway/adapters-observability";
import { SseStreamTransport } from "../streaming/sse-stream-transport.js";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

// Exported for the OpenAPI generator — the spec is built from this exact validator via
// z.toJSONSchema(), not a copy that could drift.
export const chatCompletionRequestSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

// GatewayError.httpStatus is set by adapter code — whitelisting what's surfaced to a client
// guards against an adapter constructing one with an unexpected value. Anything else falls back to 502.
const SAFE_UPSTREAM_HTTP_STATUSES = new Set([400, 401, 403, 404, 408, 409, 422, 429, 502, 503, 504]);

function toSafeUpstreamStatus(httpStatus: number): number {
  return SAFE_UPSTREAM_HTTP_STATUSES.has(httpStatus) ? httpStatus : 502;
}

// Requires authentication. Routing policy comes from an explicit `provider` field on the request
// (manual routing) or, when omitted, the tenant's stored RoutingPolicy from ConfigurationService.
export function createChatCompletionsRouter(
  routingEngine: DefaultRoutingEngine,
  providerCatalog: StaticProviderCatalog,
  enrichmentPipeline: DefaultRequestEnrichmentPipeline,
  costEngine: DefaultCostEngine,
  budgetEnforcer: DefaultBudgetEnforcer,
  configurationService: ConfigurationService,
): Router {
  const router = Router();

  router.post("/v1/chat/completions", async (req, res, next) => {
    const parsed = chatCompletionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Invalid request body",
        details: z.flattenError(parsed.error).fieldErrors,
      });
      return;
    }

    const { provider: requestedProvider, model, messages, temperature, maxOutputTokens } = parsed.data;

    // Guaranteed set by the auth middleware ahead of this router — defense in depth. Resolved
    // before routing policy, since an omitted `provider` needs `tenant` to look up a stored policy.
    const tenant: TenantContext | undefined = req.tenantContext;
    if (!tenant) {
      res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
      return;
    }

    // An omitted `provider` falls back to the tenant's stored RoutingPolicy. Restricted to a
    // stored "manual" policy for now: cost pricing is keyed by providerId:modelId, and a
    // multi-candidate policy would leave no way to know which provider to bill, since
    // CanonicalResponse doesn't report which candidate served the request.
    let routingPolicy: RoutingPolicy;
    let providerId: string;
    if (requestedProvider) {
      providerId = requestedProvider;
      routingPolicy = { type: "manual", providerId };
    } else {
      let stored: RoutingPolicy;
      try {
        stored = await configurationService.getWithFallback<RoutingPolicy>(ROUTING_POLICY_CONFIG_KEY, toTenantScope(tenant));
      } catch (error) {
        if (error instanceof ConfigurationNotFoundError) {
          res.status(400).json({
            code: "VALIDATION_FAILED",
            message: "No provider specified and no routing policy is configured for this tenant",
          });
          return;
        }
        next(error);
        return;
      }
      if (stored.type !== "manual") {
        res.status(400).json({
          code: "VALIDATION_FAILED",
          message: `The configured routing policy is of type "${stored.type}", which requires an explicit provider on this endpoint today — specify one`,
        });
        return;
      }
      providerId = stored.providerId;
      routingPolicy = stored;
    }

    try {
      providerCatalog.getModel(providerId, model);
    } catch (error) {
      if (error instanceof ProviderModelNotFoundError) {
        res.status(400).json({ code: "MODEL_NOT_FOUND", message: error.message });
        return;
      }
      next(error);
      return;
    }

    // Set by budget.middleware.ts when a BudgetPolicy was in effect; undefined means no policy,
    // so the debit() call below is simply skipped.
    const budgetPeriod: ResolvedPeriod | undefined = req.budgetReservation?.period;

    const requestedCanonicalRequest: CanonicalRequest = {
      model,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    };

    // Runs before routing — a `reject` outcome is client-input-driven, so it gets the same 400
    // treatment as other input validation failures.
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
    const canonicalRequest = enrichmentResult.request;

    // Streaming is content-negotiated on this same endpoint, not a separate route.
    const wantsStream = (req.get("accept") ?? "").includes("text/event-stream");
    if (wantsStream) {
      // Started manually because its end point isn't known here — ended inside
      // handleStreamingCompletion's finally block based on the actual closeReason.
      const span = startManualSpan("chat.completion", {
        "provider.id": providerId,
        "llm.model": model,
        "llm.streaming": true,
      });
      await runInSpanContext(span, () =>
        handleStreamingCompletion(
          req,
          res,
          next,
          routingEngine,
          canonicalRequest,
          routingPolicy,
          providerId,
          costEngine,
          budgetEnforcer,
          tenant,
          budgetPeriod,
          span,
        ),
      );
      return;
    }

    await withSpan(
      "chat.completion",
      async () => {
        try {
          const response = await routingEngine.route(canonicalRequest, routingPolicy);
          // Priced on the response path using the final TokenUsage, recorded fire-and-forget —
          // recordUsage() never rejects, so a slow ledger write can't delay or fail this response.
          const breakdown = costEngine.priceRequest(providerId, response.model, response.usage);
          void costEngine.recordUsage(tenant, breakdown);
          // Trues up the provisional reservation against the same period it was taken against.
          // Also fire-and-forget safe.
          if (budgetPeriod) {
            void budgetEnforcer.debit(tenant, breakdown.totalCostMicros, budgetPeriod);
          }
          res.status(200).json(response);
        } catch (error) {
          if (error instanceof NoAvailableProviderError) {
            // Unwrap the underlying provider failure so a caller sees the provider's actual 429
            // rather than a flattened generic error — but only a GatewayError's client-safe
            // code/message and a whitelisted httpStatus.
            const firstCause = error.causes[0];
            if (firstCause instanceof GatewayError) {
              res
                .status(toSafeUpstreamStatus(firstCause.httpStatus))
                .json({ code: firstCause.code, message: firstCause.message });
              return;
            }
            res.status(502).json({ code: "NO_AVAILABLE_PROVIDER", message: "No provider was able to complete this request" });
            return;
          }
          next(error);
        }
      },
      { "provider.id": providerId, "llm.model": model, "llm.streaming": false },
    );
  });

  return router;
}

// Minimal shape this needs from Express's Request — just enough to listen for the client
// disconnecting, without importing the full Express Request type into the signature.
interface DisconnectSource {
  on(event: "close", listener: () => void): void;
}

// Split out for readability — the streaming path's shape (pull one event before committing to
// SSE, hand the rest to the transport, track disconnection to a correct CloseReason) is
// different enough from the JSON path.
async function handleStreamingCompletion(
  req: DisconnectSource,
  res: Parameters<Parameters<Router["post"]>[1]>[1],
  next: Parameters<Parameters<Router["post"]>[1]>[2],
  routingEngine: DefaultRoutingEngine,
  canonicalRequest: CanonicalRequest,
  routingPolicy: RoutingPolicy,
  providerId: string,
  costEngine: DefaultCostEngine,
  budgetEnforcer: DefaultBudgetEnforcer,
  tenant: TenantContext,
  budgetPeriod: ResolvedPeriod | undefined,
  span: Span,
): Promise<void> {
  // Tracks the real outcome across every exit path so the outer finally can end `span` exactly
  // once, correctly, regardless of which path was taken.
  let closeReason: CloseReason = "completed";

  try {
    const controller = new AbortController();
    let disconnected = false;
    // A client disconnect must stop the upstream provider call — threaded through routeStream()
    // -> provider.stream().
    req.on("close", () => {
      disconnected = true;
      controller.abort();
    });

    const iterator = routingEngine
      .routeStream(canonicalRequest, routingPolicy, controller.signal)
      [Symbol.asyncIterator]();

    // Pulling the first event is the only point where "every candidate failed" can still be a
    // JSON error — once SSE headers are sent, the response is committed to the event-stream format.
    let first: IteratorResult<CanonicalStreamEvent>;
    try {
      first = await iterator.next();
    } catch (error) {
      if (disconnected) {
        // The client is gone — nothing to send a JSON error to. Just release the iterator.
        closeReason = "client_disconnect";
        await iterator.return?.();
        return;
      }
      if (error instanceof NoAvailableProviderError) {
        closeReason = "error";
        const firstCause = error.causes[0];
        if (firstCause instanceof GatewayError) {
          res
            .status(toSafeUpstreamStatus(firstCause.httpStatus))
            .json({ code: firstCause.code, message: firstCause.message });
          return;
        }
        res.status(502).json({ code: "NO_AVAILABLE_PROVIDER", message: "No provider was able to complete this request" });
        return;
      }
      closeReason = "error";
      next(error);
      return;
    }

    if (disconnected) {
      // The client disconnected between issuing the first pull and it resolving — nothing written
      // yet, so just release the iterator without opening headers.
      closeReason = "client_disconnect";
      await iterator.return?.();
      return;
    }

    const transport = new SseStreamTransport(res);
    const handle = transport.open({ requestId: randomUUID() });
    // Captured off the "start" event (see the loop below) — a stream only ever prices/records once
    // it actually reaches a "done" event with real usage, so there's nothing to price if the
    // stream errors or the client disconnects first.
    let streamedModel: string | undefined;
    try {
      let result = first;
      while (!result.done) {
        if (disconnected) {
          // Stop pulling and let the generator's own cleanup run via return(), rather than
          // abandoning it mid-iteration.
          await iterator.return?.();
          closeReason = "client_disconnect";
          break;
        }
        transport.send(handle, result.value);
        if (result.value.type === "start") {
          streamedModel = result.value.model;
        } else if (result.value.type === "error") {
          closeReason = "error";
        } else if (result.value.type === "done" && streamedModel !== undefined) {
          // Cost is recorded once the final usage figure is known (the "done" event), never
          // estimated mid-stream. Fire-and-forget, after transport.send() has already delivered
          // the event.
          const breakdown = costEngine.priceRequest(providerId, streamedModel, result.value.usage);
          void costEngine.recordUsage(tenant, breakdown);
          if (budgetPeriod) {
            void budgetEnforcer.debit(tenant, breakdown.totalCostMicros, budgetPeriod);
          }
        }
        result = await iterator.next();
      }
      if (result.done && disconnected) {
        // The stream finished right as the client disconnected — record the disconnect.
        closeReason = "client_disconnect";
      }
    } catch (error) {
      if (disconnected) {
        // The thrown error is almost certainly the abort propagating up — attribute the close to
        // the disconnect, and don't send an error event to a client that's gone.
        closeReason = "client_disconnect";
      } else {
        // routeStream() already converts a mid-stream failure into a yielded "error" event, but
        // this is guarded anyway — the transport must never leak a raw error.
        transport.send(handle, {
          type: "error",
          error:
            error instanceof GatewayError
              ? error
              : new GatewayError("INTERNAL_ERROR", "An unexpected error occurred while streaming", 500, false),
        });
        closeReason = "error";
      }
    } finally {
      transport.close(handle, closeReason);
    }
  } finally {
    // Unconditional — covers every exit path, including early returns before any transport
    // existed. Ends `span` exactly once, with a status derived from closeReason. Never passes the
    // real error, which may carry provider content that must not reach recordException.
    endSpanWithOutcome(
      span,
      closeReason === "error" ? "error" : "ok",
      closeReason === "error" ? new Error("Streaming chat completion failed") : undefined,
    );
  }
}
