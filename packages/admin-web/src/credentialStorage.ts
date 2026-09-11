const STORAGE_KEY = "llm-gateway-admin-session";

export type CredentialKind = "apiKey" | "bearerToken";

export interface AdminSession {
  readonly baseUrl: string;
  readonly kind: CredentialKind;
  readonly value: string;
}

// The only place this app reads or writes the operator's credential — sessionStorage (not
// localStorage/cookies), so it survives a reload but not the tab closing. Does not protect
// against XSS. Policy for the rest of the codebase: the credential value is never logged, never
// put in a URL, and never written anywhere but here.
export function saveSession(session: AdminSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): AdminSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AdminSession>;
    if (
      typeof parsed.baseUrl === "string" &&
      (parsed.kind === "apiKey" || parsed.kind === "bearerToken") &&
      typeof parsed.value === "string"
    ) {
      return { baseUrl: parsed.baseUrl, kind: parsed.kind, value: parsed.value };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

// Display-only masked form for showing "credential set" state without rendering the secret.
export function maskCredential(value: string): string {
  if (value.length <= 4) {
    return "••••";
  }
  return `••••${value.slice(-4)}`;
}
