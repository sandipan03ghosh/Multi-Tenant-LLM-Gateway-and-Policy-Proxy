import { useState } from "react";
import type { ReactElement } from "react";
import type { AdminClient, AuditLogEntry } from "@llm-gateway/sdk-node";
import { ErrorBanner } from "../components/ErrorBanner";

interface AuditLogScreenProps {
  readonly client: AdminClient;
  readonly orgId: string;
}

export function AuditLogScreen({ client, orgId }: AuditLogScreenProps): ReactElement {
  const [entries, setEntries] = useState<readonly AuditLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function load(reset: boolean): Promise<void> {
    if (!orgId.trim()) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const options = reset || !cursor ? {} : { cursor };
      const response = await client.listAuditLog(orgId.trim(), options);
      setEntries((previous) => (reset ? response.entries : [...previous, ...response.entries]));
      setCursor(response.nextCursor ?? undefined);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="section">
      <h3>Audit Log</h3>
      <ErrorBanner error={error} />
      {!orgId.trim() ? (
        <p className="hint">Enter an organization ID above to load its audit log.</p>
      ) : (
        <>
          <button className="primary" type="button" disabled={loading} onClick={() => void load(true)}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.createdAt}</td>
                  <td>
                    {entry.actorType}:{entry.actorId}
                  </td>
                  <td>{entry.action}</td>
                  <td>
                    {entry.targetType ?? "—"}
                    {entry.targetId ? `:${entry.targetId}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <button className="secondary" type="button" disabled={loading} onClick={() => void load(false)}>
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
