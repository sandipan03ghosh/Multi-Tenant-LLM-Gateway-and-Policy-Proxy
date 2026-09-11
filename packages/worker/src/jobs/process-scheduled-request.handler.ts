import { z } from "zod";
import { GatewayError, NoAvailableProviderError } from "@llm-gateway/domain";
import type { JobHandler, ScheduledRequest, CanonicalResponse } from "@llm-gateway/domain";
import type { DefaultRoutingEngine } from "@llm-gateway/application";
import type { PostgresJobScheduler, PrismaBatchRequestRepository } from "@llm-gateway/adapters-postgres";

const tenantContextSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  subjectType: z.enum(["user", "api_key"]),
  subjectId: z.string().min(1),
});

const canonicalMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const canonicalRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(canonicalMessageSchema).min(1),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
});

const providerCandidateSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});
const weightedCandidateSchema = providerCandidateSchema.extend({ weight: z.number() });
const shadowRoutingConfigSchema = z.object({ candidate: providerCandidateSchema, sampleRate: z.number() });
const routingPolicyBaseSchema = z.object({ shadow: shadowRoutingConfigSchema.optional() });

// Validates the full RoutingPolicy union variant-for-variant, not just `type` — catches payload
// corruption between write and read with a clear error instead of an obscure failure in route().
const manualRoutingPolicySchema = routingPolicyBaseSchema.extend({
  type: z.literal("manual"),
  providerId: z.string().min(1),
});
const roundRobinRoutingPolicySchema = routingPolicyBaseSchema.extend({
  type: z.literal("round_robin"),
  cursorKey: z.string().min(1),
  candidates: z.array(providerCandidateSchema).min(1),
});
const weightedRoutingPolicySchema = routingPolicyBaseSchema.extend({
  type: z.literal("weighted"),
  candidates: z.array(weightedCandidateSchema).min(1),
});
const healthAwareRoutingPolicySchema = routingPolicyBaseSchema.extend({
  type: z.literal("health_aware"),
  candidates: z.array(providerCandidateSchema).min(1),
});
const stickyRoutingPolicySchema = routingPolicyBaseSchema.extend({
  type: z.literal("sticky"),
  sessionKey: z.string().min(1),
  candidates: z.array(providerCandidateSchema).min(1),
  pinTtlMs: z.number().optional(),
});
const routingPolicySchema = z.discriminatedUnion("type", [
  manualRoutingPolicySchema,
  roundRobinRoutingPolicySchema,
  weightedRoutingPolicySchema,
  healthAwareRoutingPolicySchema,
  stickyRoutingPolicySchema,
]);

const scheduledRequestSchema = z.object({
  requestClass: z.enum(["interactive", "high_priority", "batch", "background"]),
  tenant: tenantContextSchema,
  canonicalRequest: canonicalRequestSchema,
  routingPolicy: routingPolicySchema,
});

// webhookUrl travels in the job payload (set by the drain loop at enqueue time) rather than
// being re-read from the BatchRequest row later — one fewer DB round trip and dependency.
const processScheduledRequestPayloadSchema = z.object({
  batchId: z.string().min(1),
  webhookUrl: z.string().nullable(),
  scheduledRequest: scheduledRequestSchema,
});

function extractClientSafeError(error: unknown): { code: string; message: string } {
  if (error instanceof NoAvailableProviderError) {
    const firstCause = error.causes[0];
    if (firstCause instanceof GatewayError) {
      return { code: firstCause.code, message: firstCause.message };
    }
    return { code: "NO_AVAILABLE_PROVIDER", message: "No provider was able to complete this request" };
  }
  if (error instanceof GatewayError) {
    return { code: error.code, message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: "An unexpected error occurred" };
}

// Bounded retry for a durable write (outcome persistence, webhook enqueue) that must not be lost
// to a transient DB blip. Returns success rather than throwing, so callers can log a clear outcome.
async function retryWithBackoff(operation: () => Promise<void>, attempts: number, baseDelayMs: number, label: string): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await operation();
      return true;
    } catch (error) {
      const isLastAttempt = attempt === attempts - 1;
      console.error(`${label} failed (attempt ${attempt + 1}/${attempts})${isLastAttempt ? "" : ", retrying"}:`, error);
      if (isLastAttempt) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  return false;
}

