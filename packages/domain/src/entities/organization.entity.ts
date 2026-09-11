import type { OrganizationId } from "../value-objects/ids.js";
import { toOrganizationId } from "../value-objects/ids.js";
import { assertNonEmpty, assertSlugFormat } from "./validation-helpers.js";

export interface OrganizationProps {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Aggregate root for org-scoped policy. create() serves both new instances and repository
// rehydration — `slug` uniqueness is a DB concern, not an in-memory invariant.
export class Organization {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: OrganizationProps) {
    this.id = toOrganizationId(props.id);
    this.name = props.name;
    this.slug = props.slug;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: OrganizationProps): Organization {
    assertNonEmpty("Organization", "name", props.name);
    assertNonEmpty("Organization", "slug", props.slug);
    assertSlugFormat("Organization", "slug", props.slug);
    return new Organization(props);
  }
}
