import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type {
  AdminClient,
  PolicyScopeOptions,
  RateLimitPolicy,
  BudgetPolicy,
  RoutingPolicy,
  EnrichmentStages,
  EnrichmentDeniedTopics,
  ContentFilterFailureMode,
} from "@llm-gateway/sdk-node";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonValueEditor } from "../components/JsonValueEditor";

interface PoliciesScreenProps {
  readonly client: AdminClient;
  readonly orgId: string;
}

type EditorKind = "json" | "text" | "boolean" | "number" | "enum";

interface PolicyResourceConfig {
  readonly key: string;
  readonly label: string;
  readonly kind: EditorKind;
  readonly enumOptions?: readonly string[];
  // `any` here is a localized boundary for this one heterogeneous dispatch table (nine resources,
  // nine value types). The Admin API is the actual source of validation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly get: (client: AdminClient, orgId: string, options: PolicyScopeOptions) => Promise<{ policy: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly set: (client: AdminClient, orgId: string, value: any, options: PolicyScopeOptions) => Promise<{ policy: any }>;
}

const RESOURCES: readonly PolicyResourceConfig[] = [
  {
    key: "rate-limit",
    label: "Rate-Limit Policy",
    kind: "json",
    get: (c, o, opt) => c.getRateLimitPolicy(o, opt),
    set: (c, o, v, opt) => c.setRateLimitPolicy(o, v as RateLimitPolicy, opt),
  },
  {
    key: "budget",
    label: "Budget Policy",
    kind: "json",
    get: (c, o, opt) => c.getBudgetPolicy(o, opt),
    set: (c, o, v, opt) => c.setBudgetPolicy(o, v as BudgetPolicy, opt),
  },
  {
    key: "routing",
    label: "Routing Policy",
    kind: "json",
    get: (c, o, opt) => c.getRoutingPolicy(o, opt),
    set: (c, o, v, opt) => c.setRoutingPolicy(o, v as RoutingPolicy, opt),
  },
  {
    key: "enrichment-stages",
    label: "Enrichment: stage list",
    kind: "json",
    get: (c, o, opt) => c.getEnrichmentStages(o, opt),
    set: (c, o, v, opt) => c.setEnrichmentStages(o, v as EnrichmentStages, opt),
  },
  {
    key: "enrichment-system-prompt",
    label: "Enrichment: system prompt",
    kind: "text",
    get: (c, o, opt) => c.getEnrichmentSystemPrompt(o, opt),
    set: (c, o, v, opt) => c.setEnrichmentSystemPrompt(o, v as string, opt),
  },
  {
    key: "enrichment-denied-topics",
    label: "Enrichment: denied topics",
    kind: "json",
    get: (c, o, opt) => c.getEnrichmentDeniedTopics(o, opt),
    set: (c, o, v, opt) => c.setEnrichmentDeniedTopics(o, v as EnrichmentDeniedTopics, opt),
  },
  {
    key: "enrichment-pii-redaction",
    label: "Enrichment: PII redaction",
    kind: "boolean",
    get: (c, o, opt) => c.getEnrichmentPiiRedaction(o, opt),
    set: (c, o, v, opt) => c.setEnrichmentPiiRedaction(o, v as boolean, opt),
  },
  {
    key: "enrichment-content-filter-failure-mode",
    label: "Enrichment: content-filter failure mode",
    kind: "enum",
    enumOptions: ["fail_open", "fail_closed"],
    get: (c, o, opt) => c.getEnrichmentContentFilterFailureMode(o, opt),
    set: (c, o, v, opt) => c.setEnrichmentContentFilterFailureMode(o, v as ContentFilterFailureMode, opt),
  },
  {
    key: "enrichment-content-filter-timeout-ms",
    label: "Enrichment: content-filter timeout (ms)",
    kind: "number",
    get: (c, o, opt) => c.getEnrichmentContentFilterTimeoutMs(o, opt),
    set: (c, o, v, opt) => c.setEnrichmentContentFilterTimeoutMs(o, v as number, opt),
  },
];

