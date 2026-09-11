import { DomainValidationError } from "../errors/domain-validation.error.js";

// Internal helpers shared by entity create() factories. Not exported from the package index.

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertNonEmpty(entity: string, field: string, value: string): void {
  if (value.trim().length === 0) {
    throw new DomainValidationError(entity, field, "must not be empty");
  }
}

export function assertSlugFormat(entity: string, field: string, value: string): void {
  if (!SLUG_PATTERN.test(value)) {
    throw new DomainValidationError(
      entity,
      field,
      "must be lowercase, hyphen-separated alphanumeric segments",
    );
  }
}

export function assertEmailFormat(entity: string, field: string, value: string): void {
  if (!EMAIL_PATTERN.test(value)) {
    throw new DomainValidationError(entity, field, "must be a valid email address");
  }
}

// Syntactic only — a parseable http(s) URL. Does not check private/loopback hosts or resolve
// DNS; deliver-webhook.handler.ts's SSRF checks remain the authority on delivery safety.
export function assertHttpUrlFormat(entity: string, field: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DomainValidationError(entity, field, "must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DomainValidationError(entity, field, "must use the http or https scheme");
  }
}
