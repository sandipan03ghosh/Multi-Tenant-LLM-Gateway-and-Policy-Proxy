// `payload` is `unknown` on both sides — each job's handler validates its own payload shape,
// not the scheduler.
export interface JobDefinition {
  readonly type: string;
  readonly payload: unknown;
}

export interface ScheduleOptions {
  /** Defer execution until this time. Defaults to "now" (immediately eligible for claiming). */
  readonly runAt?: Date;
  /** Defaults to the scheduler implementation's own default (PostgresJobScheduler: 5). */
  readonly maxAttempts?: number;
}

export interface JobHandle {
  readonly jobId: string;
}

export type JobHandler = (payload: unknown) => Promise<void>;
