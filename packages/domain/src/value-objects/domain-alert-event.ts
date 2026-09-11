export type AlertSeverity = "warning" | "critical";

// Emitted by any subsystem surfacing an operationally significant event to a human.
// organizationId/projectId are null for provider-level events (circuit breaker, health tracker)
// with no single tenant to attribute.
export interface DomainAlertEvent {
  readonly id: string;
  readonly type: string;
  readonly severity: AlertSeverity;
  readonly organizationId: string | null;
  readonly projectId: string | null;
  readonly message: string;
  // Structured detail for the receiving channel — IDs/numbers/enums only, never prompt text,
  // request/response bodies, or API keys.
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}
