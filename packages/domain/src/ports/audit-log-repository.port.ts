import type { AuditLogEntry, CreateAuditLogEntryInput } from "../value-objects/audit-log-entry.js";

export interface AuditLogListOptions {
  /** Defaults to 100 in the adapter if omitted. */
  readonly limit?: number;
  /** Opaque — obtained from a previous page's AuditLogPage.nextCursor. Never constructed by hand. */
  readonly cursor?: string;
}

export interface AuditLogPage {
  readonly entries: readonly AuditLogEntry[];
  /** Pass back as AuditLogListOptions.cursor to fetch the next page; null once there is no more. */
  readonly nextCursor: string | null;
}

// Implemented by adapters-postgres. Only create()/list() — no update/delete, the application-
// level half of "append-only" (the other half is a DB grant restriction). Written synchronously
// by callers, not through JobScheduler.
//
// listByOrganization uses keyset (cursor) pagination. The cursor is opaque here; the concrete
// repository encodes it from (createdAt, id) together — never createdAt alone, or same-
// millisecond entries could be skipped or repeated across a page boundary.
export interface AuditLogRepository {
  create(input: CreateAuditLogEntryInput): Promise<AuditLogEntry>;
  listByOrganization(organizationId: string, options?: AuditLogListOptions): Promise<AuditLogPage>;
}
