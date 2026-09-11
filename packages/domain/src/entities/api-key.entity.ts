import type { ApiKeyId, ProjectId } from "../value-objects/ids.js";
import { toApiKeyId, toProjectId } from "../value-objects/ids.js";
import { assertNonEmpty } from "./validation-helpers.js";

export interface ApiKeyProps {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly keyHash: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

// Machine identity. Only keyPrefix and keyHash are held here — the plaintext secret never enters
// the domain layer after issuance.
export class ApiKey {
  readonly id: ApiKeyId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly keyPrefix: string;
  readonly keyHash: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;

  private constructor(props: ApiKeyProps) {
    this.id = toApiKeyId(props.id);
    this.projectId = toProjectId(props.projectId);
    this.name = props.name;
    this.keyPrefix = props.keyPrefix;
    this.keyHash = props.keyHash;
    this.createdAt = props.createdAt;
    this.revokedAt = props.revokedAt;
  }

  static create(props: ApiKeyProps): ApiKey {
    assertNonEmpty("ApiKey", "name", props.name);
    assertNonEmpty("ApiKey", "keyPrefix", props.keyPrefix);
    assertNonEmpty("ApiKey", "keyHash", props.keyHash);
    return new ApiKey(props);
  }

  isRevoked(): boolean {
    return this.revokedAt !== null;
  }
}