// Drained batch/background work executes here, through the same routingEngine.route() path a
// synchronous request uses.
//
// Does not rethrow on a routing failure: route() already exhausts all resilience internally, so a
// throw means every candidate failed. Rethrowing would make JobScheduler redundantly retry the
// whole routing attempt. Instead the failure is recorded as the batch's definitive outcome and
// the handler returns normally.
//
// The outcome-persistence write gets its own bounded retry — a transient Postgres blip must not
// strand a batch at "processing", and a job-level retry would re-run routing. Webhook delivery is
// a separate deliver_webhook job.
export function createProcessScheduledRequestHandler(
  routingEngine: DefaultRoutingEngine,
  batchRequestRepository: PrismaBatchRequestRepository,
  jobScheduler: PostgresJobScheduler,
): JobHandler {
  return async (payload: unknown): Promise<void> => {
    const parsed = processScheduledRequestPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`process_scheduled_request: payload failed validation: ${JSON.stringify(z.flattenError(parsed.error))}`);
    }
    const { batchId, webhookUrl } = parsed.data;
    // Validated above — this cast just bridges zod's inferred type to the domain's nominal type.
    const scheduledRequest = parsed.data.scheduledRequest as unknown as ScheduledRequest;

    // markProcessing() atomically transitions PENDING -> PROCESSING and reports whether it did —
    // the idempotency guard against a batchId being executed twice. A read failure fails open to
    // "proceed": a false negative just re-runs route() once, but dropping a real job is unbounded.
    let claimed: boolean;
    try {
      claimed = await batchRequestRepository.markProcessing(batchId);
    } catch (error) {
      console.error(`process_scheduled_request: failed to mark batch ${batchId} as processing (proceeding anyway):`, error);
      claimed = true;
    }
    if (!claimed) {
      console.error(`process_scheduled_request: batch ${batchId} was already processing or completed — skipping duplicate execution`);
      return;
    }

    let response: CanonicalResponse;
    try {
      response = await routingEngine.route(scheduledRequest.canonicalRequest, scheduledRequest.routingPolicy);
    } catch (error) {
      const { code, message } = extractClientSafeError(error);
      const persisted = await retryWithBackoff(
        () => batchRequestRepository.markFailed(batchId, code, message),
        3,
        500,
        `process_scheduled_request: persisting FAILED outcome for batch ${batchId}`,
      );
      if (!persisted) {
        console.error(`process_scheduled_request: batch ${batchId} outcome could not be persisted — it will remain "processing" until reconciled`);
      }
      await enqueueWebhookIfConfigured(jobScheduler, batchId, webhookUrl, { status: "failed", error: { code, message } });
      return;
    }

    const persisted = await retryWithBackoff(
      () => batchRequestRepository.markSucceeded(batchId, response),
      3,
      500,
      `process_scheduled_request: persisting SUCCEEDED outcome for batch ${batchId}`,
    );
    if (!persisted) {
      console.error(`process_scheduled_request: batch ${batchId} outcome could not be persisted — it will remain "processing" until reconciled`);
    }
    await enqueueWebhookIfConfigured(jobScheduler, batchId, webhookUrl, { status: "succeeded", result: response });
  };
}

async function enqueueWebhookIfConfigured(
  jobScheduler: PostgresJobScheduler,
  batchId: string,
  webhookUrl: string | null,
  body: Record<string, unknown>,
): Promise<void> {
  if (!webhookUrl) {
    return;
  }
  const succeeded = await retryWithBackoff(
    () => jobScheduler.enqueue({ type: "deliver_webhook", payload: { url: webhookUrl, body: { id: batchId, ...body } } }).then(() => undefined),
    3,
    500,
    `process_scheduled_request: enqueueing webhook delivery for batch ${batchId}`,
  );
  if (!succeeded) {
    console.error(`process_scheduled_request: webhook delivery for batch ${batchId} could not be enqueued — it will not be delivered`);
  }
}
