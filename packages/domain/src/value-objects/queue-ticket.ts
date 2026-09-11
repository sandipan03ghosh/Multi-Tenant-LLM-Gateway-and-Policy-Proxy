export interface QueueTicket {
  readonly ticketId: string;
}

/** How many queued requests a single dequeueNext() call should claim, in total across classes. */
export interface SchedulingCapacity {
  readonly maxJobs: number;
}
