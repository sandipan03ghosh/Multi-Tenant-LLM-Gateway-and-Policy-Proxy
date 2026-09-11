import type { ScheduledRequest } from "../value-objects/scheduled-request.js";
import type { AdmissionDecision } from "../value-objects/admission-decision.js";
import type { QueueTicket, SchedulingCapacity } from "../value-objects/queue-ticket.js";

// A dequeued entry paired with the ticket it was enqueued under — the batch worker needs the
// ticket to know which client-visible tracking record (a BatchRequest row) this work is for.
export interface DequeuedRequest {
  readonly ticket: QueueTicket;
  readonly request: ScheduledRequest;
}

// `release()` frees a slot reserved by an "admit_inline" decision — call it exactly once in a
// try/finally around the admitted work, or the concurrency counter only grows.
export interface RequestScheduler {
  admit(request: ScheduledRequest): Promise<AdmissionDecision>;
  release(request: ScheduledRequest): Promise<void>;
  enqueue(request: ScheduledRequest): Promise<QueueTicket>;
  dequeueNext(capacity: SchedulingCapacity): Promise<DequeuedRequest[]>;
}
