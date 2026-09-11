import { useState } from "react";
import type { ReactElement } from "react";

interface JsonValueEditorProps {
  readonly value: unknown;
  readonly onSave: (value: unknown) => Promise<void>;
}

// A generic JSON textarea editor for policy value shapes too varied to justify a bespoke form per
// type — the operator edits the exact JSON the Admin API accepts/returns. Parse errors are shown
// locally, never sent to the server.
export function JsonValueEditor({ value, onSave }: JsonValueEditorProps): ReactElement {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }
    setParseError(null);
    setSaving(true);
    try {
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} />
      {parseError && <p className="hint hint-error">{parseError}</p>}
      <button className="primary" type="button" disabled={saving} onClick={() => void handleSave()}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
