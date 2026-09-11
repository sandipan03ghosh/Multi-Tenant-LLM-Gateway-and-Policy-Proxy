import type { OrganizationId, ProjectId } from "./ids.js";

export type AuthSubjectType = "user" | "api_key";

// Resolved identity produced by authentication, flowing through the request pipeline for
// tenant-scoped repository calls. projectId is nullable: an ApiKey always belongs to one Project,
// but a JWT-authenticated User belongs to an Organization — which project a human request
// operates on is resolved elsewhere (e.g. a URL path segment), not by authentication.
export interface TenantContext {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId | null;
  readonly subjectType: AuthSubjectType;
  readonly subjectId: string;
  // Effective permission codes for this subject, resolved at authentication time — org-wide role
  // assignments plus any assignment scoped to this exact projectId.
  readonly permissions: readonly string[];
}