export function PoliciesScreen({ client, orgId }: PoliciesScreenProps): ReactElement {
  const [resourceKey, setResourceKey] = useState(RESOURCES[0]!.key);
  const [projectId, setProjectId] = useState("");
  const [policy, setPolicy] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const resource = RESOURCES.find((candidate) => candidate.key === resourceKey)!;
  const options: PolicyScopeOptions = projectId.trim() ? { projectId: projectId.trim() } : {};

  async function load(): Promise<void> {
    if (!orgId.trim()) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await resource.get(client, orgId.trim(), options);
      setPolicy(response.policy);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Excludes `load` itself (redefined every render) — the effect re-runs on its real deps below.
  }, [client, orgId, resourceKey, projectId]);

  async function handleSave(value: unknown): Promise<void> {
    if (!orgId.trim()) {
      return;
    }
    setError(null);
    try {
      const response = await resource.set(client, orgId.trim(), value, options);
      setPolicy(response.policy);
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <div className="section">
      <h3>Policies</h3>
      <ErrorBanner error={error} />
      {!orgId.trim() ? (
        <p className="hint">Enter an organization ID above to view or edit policies.</p>
      ) : (
        <>
          <div className="row">
            <div className="field">
              <label htmlFor="resource">Resource</label>
              <select id="resource" value={resourceKey} onChange={(event) => setResourceKey(event.target.value)}>
                {RESOURCES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="projectId">Project ID (optional)</label>
              <input
                id="projectId"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                placeholder="Leave blank for the org-wide effective value"
              />
            </div>
            <button className="secondary" type="button" disabled={loading} onClick={() => void load()}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {policy === undefined || policy === null ? (
            <p className="hint">Not configured at this scope — the enforcement path falls back to its own default.</p>
          ) : null}

          {/*
            Keyed on (org, resource, project scope): five of the nine resources share
            kind="json", so switching between them re-renders the same PolicyEditor/
            JsonValueEditor component instances at this same tree position rather than mounting
            new ones. Both derive their editable text/checkbox/number state from `value` via a
            *lazy* useState initializer, which only runs once on mount — without this key, that
            state would keep showing the previously selected resource's stale value instead of
            the freshly fetched one. The key forces React to unmount+remount on any change to
            org/resource/project scope, so the initializer re-runs against the current value.
          */}
          <PolicyEditor
            key={`${orgId.trim()}:${resourceKey}:${projectId.trim()}`}
            kind={resource.kind}
            enumOptions={resource.enumOptions}
            value={policy}
            onSave={handleSave}
          />
        </>
      )}
    </div>
  );
}

interface PolicyEditorProps {
  readonly kind: EditorKind;
  readonly enumOptions: readonly string[] | undefined;
  readonly value: unknown;
  readonly onSave: (value: unknown) => Promise<void>;
}

// Dispatches to the JSON textarea for structurally rich types and a native input for the scalar
// enrichment-policy sub-resources. The caller must key this component on resource/scope identity
// — its state initializers are lazy (mount-time only) and don't re-sync to a changed `value` prop.
function PolicyEditor({ kind, enumOptions, value, onSave }: PolicyEditorProps): ReactElement {
  const [text, setText] = useState(() => (typeof value === "string" ? value : ""));
  const [bool, setBool] = useState(() => value === true);
  const [num, setNum] = useState(() => (typeof value === "number" ? String(value) : ""));
  const [enumValue, setEnumValue] = useState(() => (typeof value === "string" ? value : (enumOptions?.[0] ?? "")));
  const [saving, setSaving] = useState(false);

  async function save(nextValue: unknown): Promise<void> {
    setSaving(true);
    try {
      await onSave(nextValue);
    } finally {
      setSaving(false);
    }
  }

  if (kind === "json") {
    return <JsonValueEditor value={value ?? null} onSave={onSave} />;
  }

  if (kind === "text") {
    return (
      <div>
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} />
        <button className="primary" type="button" disabled={saving} onClick={() => void save(text)}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    );
  }

  if (kind === "boolean") {
    return (
      <div className="row">
        <label>
          <input type="checkbox" checked={bool} onChange={(event) => setBool(event.target.checked)} /> Enabled
        </label>
        <button className="primary" type="button" disabled={saving} onClick={() => void save(bool)}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    );
  }

  if (kind === "number") {
    return (
      <div className="row">
        <input type="number" value={num} onChange={(event) => setNum(event.target.value)} />
        <button className="primary" type="button" disabled={saving} onClick={() => void save(Number(num))}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    );
  }

  // kind === "enum"
  return (
    <div className="row">
      <select value={enumValue} onChange={(event) => setEnumValue(event.target.value)}>
        {(enumOptions ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button className="primary" type="button" disabled={saving} onClick={() => void save(enumValue)}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
