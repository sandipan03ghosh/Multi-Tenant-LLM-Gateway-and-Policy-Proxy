import type { OrganizationId, UserId } from "../value-objects/ids.js";
import { toOrganizationId, toUserId } from "../value-objects/ids.js";
import { assertEmailFormat, assertNonEmpty } from "./validation-helpers.js";

export interface UserProps {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Human identity. passwordHash is nullable — a User can exist (seeded, or invited but not yet
// activated) before it has a usable credential.
export class User {
  readonly id: UserId;
  readonly organizationId: OrganizationId;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: UserProps) {
    this.id = toUserId(props.id);
    this.organizationId = toOrganizationId(props.organizationId);
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: UserProps): User {
    assertNonEmpty("User", "email", props.email);
    assertEmailFormat("User", "email", props.email);
    return new User(props);
  }

  hasCredential(): boolean {
    return this.passwordHash !== null;
  }
}
