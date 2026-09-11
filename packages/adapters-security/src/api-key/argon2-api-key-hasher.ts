import argon2 from "argon2";
import type { ApiKeyHasher } from "@llm-gateway/domain";

// Implements ApiKeyHasher using argon2id (OWASP's current recommendation).
export class Argon2ApiKeyHasher implements ApiKeyHasher {
  async hash(secret: string): Promise<string> {
    return argon2.hash(secret, { type: argon2.argon2id });
  }

  async verify(secret: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, secret);
    } catch {
      // argon2.verify() throws on a malformed hash string — treat that as "does not match".
      return false;
    }
  }
}
