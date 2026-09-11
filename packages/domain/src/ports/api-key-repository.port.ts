import type { ApiKey } from "../entities/api-key.entity.js";
import type { ApiKeyId, ProjectId } from "../value-objects/ids.js";

// Implemented by adapters-postgres. findByPrefix is the API-key auth lookup: keyPrefix is indexed
// and unique, giving O(1) lookup without a table scan and without querying by the plaintext secret.
export interface ApiKeyRepository {
  findById(id: ApiKeyId): Promise<ApiKey | null>;
  findByPrefix(keyPrefix: string): Promise<ApiKey | null>;
  listByProject(projectId: ProjectId): Promise<ApiKey[]>;
  save(apiKey: ApiKey): Promise<void>;
}
