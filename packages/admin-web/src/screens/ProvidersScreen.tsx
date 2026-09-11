import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { AdminClient, ProviderStatus } from "@llm-gateway/sdk-node";
import { ErrorBanner } from "../components/ErrorBanner";

interface ProvidersScreenProps {
  readonly client: AdminClient;
}

// Global resource, no organization context. Surfaces whatever the connected credential's
// permissions allow — a 403 renders through ErrorBanner like any other error.
export function ProvidersScreen({ client }: ProvidersScreenProps): ReactElement {
  const [providers, setProviders] = useState<readonly ProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await client.listProviders();
      setProviders(response.providers);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Intentionally run once on mount — `client` is stable for this screen's lifetime.
  }, [client]);

  async function toggle(providerId: string, currentlyEnabled: boolean): Promise<void> {
    setError(null);
    try {
      const updated = await client.setProviderEnabled(providerId, !currentlyEnabled);
      setProviders((previous) => previous.map((provider) => (provider.providerId === providerId ? updated : provider)));
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <div className="section">
      <h3>Providers</h3>
      <ErrorBanner error={error} />
      <button className="primary" type="button" disabled={loading} onClick={() => void load()}>
        {loading ? "Loading…" : "Refresh"}
      </button>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Enabled</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {providers.map((provider) => (
            <tr key={provider.providerId}>
              <td>{provider.providerId}</td>
              <td>{provider.enabled ? "Yes" : "No"}</td>
              <td>
                <button className="secondary" type="button" onClick={() => void toggle(provider.providerId, provider.enabled)}>
                  {provider.enabled ? "Disable" : "Enable"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
