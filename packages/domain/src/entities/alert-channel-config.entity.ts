import type { AlertChannelConfigId } from "../value-objects/ids.js";
import { toAlertChannelConfigId } from "../value-objects/ids.js";
import { assertNonEmpty, assertHttpUrlFormat } from "./validation-helpers.js";

export interface AlertChannelConfigProps {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A stored, operator-managed webhook destination for DomainAlertEvent delivery (global-only, no
// organizationId).
//
// Named *Config*, not AlertChannel: the port AlertChannel (ports/alert-channel.port.ts) owns
// that name for the delivery mechanism; this class is the stored data it reads. Same barrel
// export, so the names would collide.
export class AlertChannelConfig {
  readonly id: AlertChannelConfigId;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: AlertChannelConfigProps) {
    this.id = toAlertChannelConfigId(props.id);
    this.name = props.name;
    this.url = props.url;
    this.enabled = props.enabled;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: AlertChannelConfigProps): AlertChannelConfig {
    assertNonEmpty("AlertChannelConfig", "name", props.name);
    assertHttpUrlFormat("AlertChannelConfig", "url", props.url);
    return new AlertChannelConfig(props);
  }
}
