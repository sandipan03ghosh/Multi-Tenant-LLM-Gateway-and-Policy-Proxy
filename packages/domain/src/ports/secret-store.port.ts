// Env-var-backed for self-hosted, swappable for a cloud secret manager adapter. Read-only — env
// vars aren't writable at runtime and no caller needs rotation yet.
export interface SecretStore {
  getSecret(key: string): Promise<string | null>;
}
