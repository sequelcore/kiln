import { ExecutionRouteCreationRequestSchema, type AvailableModelCatalog, type ExecutionRouteCreationRequest, type GuiInboundFrame, type GuiOutboundFrame } from "@kilnai/gateway-contracts";
import { useEffect, useMemo, useRef, useState } from "react";

type Entry = AvailableModelCatalog["entries"][number];
type CreationResult = Extract<GuiInboundFrame, { type: "execution_route_create_result" }>;
const INITIAL_MATERIAL = "{\n  \"routeId\": \"\",\n  \"label\": \"\",\n  \"accountSelection\": { \"mode\": \"exact\", \"accountId\": \"\" },\n  \"dataClassification\": \"public\",\n  \"dataPolicyEvidence\": {},\n  \"economics\": {}\n}";

function stateLabel(entry: Entry): string {
  if (entry.discoveryState === "stale") return "Stale discovery";
  if (entry.discoveryState === "failed") return "Discovery unavailable";
  if (entry.eligibilityState === "ineligible") return "Ineligible";
  if (entry.availabilityState === "unavailable") return "Unavailable";
  if (entry.availabilityState === "unknown") return "Availability unknown";
  return entry.configuredState === "configured" ? "Configured" : "Available to configure";
}

export function AvailableModelsPanel(props: { readonly catalog: AvailableModelCatalog | null; readonly catalogRevision?: string; readonly creationResult?: CreationResult | null; readonly send: ((frame: GuiOutboundFrame) => void) | null }) {
  const [selected, setSelected] = useState<Entry | null>(null);
  const [material, setMaterial] = useState(INITIAL_MATERIAL);
  const [preview, setPreview] = useState<ExecutionRouteCreationRequest | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [eligibility, setEligibility] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [configured, setConfigured] = useState("all");
  const originButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!props.creationResult || props.creationResult.requestId !== pendingRequestId) return;
    setPendingRequestId(null);
    setFeedback(props.creationResult.message);
    if (props.creationResult.status !== "rejected") { setSelected(null); setPreview(null); }
    queueMicrotask(() => originButtonRef.current?.focus());
  }, [pendingRequestId, props.creationResult]);

  const providers = useMemo(() => [...new Set(props.catalog?.entries.map((entry) => entry.providerId) ?? [])].sort(), [props.catalog]);
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const entries = (props.catalog?.entries ?? []).filter((entry) => (provider === "all" || entry.providerId === provider)
      && (eligibility === "all" || entry.eligibilityState === eligibility)
      && (availability === "all" || entry.availabilityState === availability)
      && (configured === "all" || entry.configuredState === configured)
      && (!query || `${entry.providerId} ${entry.providerModelId} ${entry.providerRouteId}`.toLowerCase().includes(query)));
    return providers.map((providerId) => ({ providerId, entries: entries.filter((entry) => entry.providerId === providerId) })).filter((group) => group.entries.length > 0);
  }, [availability, configured, eligibility, props.catalog, provider, providers, search]);

  if (!props.catalog) return <div className="p-4 text-sm text-muted-foreground">Waiting for the Runtime model catalog.</div>;
  if (props.catalog.entries.length === 0) return <div className="p-4 text-sm text-muted-foreground">No discovered models. Refresh provider discovery or repair its configuration.</div>;

  const validatePreview = (): void => {
    setFeedback(null); setPreview(null);
    if (!selected || !props.catalogRevision) { setFeedback("Current configuration revision is unavailable. Refresh Available models before creating a route."); return; }
    try {
      const request = ExecutionRouteCreationRequestSchema.parse({ requestId: `route-create-${Date.now()}`, expectedRevision: props.catalogRevision, discoveryIdentity: { providerId: selected.providerId, providerRouteId: selected.providerRouteId, providerModelId: selected.providerModelId }, material: JSON.parse(material) });
      setPreview(request); setFeedback(`Preview ready for ${request.material.routeId}. Review it, then create explicitly.`);
    } catch (error) { setFeedback(error instanceof Error ? `Route material is invalid: ${error.message}` : "Route material is invalid."); }
  };
  const create = (): void => {
    if (!preview || !props.send) return;
    props.send({ type: "execution_route_create", ...preview }); setPendingRequestId(preview.requestId); setFeedback("Creating execution target…");
  };

  return <section aria-label="Available models" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
    <header><h2 className="text-base font-semibold">Available models</h2><p className="text-sm text-muted-foreground">Runtime discovery and configuration evidence. Selection remains in the route picker.</p></header>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs">Search<input aria-label="Search available models" value={search} onChange={(event) => setSearch(event.target.value)} className="block w-full rounded border p-1" /></label>
      <Filter label="Provider filter" value={provider} onChange={setProvider} options={["all", ...providers]} />
      <Filter label="Eligibility filter" value={eligibility} onChange={setEligibility} options={["all", "eligible", "ineligible", "unknown"]} />
      <Filter label="Availability filter" value={availability} onChange={setAvailability} options={["all", "available", "unavailable", "unknown"]} />
      <Filter label="Configured filter" value={configured} onChange={setConfigured} options={["all", "configured", "unconfigured"]} />
    </div>
    {groups.length === 0 ? <p className="text-sm text-muted-foreground">No models match the current filters.</p> : groups.map((group) => <section key={group.providerId} aria-labelledby={`provider-${group.providerId}`} className="rounded-md border"><h3 id={`provider-${group.providerId}`} className="border-b px-3 py-2 text-sm font-semibold">{group.providerId}</h3>{group.entries.map((entry) => <article key={`${entry.providerRouteId}:${entry.providerModelId}`} className="flex min-w-0 items-start justify-between gap-4 border-b p-3 last:border-b-0"><div className="min-w-0"><p className="break-all text-sm font-medium">{entry.providerId} / {entry.providerModelId}</p><p className="break-all text-xs text-muted-foreground">{entry.providerRouteId}</p></div><div className="shrink-0 text-right"><span className="block text-xs text-muted-foreground">{stateLabel(entry)}</span>{entry.discoveryState === "observed" && entry.eligibilityState === "eligible" ? <button type="button" className="mt-1 text-xs underline" onClick={(event) => { originButtonRef.current = event.currentTarget; setSelected(entry); setPreview(null); setFeedback(null); }}>Create route</button> : null}</div></article>)}</section>)}
    {selected ? <form aria-label="Execution target creation form" className="rounded-md border p-3" onSubmit={(event) => { event.preventDefault(); validatePreview(); }}><label htmlFor="execution-route-material" className="block text-sm font-medium">Complete route material</label><p id="execution-route-material-help" className="mb-2 text-xs text-muted-foreground">Required: routeId, label, accountSelection, classification, policy evidence, and economics. Secrets are rejected.</p><textarea id="execution-route-material" aria-label="Complete route material" aria-describedby="execution-route-material-help execution-route-feedback" aria-invalid={feedback?.startsWith("Route material is invalid") || undefined} value={material} onChange={(event) => { setMaterial(event.target.value); setPreview(null); }} className="min-h-48 w-full rounded border bg-background p-2 font-mono text-xs" /><div className="mt-2 flex gap-2"><button type="submit" disabled={pendingRequestId !== null} className="rounded border px-3 py-1 text-sm">Validate and preview</button>{preview ? <button type="button" disabled={!props.send || pendingRequestId !== null} onClick={create} className="rounded border px-3 py-1 text-sm">Create route now</button> : null}</div></form> : null}
    <p id="execution-route-feedback" aria-live="polite" className="text-sm text-muted-foreground">{feedback}</p>
  </section>;
}

function Filter(props: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="text-xs">{props.label}<select aria-label={props.label} value={props.value} onChange={(event) => props.onChange(event.target.value)} className="block w-full rounded border p-1">{props.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}
