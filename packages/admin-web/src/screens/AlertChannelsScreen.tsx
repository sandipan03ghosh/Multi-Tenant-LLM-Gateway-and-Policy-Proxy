import { useEffect, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { AdminClient, AlertChannel } from "@llm-gateway/sdk-node";
import { ErrorBanner } from "../components/ErrorBanner";

interface AlertChannelsScreenProps {
  readonly client: AdminClient;
}

// Global resource, no organization context. `url` on every channel is already redacted to
// protocol+host by the server — this screen treats it as display text only.
export function AlertChannelsScreen({ client }: AlertChannelsScreenProps): ReactElement {
  const [channels, setChannels] = useState<readonly AlertChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newEnabled, setNewEnabled] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await client.listAlertChannels();
      setChannels(response.alertChannels);
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

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const response = await client.createAlertChannel({ name: newName.trim(), url: newUrl.trim(), enabled: newEnabled });
      setChannels((previous) => [...previous, response.alertChannel]);
      setNewName("");
      setNewUrl("");
      setNewEnabled(true);
    } catch (caught) {
      setError(caught);
    }
  }

  function startEdit(channel: AlertChannel): void {
    setEditingId(channel.id);
    setEditName(channel.name);
    // The full URL was never sent here — the field starts empty, so any edit requires re-entering
    // it. A consequence of the server-side redaction.
    setEditUrl("");
    setEditEnabled(channel.enabled);
  }

  async function handleUpdate(event: FormEvent, channelId: string): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const response = await client.updateAlertChannel(channelId, { name: editName.trim(), url: editUrl.trim(), enabled: editEnabled });
      setChannels((previous) => previous.map((channel) => (channel.id === channelId ? response.alertChannel : channel)));
      setEditingId(null);
    } catch (caught) {
      setError(caught);
    }
  }

  async function handleDelete(channelId: string): Promise<void> {
    setError(null);
    try {
      await client.deleteAlertChannel(channelId);
      setChannels((previous) => previous.filter((channel) => channel.id !== channelId));
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <div className="section">
      <h3>Alert Channels</h3>
      <ErrorBanner error={error} />
      <button className="primary" type="button" disabled={loading} onClick={() => void load()}>
        {loading ? "Loading…" : "Refresh"}
      </button>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>URL (redacted)</th>
            <th>Enabled</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) =>
            editingId === channel.id ? (
              <tr key={channel.id}>
                <td colSpan={4}>
                  <form onSubmit={(event) => void handleUpdate(event, channel.id)} className="row">
                    <div className="field">
                      <label htmlFor={`edit-name-${channel.id}`}>Name</label>
                      <input id={`edit-name-${channel.id}`} value={editName} onChange={(event) => setEditName(event.target.value)} required />
                    </div>
                    <div className="field">
                      <label htmlFor={`edit-url-${channel.id}`}>New URL</label>
                      <input
                        id={`edit-url-${channel.id}`}
                        type="url"
                        value={editUrl}
                        onChange={(event) => setEditUrl(event.target.value)}
                        placeholder="https://…"
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`edit-enabled-${channel.id}`}>Enabled</label>
                      <input
                        id={`edit-enabled-${channel.id}`}
                        type="checkbox"
                        checked={editEnabled}
                        onChange={(event) => setEditEnabled(event.target.checked)}
                      />
                    </div>
                    <button className="primary" type="submit">
                      Save
                    </button>
                    <button className="secondary" type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={channel.id}>
                <td>{channel.name}</td>
                <td>{channel.url}</td>
                <td>{channel.enabled ? "Yes" : "No"}</td>
                <td>
                  <button className="secondary" type="button" onClick={() => startEdit(channel)}>
                    Edit
                  </button>{" "}
                  <button className="danger" type="button" onClick={() => void handleDelete(channel.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <h3>Create alert channel</h3>
      <form onSubmit={(event) => void handleCreate(event)} className="row">
        <div className="field">
          <label htmlFor="new-name">Name</label>
          <input id="new-name" value={newName} onChange={(event) => setNewName(event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="new-url">URL</label>
          <input id="new-url" type="url" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} placeholder="https://…" required />
        </div>
        <div className="field">
          <label htmlFor="new-enabled">Enabled</label>
          <input id="new-enabled" type="checkbox" checked={newEnabled} onChange={(event) => setNewEnabled(event.target.checked)} />
        </div>
        <button className="primary" type="submit">
          Create
        </button>
      </form>
    </div>
  );
}
