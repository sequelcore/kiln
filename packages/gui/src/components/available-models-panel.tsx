import {
  ExecutionTargetWizardRequestSchema,
  type AvailableModelCatalog,
  type ExecutionTargetWizardProposal,
  type GuiInboundFrame,
  type GuiOutboundFrame,
} from "@kilnai/gateway-contracts";
import { PlusIcon, RefreshCwIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field.js";
import { Input } from "./ui/input.js";

type Entry = AvailableModelCatalog["entries"][number];
type WizardResult = Extract<GuiInboundFrame, { type: "execution_target_wizard_result" }>;
type Classification = "public" | "internal" | "confidential" | "restricted";
type PreviewRequest = Extract<GuiOutboundFrame, { type: "execution_target_wizard"; action: "preview" }>;

interface AvailableModelsPanelProps {
  readonly catalog: AvailableModelCatalog | null;
  readonly catalogRevision?: string;
  readonly wizardResult?: WizardResult | null;
  readonly send: ((frame: GuiOutboundFrame) => void) | null;
  readonly onRefresh?: () => void;
}

const CLASSIFICATIONS: readonly Classification[] = ["public", "internal", "confidential", "restricted"];

function stateLabel(entry: Entry): string {
  if (entry.discoveryState === "stale") return "Stale discovery";
  if (entry.discoveryState === "failed") return "Discovery unavailable";
  if (entry.eligibilityState === "ineligible") return "Ineligible";
  if (entry.eligibilityState === "unknown") return "Eligibility unknown";
  if (entry.availabilityState === "unavailable") return "Unavailable";
  if (entry.availabilityState === "unknown") return "Availability unknown";
  return entry.configuredState === "configured" ? "Configured" : "Available to configure";
}

function canStartWizard(entry: Entry): boolean {
  return entry.discoveryState === "observed" && entry.eligibilityState === "eligible";
}

function authorityLabel(impact: ExecutionTargetWizardProposal["authorityImpact"]): string {
  switch (impact) {
    case "none": return "No authority change";
    case "expands-read": return "Expands read authority";
    case "expands-write": return "Expands write authority";
    case "unknown": return "Authority impact unknown";
  }
}

export function AvailableModelsPanel(props: AvailableModelsPanelProps) {
  const [selected, setSelected] = useState<Entry | null>(null);
  const [label, setLabel] = useState("");
  const [classification, setClassification] = useState<Classification>("public");
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);
  const [proposal, setProposal] = useState<ExecutionTargetWizardProposal | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"preview" | "apply" | null>(null);
  const [rejection, setRejection] = useState<Extract<WizardResult, { status: "rejected" }> | null>(null);
  const [committedWarning, setCommittedWarning] = useState<Extract<WizardResult, { status: "committed-refresh-failed" }> | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [eligibility, setEligibility] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [configured, setConfigured] = useState("all");
  const originButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const policyConfirmationRef = useRef<HTMLInputElement | null>(null);
  const repairButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const result = props.wizardResult;
    if (!result || result.requestId !== pendingRequestId) return;
    if (pendingAction === "apply" && result.status === "previewed") return;
    if (pendingAction === "preview" && result.status !== "previewed" && result.status !== "rejected") return;

    setPendingRequestId(null);
    setPendingAction(null);
    if (result.status === "previewed") {
      setProposal(result.proposal);
      setRejection(null);
      return;
    }
    if (result.status === "rejected") {
      setProposal(null);
      setRejection(result);
      queueMicrotask(() => repairButtonRef.current?.focus());
      return;
    }
    if (result.status === "committed-refresh-failed") {
      setProposal(null);
      setCommittedWarning(result);
      queueMicrotask(() => repairButtonRef.current?.focus());
      return;
    }

    setFeedback(result.message);
    setSelected(null);
    setPreviewRequest(null);
    setProposal(null);
    setRejection(null);
    setCommittedWarning(null);
    setValidationError(null);
    queueMicrotask(() => {
      const origin = originButtonRef.current;
      (origin?.isConnected ? origin : panelHeadingRef.current)?.focus();
    });
  }, [pendingAction, pendingRequestId, props.wizardResult]);

  const providers = useMemo(
    () => [...new Set(props.catalog?.entries.map((entry) => entry.providerId) ?? [])].sort(),
    [props.catalog],
  );
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const entries = (props.catalog?.entries ?? []).filter((entry) =>
      (provider === "all" || entry.providerId === provider)
      && (eligibility === "all" || entry.eligibilityState === eligibility)
      && (availability === "all" || entry.availabilityState === availability)
      && (configured === "all" || entry.configuredState === configured)
      && (!query || `${entry.providerId} ${entry.providerModelId} ${entry.configuredRouteRefs.map((route) => route.label).join(" ")}`.toLowerCase().includes(query)),
    );
    return providers
      .map((providerId) => ({ providerId, entries: entries.filter((entry) => entry.providerId === providerId) }))
      .filter((group) => group.entries.length > 0);
  }, [availability, configured, eligibility, props.catalog, provider, providers, search]);

  function openWizard(entry: Entry, trigger: HTMLButtonElement): void {
    originButtonRef.current = trigger;
    setSelected(entry);
    setLabel("");
    setClassification("public");
    setPolicyConfirmed(false);
    setPreviewRequest(null);
    setProposal(null);
    setRejection(null);
    setCommittedWarning(null);
    setValidationError(null);
    setFeedback(null);
  }

  function closeWizard(restoreFocus = true): void {
    setSelected(null);
    setPreviewRequest(null);
    setProposal(null);
    setRejection(null);
    setCommittedWarning(null);
    setValidationError(null);
    if (restoreFocus) queueMicrotask(() => {
      const origin = originButtonRef.current;
      (origin?.isConnected ? origin : panelHeadingRef.current)?.focus();
    });
  }

  function submitPreview(): void {
    if (pendingRequestId) return;
    setValidationError(null);
    setRejection(null);
    if (!selected || !props.catalogRevision) {
      setValidationError("The current catalog revision is unavailable. Refresh models and try again.");
      return;
    }
    if (!policyConfirmed) {
      setValidationError(`Accept the conservative data-handling posture for ${classification} data before reviewing the target.`);
      queueMicrotask(() => policyConfirmationRef.current?.focus());
      return;
    }
    if (!props.send) {
      setValidationError("The Runtime connection is unavailable. Reconnect before reviewing this target.");
      return;
    }

    const candidate = {
      requestId: `target-wizard-${Date.now()}`,
      expectedRevision: props.catalogRevision,
      discoveryIdentity: {
        providerId: selected.providerId,
        providerRouteId: selected.providerRouteId,
        providerModelId: selected.providerModelId,
      },
      ...(label.trim() ? { label: label.trim() } : {}),
      dataClassification: classification,
      dataPolicyConfirmed: true as const,
      action: "preview" as const,
    };
    const parsed = ExecutionTargetWizardRequestSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.action !== "preview") {
      setValidationError("The target intent is invalid. Check the entered values and try again.");
      return;
    }
    const request: PreviewRequest = { type: "execution_target_wizard", ...parsed.data };
    setPreviewRequest(request);
    setPendingRequestId(request.requestId);
    setPendingAction("preview");
    props.send(request);
  }

  function applyProposal(): void {
    if (!previewRequest || !proposal || !props.send || pendingRequestId) return;
    const { type: _type, action: _action, ...intent } = previewRequest;
    const request = {
      type: "execution_target_wizard" as const,
      ...intent,
      action: "apply" as const,
      proposalId: proposal.proposalId,
      operatorApproved: true as const,
    };
    const { type: _frameType, ...requestBody } = request;
    const parsed = ExecutionTargetWizardRequestSchema.safeParse(requestBody);
    if (!parsed.success) {
      setValidationError("The approved proposal no longer matches its target intent. Refresh models and review again.");
      setProposal(null);
      return;
    }
    setPendingRequestId(request.requestId);
    setPendingAction("apply");
    props.send(request);
  }

  const busy = pendingRequestId !== null;

  return (
    <section aria-labelledby="available-models-heading" className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 ref={panelHeadingRef} id="available-models-heading" tabIndex={-1} className="font-heading text-base font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Available models</h2>
          <p className="text-sm text-muted-foreground">Create an execution target from current Runtime discovery evidence.</p>
          {props.catalog ? <p className="text-xs text-muted-foreground">Observed {new Date(props.catalog.observedAt).toLocaleString()}</p> : null}
        </div>
        {props.onRefresh ? <Button type="button" variant="outline" size="sm" onClick={props.onRefresh}><RefreshCwIcon />Refresh models</Button> : null}
      </header>

      {feedback ? <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{feedback}</p> : null}
      {!props.catalog ? (
        <p role="status" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Waiting for the Runtime model catalog.</p>
      ) : props.catalog.entries.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No discovered models. Refresh provider discovery or repair its configuration.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <label htmlFor="available-model-search" className="relative text-xs font-medium">Search
              <SearchIcon aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2.5 size-3.5 text-muted-foreground" />
              <Input id="available-model-search" aria-label="Search available models" value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 pl-8" />
            </label>
            <Filter label="Provider filter" value={provider} onChange={setProvider} options={["all", ...providers]} />
            <Filter label="Eligibility filter" value={eligibility} onChange={setEligibility} options={["all", "eligible", "ineligible", "unknown"]} />
            <Filter label="Availability filter" value={availability} onChange={setAvailability} options={["all", "available", "unavailable", "unknown"]} />
            <Filter label="Configured filter" value={configured} onChange={setConfigured} options={["all", "configured", "unconfigured"]} />
          </div>

          {groups.length === 0 ? <p className="text-sm text-muted-foreground">No models match the current filters.</p> : groups.map((group, groupIndex) => (
            <section key={group.providerId} aria-labelledby={`available-model-provider-${groupIndex}`} className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
              <h3 id={`available-model-provider-${groupIndex}`} className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">{group.providerId}</h3>
              {group.entries.map((entry) => {
                const name = `${entry.providerId} / ${entry.providerModelId}`;
                return (
                  <article key={`${entry.providerRouteId}:${entry.providerModelId}`} className="flex min-w-0 flex-col gap-3 border-b p-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="break-all text-sm font-medium">{name}</p>
                      {entry.configuredRouteRefs.length > 0 ? <p className="break-words text-xs text-muted-foreground">Configured targets: {entry.configuredRouteRefs.map((route) => route.label).join(", ")}</p> : null}
                      {entry.discoveryState === "observed" && entry.eligibilityState === "eligible" && entry.availabilityState === "unavailable" ? <p className="text-xs text-amber-700 dark:text-amber-300">Unavailable. The target may not execute until provider health recovers.</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                      <Badge variant={canStartWizard(entry) ? "outline" : "secondary"}>{stateLabel(entry)}</Badge>
                      {canStartWizard(entry) ? (
                        <Button type="button" size="sm" variant="outline" aria-label={`Add target for ${name}`} onClick={(event) => openWizard(entry, event.currentTarget)}>
                          <PlusIcon />Add target
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open && !busy) closeWizard(); }}>
        <DialogContent
          aria-busy={busy || undefined}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          finalFocus={() => {
            const origin = originButtonRef.current;
            return origin?.isConnected ? origin : panelHeadingRef.current;
          }}
          initialFocus={validationError ? policyConfirmationRef : labelInputRef}
          showCloseButton={!busy && !committedWarning}
        >
          <DialogHeader>
            <DialogTitle>{proposal ? "Review target" : committedWarning ? "Target created" : "Add execution target"}</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.providerId} / ${selected.providerModelId}` : "Review current model evidence."}
            </DialogDescription>
          </DialogHeader>

          {committedWarning ? (
            <Alert>
              <RefreshCwIcon />
              <AlertTitle>Catalog refresh required</AlertTitle>
              <AlertDescription>{committedWarning.message}</AlertDescription>
            </Alert>
          ) : proposal ? (
            <ProposalReview proposal={proposal} />
          ) : (
            <form aria-label="Execution target wizard" onSubmit={(event) => { event.preventDefault(); submitPreview(); }} className="space-y-4">
              <Field>
                <FieldLabel htmlFor="target-wizard-label">Target label (optional)</FieldLabel>
                <Input ref={labelInputRef} id="target-wizard-label" value={label} maxLength={512} disabled={busy} onChange={(event) => setLabel(event.target.value)} />
                <FieldDescription>If omitted, Kiln derives a label from the selected model.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="target-wizard-classification">Maximum data classification</FieldLabel>
                <select id="target-wizard-classification" value={classification} disabled={busy} onChange={(event) => { setClassification(event.target.value as Classification); setPolicyConfirmed(false); }} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                  {CLASSIFICATIONS.map((value) => <option key={value} value={value}>{value[0]?.toUpperCase()}{value.slice(1)}</option>)}
                </select>
                <FieldDescription>Choose the highest sensitivity this target is intended to handle.</FieldDescription>
              </Field>
              <Field data-invalid={Boolean(validationError)}>
                <label className="flex items-start gap-2 text-sm">
                  <input ref={policyConfirmationRef} type="checkbox" checked={policyConfirmed} disabled={busy} aria-invalid={Boolean(validationError) || undefined} aria-describedby="target-wizard-policy-help target-wizard-policy-error" onChange={(event) => setPolicyConfirmed(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                  <span>I accept conservative data handling for {classification} data: service operation, training may be permitted, and retention may be up to 3650 days</span>
                </label>
                <FieldDescription id="target-wizard-policy-help">Kiln uses this confirmation when deriving and admitting the target policy.</FieldDescription>
                {validationError ? <FieldError id="target-wizard-policy-error">{validationError}</FieldError> : null}
              </Field>
              {rejection ? <RejectionAlert result={rejection} repairButtonRef={repairButtonRef} onRefresh={props.onRefresh} onClose={() => closeWizard()} /> : null}
              {busy ? <p role="status" className="text-sm text-muted-foreground">Preparing target preview...</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => closeWizard()}>Cancel</Button>
                <Button type="submit" disabled={busy || !props.send}>Review target</Button>
              </DialogFooter>
            </form>
          )}

          {proposal ? (
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setProposal(null); setPreviewRequest(null); }}>Back</Button>
              <Button type="button" disabled={busy || proposal.status !== "valid"} onClick={applyProposal}><ShieldCheckIcon />Approve and create target</Button>
              {busy ? <p role="status" className="self-center text-sm text-muted-foreground">Creating target...</p> : null}
            </DialogFooter>
          ) : committedWarning ? (
            <DialogFooter>
              {props.onRefresh ? <Button ref={repairButtonRef} type="button" variant="outline" onClick={props.onRefresh}><RefreshCwIcon />Refresh models</Button> : null}
              <Button type="button" onClick={() => closeWizard()}>Close</Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ProposalReview(props: { readonly proposal: ExecutionTargetWizardProposal }) {
  const { proposal } = props;
  return (
    <div className="space-y-4">
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>Approval required</AlertTitle>
        <AlertDescription>This target expands operator authority. Applying it commits the exact proposal shown below.</AlertDescription>
      </Alert>
      <dl className="grid gap-x-5 gap-y-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-2">
        <ReviewValue label="Target" value={proposal.target.routeId} />
        <ReviewValue label="Label" value={proposal.target.label} />
        <ReviewValue label="Provider" value={proposal.target.providerId} />
        <ReviewValue label="Model" value={proposal.target.providerModelId} />
        <ReviewValue label="Data" value={proposal.target.dataClassification} />
        <ReviewValue label="Billing" value={proposal.target.billingClass} />
        <ReviewValue label="Capability" value={proposal.target.capabilityPosture} />
        <ReviewValue label="Authority" value={authorityLabel(proposal.authorityImpact)} />
      </dl>
      {proposal.diagnostics.length > 0 ? <Alert variant={proposal.diagnostics.some((item) => item.severity === "error") ? "destructive" : "default"}><AlertTitle>Proposal diagnostics</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-4">{proposal.diagnostics.map((item) => <li key={`${item.code}:${item.message}`}>{item.message}</li>)}</ul></AlertDescription></Alert> : null}
      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">Advanced proposal details</summary>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <ReviewValue label="Proposal ID" value={proposal.proposalId} />
          <ReviewValue label="Base revision" value={proposal.baseRevision} />
          <ReviewValue label="Activation" value={proposal.activation} />
          <ReviewValue label="Account selection" value={proposal.target.accountSelectionMode} />
          <ReviewValue label="Discovery expires" value={proposal.target.discoveryExpiresAt} />
          <ReviewValue label="Evidence expires" value={proposal.target.evidenceExpiresAt} />
          <ReviewValue label="Rollback" value={proposal.rollback.summary} />
        </dl>
      </details>
    </div>
  );
}

function ReviewValue(props: { readonly label: string; readonly value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{props.label}</dt><dd className="break-all font-medium capitalize">{props.value}</dd></div>;
}

function RejectionAlert(props: {
  readonly result: Extract<WizardResult, { status: "rejected" }>;
  readonly repairButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly onRefresh?: () => void;
  readonly onClose: () => void;
}) {
  const refreshAction = props.result.action === "refresh-and-retry" || props.result.action === "refresh-catalog";
  const canRefresh = refreshAction && Boolean(props.onRefresh);
  const actionLabel: Record<Exclude<typeof props.result.action, "none" | "approve-and-apply">, string> = {
    "refresh-and-retry": "Refresh models",
    "select-current-model": "Choose another model",
    "configure-account": "Close and configure account",
    "review-data-policy": "Close and review data policy",
    "review-economics": "Close and review economics",
    "refresh-catalog": "Refresh models",
  };
  return (
    <Alert variant="destructive">
      <AlertTitle>Target could not be prepared</AlertTitle>
      <AlertDescription>
        <p>{props.result.message}</p>
        {props.result.diagnostics?.length ? <ul className="mt-2 list-disc space-y-1 pl-4">{props.result.diagnostics.map((item) => <li key={`${item.code}:${item.message}`}>{item.message}</li>)}</ul> : null}
        <Button autoFocus ref={props.repairButtonRef} type="button" variant="outline" size="sm" className="mt-3" onClick={() => { if (canRefresh) props.onRefresh?.(); else props.onClose(); }}>{refreshAction && !canRefresh ? "Close" : actionLabel[props.result.action]}</Button>
      </AlertDescription>
    </Alert>
  );
}

function Filter(props: { readonly label: string; readonly value: string; readonly options: readonly string[]; readonly onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-medium">{props.label}
      <select aria-label={props.label} value={props.value} onChange={(event) => props.onChange(event.target.value)} className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
        {props.options.map((option) => <option key={option} value={option}>{option === "all" ? "All" : `${option[0]?.toUpperCase()}${option.slice(1)}`}</option>)}
      </select>
    </label>
  );
}
