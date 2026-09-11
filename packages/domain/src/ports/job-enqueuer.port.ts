import type { JobDefinition, ScheduleOptions, JobHandle } from "../value-objects/job.js";

// Narrow subset of JobScheduler — enqueue only. What a composition root that only *produces*
// jobs depends on, so it structurally can't register a handler or start a poll loop (e.g. the
// API process enqueueing a budget-reconcile job only the worker executes). PostgresJobScheduler
// satisfies it automatically.
export interface JobEnqueuer {
  enqueue(job: JobDefinition, options?: ScheduleOptions): Promise<JobHandle>;
}
