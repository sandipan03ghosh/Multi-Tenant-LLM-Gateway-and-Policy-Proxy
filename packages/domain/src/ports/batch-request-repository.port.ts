import type { CanonicalResponse } from "../value-objects/canonical-response.js";
import type { BatchRequestRecord, CreateBatchRequestInput } from "../value-objects/batch-request.js";

// Implemented by adapters-postgres. findById always scopes by organizationId, and by projectId
// only when the caller has one — an org-level caller sees any batch in their org; a
// project-scoped caller must match exactly. Expressed as a query condition, not a
// fetch-then-filter.
export interface BatchRequestRepository {
  create(input: CreateBatchRequestInput): Promise<void>;
  findById(id: string, organizationId: string, projectId: string | null): Promise<BatchRequestRecord | null>;
  // No tenant scoping — trusted internal callers only (the worker looking up its own known
  // batchId), never a tenant-facing route.
  findByIdUnscoped(id: string): Promise<BatchRequestRecord | null>;
  // Atomically transitions PENDING -> PROCESSING and reports whether it did. This is what makes
  // process_scheduled_request idempotent — a second hand-off of the same batchId returns false
  // and the handler skips re-running routing.
  markProcessing(id: string): Promise<boolean>;
  markSucceeded(id: string, result: CanonicalResponse): Promise<void>;
  markFailed(id: string, errorCode: string, errorMessage: string): Promise<void>;
}
