import type { ProviderPort } from "./provider.port.js";

// Runtime lookup of live adapter instances, separate from ProviderCatalog. resolve() throws
// ProviderNotFoundError rather than returning null.
//
// isEnabled: a synchronous, side-effect-free read of one provider's enabled state, so the Admin
// API can report enabled/disabled status without importing a concrete adapter. Returns false for
// an unregistered providerId, same as a disabled one — no "unknown" vs "disabled" distinction.
export interface ProviderRegistry {
  resolve(providerId: string): ProviderPort;
  listEnabled(): ProviderPort[];
  isEnabled(providerId: string): boolean;
}
