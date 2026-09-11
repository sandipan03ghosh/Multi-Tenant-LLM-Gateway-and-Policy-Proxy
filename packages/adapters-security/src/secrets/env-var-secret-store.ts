import type { SecretStore } from "@llm-gateway/domain";

// Default self-hosted SecretStore. Constructed from a snapshot the caller builds off its
// validated Env — never reads process.env itself. A cloud secret manager adapter is a swap-in later.
export class EnvVarSecretStore implements SecretStore {
  constructor(private readonly secrets: Readonly<Record<string, string | undefined>>) {}

  async getSecret(key: string): Promise<string | null> {
    return this.secrets[key] ?? null;
  }
}
