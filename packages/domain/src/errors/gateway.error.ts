// Stable, client-safe error surfaced across the request pipeline: a stable code, an HTTP status,
// and a client-safe message — raw provider errors and stack traces never cross this boundary.
// A ProviderPort's translateError() is one of the places this is produced.
//
// `retryable` is required, not defaulted: only the code constructing the error (which still has
// the real upstream status/shape) can judge whether retrying is safe — a 429 that's a hard daily
// quota isn't. Consumers like RetryPolicy key off this flag, not httpStatus.
export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly retryable: boolean,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
