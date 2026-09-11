// Generic by design — raised for every authentication failure (key not found, revoked, wrong
// secret, expired token, deleted user) with no distinguishing detail, so a caller can't
// enumerate valid keys/users.
export class AuthenticationError extends Error {
  constructor(message = "Authentication failed") {
    super(message);
    this.name = "AuthenticationError";
  }
}
