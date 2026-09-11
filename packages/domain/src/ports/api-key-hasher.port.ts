// Implemented by adapters-security (Argon2ApiKeyHasher). hash() is one-way; verify() compares a
// candidate secret against a stored hash. Only keyHash is ever persisted.
export interface ApiKeyHasher {
  hash(secret: string): Promise<string>;
  verify(secret: string, hash: string): Promise<boolean>;
}
