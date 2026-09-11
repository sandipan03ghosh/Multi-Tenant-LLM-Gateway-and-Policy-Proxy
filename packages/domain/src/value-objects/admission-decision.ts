// Outcome of RequestScheduler.admit(). `queue` means call enqueue() instead of proceeding
// synchronously — batch/background always resolve this way. `reject` is for interactive/
// high-priority traffic over capacity: queuing a "low latency" class would defeat its contract.
export type AdmissionDecision =
  | { readonly outcome: "admit_inline" }
  | { readonly outcome: "queue" }
  | { readonly outcome: "reject"; readonly code: string; readonly reason: string };
