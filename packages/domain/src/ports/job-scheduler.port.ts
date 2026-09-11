import type { JobHandler } from "../value-objects/job.js";
import type { JobEnqueuer } from "./job-enqueuer.port.js";

// Implemented by PostgresJobScheduler — SKIP LOCKED polling, no message broker. Extends
// JobEnqueuer since not every dependent needs the handler-registration half. Starting/stopping
// the poll loop is implementation-specific and lives on the concrete class, not this port.
export interface JobScheduler extends JobEnqueuer {
  registerHandler(jobType: string, handler: JobHandler): void;
}
