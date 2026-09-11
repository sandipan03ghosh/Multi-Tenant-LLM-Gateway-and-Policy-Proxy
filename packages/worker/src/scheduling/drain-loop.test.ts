import { jest } from "@jest/globals";
import type { ScheduledRequest, QueueTicket, DequeuedRequest, SchedulingCapacity } from "@llm-gateway/domain";
import type { RedisRequestScheduler } from "@llm-gateway/adapters-redis";
import type { PostgresJobScheduler, PrismaBatchRequestRepository } from "@llm-gateway/adapters-postgres";
import { DrainLoop } from "./drain-loop.js";

// Minimal duck-typed fakes covering only the methods DrainLoop calls, cast to the concrete
// adapter types DrainLoop's constructor expects.

function fakeScheduledRequest(): ScheduledRequest {
  return {
    requestClass: "batch",
    tenant: { organizationId: "org_1" as never, projectId: null, subjectType: "api_key", subjectId: "key_1", permissions: [] },
    canonicalRequest: { model: "gemini-1.5-flash", messages: [{ role: "user", content: "hi" }] },
    routingPolicy: { type: "manual", providerId: "gemini" },
  };
}

function fakeDequeued(ticketId: string): DequeuedRequest {
  return { ticket: { ticketId }, request: fakeScheduledRequest() };
}

function tick(loop: DrainLoop): Promise<void> {
  return (loop as unknown as { tick(): Promise<void> }).tick();
}

describe("DrainLoop", () => {
  it("hands each dequeued item to JobScheduler with its webhookUrl folded into the payload", async () => {
    const dequeueNext = jest.fn<(capacity: SchedulingCapacity) => Promise<DequeuedRequest[]>>().mockResolvedValue([fakeDequeued("ticket-1")]);
    const requeue = jest.fn<(ticket: QueueTicket, request: ScheduledRequest) => Promise<void>>();
    const requestScheduler = { dequeueNext, requeue } as unknown as RedisRequestScheduler;

    const enqueue = jest.fn<() => Promise<{ jobId: string }>>().mockResolvedValue({ jobId: "job-1" });
    const jobScheduler = { enqueue } as unknown as PostgresJobScheduler;

    const findByIdUnscoped = jest.fn<() => Promise<{ webhookUrl: string } | null>>().mockResolvedValue({ webhookUrl: "https://example.com/hook" });
    const batchRequestRepository = { findByIdUnscoped } as unknown as PrismaBatchRequestRepository;

    const loop = new DrainLoop(requestScheduler, jobScheduler, batchRequestRepository);
    await tick(loop);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      type: "process_scheduled_request",
      payload: { batchId: "ticket-1", webhookUrl: "https://example.com/hook", scheduledRequest: fakeScheduledRequest() },
    });
    expect(requeue).not.toHaveBeenCalled();
  });

  it("requeues a dequeued item under its original ticketId when handing it to JobScheduler fails", async () => {
    const item = fakeDequeued("ticket-2");
    const dequeueNext = jest.fn<(capacity: SchedulingCapacity) => Promise<DequeuedRequest[]>>().mockResolvedValue([item]);
    const requeue = jest.fn<(ticket: QueueTicket, request: ScheduledRequest) => Promise<void>>().mockResolvedValue(undefined);
    const requestScheduler = { dequeueNext, requeue } as unknown as RedisRequestScheduler;

    const enqueue = jest.fn<() => Promise<{ jobId: string }>>().mockRejectedValue(new Error("Postgres unavailable"));
    const jobScheduler = { enqueue } as unknown as PostgresJobScheduler;

    const findByIdUnscoped = jest.fn<() => Promise<{ webhookUrl: string } | null>>().mockResolvedValue(null);
    const batchRequestRepository = { findByIdUnscoped } as unknown as PrismaBatchRequestRepository;

    const loop = new DrainLoop(requestScheduler, jobScheduler, batchRequestRepository);
    await tick(loop);

    expect(requeue).toHaveBeenCalledTimes(1);
    expect(requeue).toHaveBeenCalledWith({ ticketId: "ticket-2" }, item.request);
  });

  it("does not throw when both the enqueue and the requeue recovery attempt fail", async () => {
    const dequeueNext = jest.fn<(capacity: SchedulingCapacity) => Promise<DequeuedRequest[]>>().mockResolvedValue([fakeDequeued("ticket-3")]);
    const requeue = jest.fn<(ticket: QueueTicket, request: ScheduledRequest) => Promise<void>>().mockRejectedValue(new Error("Redis unavailable"));
    const requestScheduler = { dequeueNext, requeue } as unknown as RedisRequestScheduler;

    const enqueue = jest.fn<() => Promise<{ jobId: string }>>().mockRejectedValue(new Error("Postgres unavailable"));
    const jobScheduler = { enqueue } as unknown as PostgresJobScheduler;

    const findByIdUnscoped = jest.fn<() => Promise<{ webhookUrl: string } | null>>().mockResolvedValue(null);
    const batchRequestRepository = { findByIdUnscoped } as unknown as PrismaBatchRequestRepository;

    const loop = new DrainLoop(requestScheduler, jobScheduler, batchRequestRepository);

    await expect(tick(loop)).resolves.toBeUndefined();
  });
});
