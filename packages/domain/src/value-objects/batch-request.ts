import type { CanonicalRequest } from "./canonical-request.js";
import type { CanonicalResponse } from "./canonical-response.js";
import type { RoutingPolicy } from "./routing-policy.js";

// The Batch API's job-handle model — POST /v1/batches returns one of these (pending),
// GET /v1/batches/{id} returns its current state. `id` is the same id as the enqueue()
// QueueTicket, so a client only remembers one identifier.
//
// `canonicalRequest`/`routingPolicy` are also carried in the Job payload the drain loop enqueues
// — intentional duplication: the Job's copy is what the worker executes against, this row's copy
// lets GET /v1/batches/{id} echo "what was requested" independent of the Job row's lifecycle.
export type BatchRequestStatus = "pending" | "processing" | "succeeded" | "failed";

export interface BatchRequestRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly requestClass: "batch" | "background";
  readonly canonicalRequest: CanonicalRequest;
  readonly routingPolicy: RoutingPolicy;
  readonly webhookUrl: string | null;
  readonly status: BatchRequestStatus;
  readonly result: CanonicalResponse | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export interface CreateBatchRequestInput {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly requestClass: "batch" | "background";
  readonly canonicalRequest: CanonicalRequest;
  readonly routingPolicy: RoutingPolicy;
  readonly webhookUrl: string | null;
}
