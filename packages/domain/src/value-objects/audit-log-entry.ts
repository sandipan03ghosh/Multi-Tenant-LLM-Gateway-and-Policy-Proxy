export type AuditActorType = "user" | "api_key";

// An immutable record of every administrative action. `id`/`createdAt` are assigned at write time.
export interface CreateAuditLogEntryInput {
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface AuditLogEntry extends CreateAuditLogEntryInput {
  readonly id: string;
  readonly createdAt: Date;
}
