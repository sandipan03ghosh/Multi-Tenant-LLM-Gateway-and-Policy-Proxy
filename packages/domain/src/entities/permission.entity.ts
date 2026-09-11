import type { PermissionId } from "../value-objects/ids.js";
import { toPermissionId } from "../value-objects/ids.js";
import { assertNonEmpty } from "./validation-helpers.js";

export interface PermissionProps {
  readonly id: string;
  readonly code: string;
  readonly description: string;
}

// Static permission catalog entry (e.g. "routing.policy:write") — seeded, not user-managed.
export class Permission {
  readonly id: PermissionId;
  readonly code: string;
  readonly description: string;

  private constructor(props: PermissionProps) {
    this.id = toPermissionId(props.id);
    this.code = props.code;
    this.description = props.description;
  }

  static create(props: PermissionProps): Permission {
    assertNonEmpty("Permission", "code", props.code);
    assertNonEmpty("Permission", "description", props.description);
    return new Permission(props);
  }
}
