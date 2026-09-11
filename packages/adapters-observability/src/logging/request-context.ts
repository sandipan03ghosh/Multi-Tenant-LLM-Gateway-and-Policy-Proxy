import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContextStore {
  readonly requestId: string;
}

// One store for the whole process — every request/job gets its own AsyncLocalStorage frame via
// runWithRequestId. Callers must wrap the actual async execution, not just synchronous setup —
// the store only propagates through the async chain from the .run() callback.
const asyncLocalStorage = new AsyncLocalStorage<RequestContextStore>();

// The logger prefers the active OTel span's traceId and falls back to this requestId when no
// span exists (worker jobs).
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return asyncLocalStorage.run({ requestId }, fn);
}

export function getCurrentRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}
