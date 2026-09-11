import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { AdminSession, CredentialKind } from "../credentialStorage";

interface CredentialScreenProps {
  readonly onSubmit: (session: AdminSession) => void;
}

// The credential input is type="password" to avoid shoulder-surfing. The value never leaves this
// form except into saveSession() via onSubmit; it is never logged.
export function CredentialScreen({ onSubmit }: CredentialScreenProps): ReactElement {
  const [baseUrl, setBaseUrl] = useState("");
  const [kind, setKind] = useState<CredentialKind>("apiKey");
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!baseUrl.trim() || !value.trim()) {
      return;
    }
    onSubmit({ baseUrl: baseUrl.trim(), kind, value: value.trim() });
  }

  return (
    <div className="app-main">
      <h1>LLM Gateway — Admin</h1>
      <form onSubmit={handleSubmit} className="section">
        <div className="field">
          <label htmlFor="baseUrl">Gateway base URL</label>
          <input
            id="baseUrl"
            type="url"
            placeholder="https://gateway.example.com"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="credentialKind">Credential type</label>
          <select id="credentialKind" value={kind} onChange={(event) => setKind(event.target.value as CredentialKind)}>
            <option value="apiKey">API Key (X-API-Key)</option>
            <option value="bearerToken">Bearer token (JWT)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="credentialValue">{kind === "apiKey" ? "API key" : "Bearer token"}</label>
          <input id="credentialValue" type="password" value={value} onChange={(event) => setValue(event.target.value)} required />
        </div>
        <button type="submit" className="primary">
          Connect
        </button>
        <p className="hint">
          Stored in sessionStorage for this tab only — cleared automatically when the tab closes, or via "Clear credential" once
          connected.
        </p>
      </form>
    </div>
  );
}
