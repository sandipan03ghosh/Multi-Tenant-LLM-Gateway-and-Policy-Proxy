import type { AlertChannelConfig } from "../entities/alert-channel-config.entity.js";
import type { AlertChannelConfigId } from "../value-objects/ids.js";

// Implemented by adapters-postgres. listAll() (Admin GET, includes disabled rows) and
// listEnabled() (the delivery path, filtered at the query layer) are separate methods rather
// than one with a boolean parameter.
export interface AlertChannelConfigRepository {
  findById(id: AlertChannelConfigId): Promise<AlertChannelConfig | null>;
  listAll(): Promise<AlertChannelConfig[]>;
  listEnabled(): Promise<AlertChannelConfig[]>;
  save(config: AlertChannelConfig): Promise<void>;
  delete(id: AlertChannelConfigId): Promise<void>;
}
