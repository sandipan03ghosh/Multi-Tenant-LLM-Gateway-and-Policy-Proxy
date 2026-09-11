import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { AdminClient } from "@llm-gateway/sdk-node";
import type { AdminSession } from "./credentialStorage";
import { clearSession, loadSession, maskCredential, saveSession } from "./credentialStorage";
import { CredentialScreen } from "./screens/CredentialScreen";
import { AuditLogScreen } from "./screens/AuditLogScreen";
import { PoliciesScreen } from "./screens/PoliciesScreen";
import { ProvidersScreen } from "./screens/ProvidersScreen";
import { AlertChannelsScreen } from "./screens/AlertChannelsScreen";

type Tab = "audit-log" | "policies" | "providers" | "alert-channels";

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: "audit-log", label: "Audit Log" },
  { id: "policies", label: "Policies" },
  { id: "providers", label: "Providers" },
  { id: "alert-channels", label: "Alert Channels" },
];

export function App(): ReactElement {
  const [session, setSession] = useState<AdminSession | null>(() => loadSession());
  const [orgId, setOrgId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("audit-log");

  const client = useMemo(() => {
    if (!session) {
      return null;
    }
    return new AdminClient({
      baseUrl: session.baseUrl,
      ...(session.kind === "apiKey" ? { apiKey: session.value } : { bearerToken: session.value }),
    });
  }, [session]);

  function handleConnect(newSession: AdminSession): void {
    saveSession(newSession);
    setSession(newSession);
  }

  function handleDisconnect(): void {
    clearSession();
    setSession(null);
  }

  if (!session || !client) {
    return <CredentialScreen onSubmit={handleConnect} />;
  }

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <h1>LLM Gateway</h1>
        {TABS.map((tab) => (
          <button key={tab.id} className={tab.id === activeTab ? "active" : ""} onClick={() => setActiveTab(tab.id)} type="button">
            {tab.label}
          </button>
        ))}
        {/* Never the raw credential — only the masked form (see credentialStorage.ts). */}
        <p className="hint">Connected: {maskCredential(session.value)}</p>
        <button className="secondary" onClick={handleDisconnect} type="button">
          Clear credential
        </button>
      </nav>
      <main className="app-main">
        <div className="field">
          <label htmlFor="orgId">Organization ID</label>
          <input
            id="orgId"
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
            placeholder="Paste an organization id — no lookup endpoint exists to list them"
          />
        </div>
        {activeTab === "audit-log" && <AuditLogScreen client={client} orgId={orgId} />}
        {activeTab === "policies" && <PoliciesScreen client={client} orgId={orgId} />}
        {activeTab === "providers" && <ProvidersScreen client={client} />}
        {activeTab === "alert-channels" && <AlertChannelsScreen client={client} />}
      </main>
    </div>
  );
}
