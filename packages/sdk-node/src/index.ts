// TypeScript SDK — thin typed HTTP client over the Gateway's Public and Admin APIs. Depends only
// on the published HTTP contract, never on domain/application/adapters.
export { GatewayClient } from "./public-client.js";
export type { GatewayClientOptions } from "./public-client.js";
export { AdminClient } from "./admin-client.js";
export type { AdminClientOptions } from "./admin-client.js";
export { LlmGatewayApiError, LlmGatewayNetworkError } from "./errors.js";
export type { TransportOptions } from "./transport.js";
export * from "./types.js";
