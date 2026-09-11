import type { OrganizationId, ProjectId } from "../value-objects/ids.js";
import { toOrganizationId, toProjectId } from "../value-objects/ids.js";
import { assertNonEmpty, assertSlugFormat } from "./validation-helpers.js";

export interface ProjectProps {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Aggregate root for ApiKeys and project-scoped policy. slug is unique only within its
// Organization (a DB constraint), not enforced here.
export class Project {
  readonly id: ProjectId;
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ProjectProps) {
    this.id = toProjectId(props.id);
    this.organizationId = toOrganizationId(props.organizationId);
    this.name = props.name;
    this.slug = props.slug;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: ProjectProps): Project {
    assertNonEmpty("Project", "name", props.name);
    assertNonEmpty("Project", "slug", props.slug);
    assertSlugFormat("Project", "slug", props.slug);
    return new Project(props);
  }
}
