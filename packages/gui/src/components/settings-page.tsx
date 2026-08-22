import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Download, FileCode2, LoaderCircle, RotateCcw, Save, Search, Upload } from "lucide-react";
import type {
  KilnConfigMutationScope,
  KilnSettingsApplyRequest,
  KilnSettingsEntry,
  KilnSettingsMutationResult,
  KilnSettingsProposalProjection,
  KilnSettingsProposalRequest,
  KilnSettingsSnapshot,
  OperatorCockpitEconomicAttemptProjection,
} from "@kilnai/gateway-contracts";
import { KilnSettingsSnapshotSchema } from "@kilnai/gateway-contracts";
import { formatOperatorManagedEconomicAmount } from "@kilnai/gateway-contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SettingsSection } from "./settings-navigation.js";

interface SettingsPageProps {
  readonly section: SettingsSection;
  readonly snapshot: KilnSettingsSnapshot | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onRefresh: () => undefined | Promise<unknown>;
  readonly onPropose: (request: KilnSettingsProposalRequest) => Promise<KilnSettingsProposalProjection>;
  readonly onApply: (request: KilnSettingsApplyRequest) => Promise<KilnSettingsMutationResult>;
  readonly leadingContent?: ReactNode;
  readonly trailingContent?: ReactNode;
  readonly onOpenYaml?: () => void;
  /** Runtime-owned, secret-free managed economic evidence from the shared cockpit projection. */
  readonly economicAttempts?: readonly OperatorCockpitEconomicAttemptProjection[];
}

export function SettingsPage(props: SettingsPageProps) {
  const [query, setQuery] = useState("");
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const [proposal, setProposal] = useState<KilnSettingsProposalProjection | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [focusAfterRefresh, setFocusAfterRefresh] = useState<{
    readonly key: string;
    readonly previousGeneration: string | null;
  } | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!focusAfterRefresh || (props.snapshot?.generatedAt ?? null) === focusAfterRefresh.previousGeneration) return;
    const frame = window.requestAnimationFrame(() => {
      focusSettingOrFallback(focusAfterRefresh.key, props.section);
      setFocusAfterRefresh(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusAfterRefresh, props.section, props.snapshot?.generatedAt]);

  const entries = useMemo(() => {
    const snapshotEntries = props.snapshot?.entries ?? [];
    const sectionEntries = props.section === "advanced"
      ? snapshotEntries
      : snapshotEntries.filter((entry) => entry.section === props.section);
    const normalizedQuery = query.trim().toLowerCase();
    return sectionEntries.filter((entry) => {
      if (modifiedOnly && !entry.modified) return false;
      if (!normalizedQuery) return true;
      return [entry.key, entry.label, entry.description, ...entry.searchTerms]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [modifiedOnly, props.section, props.snapshot, query]);

  const section = props.snapshot?.sections?.find((candidate) => candidate.id === props.section);

  async function propose(request: KilnSettingsProposalRequest, invoker: HTMLElement) {
    if (pendingKey) return;
    invokerRef.current = invoker;
    setPendingKey(request.key);
    setFeedback(null);
    setProposalError(null);
    try {
      setProposal(await props.onPropose(request));
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : String(error));
      queueMicrotask(() => invoker.focus());
    } finally {
      setPendingKey(null);
    }
  }

  async function applyProposal() {
    if (!proposal || pendingKey) return;
    const settingKey = proposal.key;
    setPendingKey(proposal.key);
    setFeedback(null);
    let refreshExpected = false;
    try {
      const result = await props.onApply({ proposalId: proposal.proposalId });
      setProposal(null);
      setFeedback(feedbackForResult(result));
      if (result.outcome !== "rejected") {
        refreshExpected = true;
        setFocusAfterRefresh({
          key: settingKey,
          previousGeneration: props.snapshot?.generatedAt ?? null,
        });
        await props.onRefresh();
      }
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingKey(null);
      if (refreshExpected) {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          focusSettingOrFallback(settingKey, props.section);
        }));
      } else {
        window.requestAnimationFrame(() => {
          const invoker = invokerRef.current;
          if (invoker?.isConnected) {
            invoker.focus();
            return;
          }
          document.querySelector<HTMLElement>(
            `#setting-${safeId(settingKey)} button:not(:disabled), #setting-${safeId(settingKey)} input:not(:disabled), #setting-${safeId(settingKey)} select:not(:disabled)`,
          )?.focus();
        });
      }
    }
  }

  if (props.loading && !props.snapshot) {
    return <SettingsState title="Loading settings" detail="Reading effective values and provenance." busy />;
  }
  if (props.error && !props.snapshot) {
    return <SettingsState title="Settings unavailable" detail={props.error.message} onRetry={props.onRefresh} />;
  }

  return (
    <div className="px-4 py-6 sm:px-7 sm:py-8">
      <header className="mb-7 flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="mb-2 flex items-center gap-2">
            <h2 id={`settings-${props.section}-heading`} tabIndex={-1} className="text-lg font-semibold tracking-[-0.02em] text-foreground">
              {section?.label ?? sectionLabel(props.section)}
            </h2>
            {props.snapshot ? <Badge variant="outline">{props.snapshot.health}</Badge> : null}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {section?.description ?? "Effective configuration from the shared settings model."}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void props.onRefresh()} disabled={props.loading}>
          {props.loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
          Refresh
        </Button>
      </header>

      {feedback ? <p role="status" className="mb-5 text-sm text-foreground">{feedback}</p> : null}
      {proposalError ? (
        <Alert variant="destructive" className="mb-5">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Settings change failed</AlertTitle>
          <AlertDescription>{proposalError}</AlertDescription>
        </Alert>
      ) : null}

      {props.leadingContent}

      {props.section === "usage-and-limits" ? (
        <section aria-labelledby="economic-evidence-heading" className="mb-5 border-y border-border/70 py-4">
          <h3 id="economic-evidence-heading" className="text-sm font-medium text-foreground">Provider usage evidence</h3>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
            Allowance, reset, observed usage, estimates, reservations, settlements, freshness, and confidence are read-only.
            Evidence below is projected from Runtime-owned managed-run events; absent evidence never means zero usage or available spend.
          </p>
          {props.economicAttempts && props.economicAttempts.length > 0 ? (
            <>
              {props.economicAttempts.length > 5 ? (
                <p className="mt-3 text-xs text-muted-foreground">Showing 5 of {props.economicAttempts.length} managed-run attempts.</p>
              ) : null}
              <ul className="mt-3 grid gap-2 font-mono text-xs text-muted-foreground">
              {props.economicAttempts.slice(0, 5).map((attempt) => (
                <li key={`${attempt.instanceId}:${attempt.sessionId}:${attempt.jobId}`} className="rounded-md border border-border/60 px-3 py-2">
                  <span className="text-foreground">{attempt.selectedTarget?.targetId ?? attempt.selectedRoute?.routeId ?? "target unavailable"}</span>
                  {attempt.billingClass ? ` · billing ${attempt.billingClass}` : ""}
                  {attempt.reservedAmount ? ` · reserved ${formatOperatorManagedEconomicAmount(attempt.reservedAmount)}` : ""}
                  {attempt.settledAmount ? ` · settled ${formatOperatorManagedEconomicAmount(attempt.settledAmount)}` : ""}
                  {attempt.evidenceFreshness ? ` · evidence ${attempt.evidenceFreshness}` : ""}
                  {attempt.terminalCause ? ` · ${attempt.terminalCause}` : ""}
                </li>
              ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">No managed-run economic evidence is available in the current session.</p>
          )}
        </section>
      ) : null}

      {props.section === "advanced" && props.snapshot ? (
        <AdvancedSettingsActions snapshot={props.snapshot} onOpenYaml={props.onOpenYaml} />
      ) : null}

      {props.section === "advanced" ? (
        <div className="mb-5 flex flex-col gap-3 border-y border-border/70 py-4 sm:flex-row sm:items-center">
          <label htmlFor="advanced-settings-search" className="relative min-w-0 flex-1">
            <span className="sr-only">Search all settings</span>
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="advanced-settings-search"
              type="search"
              aria-label="Search all settings"
              placeholder="Search keys, controls, and owners"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-8"
            />
          </label>
          <label className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={modifiedOnly}
              onChange={(event) => setModifiedOnly(event.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            Modified only
          </label>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="divide-y divide-border/70 border-y border-border/70">
          {entries.map((entry) => (
            <SettingRow
              key={`${props.snapshot?.generatedAt ?? "empty"}:${entry.key}`}
              entry={entry}
              disabled={pendingKey !== null}
              pending={pendingKey === entry.key}
              onPropose={propose}
            />
          ))}
        </div>
      ) : props.leadingContent || props.trailingContent ? null : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {props.section === "advanced" ? "No settings match this filter." : "No editable settings are published for this section."}
        </p>
      )}

      {props.trailingContent}

      <Dialog open={proposal !== null} onOpenChange={(open) => {
        if (!open && !pendingKey) setProposal(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{proposal?.operation === "setting.reset" ? "Reset to inheritance?" : "Apply settings change?"}</DialogTitle>
            <DialogDescription>
              {proposal ? proposalSummary(proposal) : "Review the canonical settings proposal."}
            </DialogDescription>
          </DialogHeader>
          {proposal?.diagnostics.length ? (
            <div role="group" className="space-y-2 text-sm" aria-label="Proposal diagnostics">
              {proposal.diagnostics.map((diagnostic) => (
                <p key={`${diagnostic.code}:${diagnostic.message}`} className={diagnostic.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
                  {diagnostic.message}
                </p>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={Boolean(pendingKey)} />}>Cancel</DialogClose>
            <Button
              type="button"
              onClick={() => void applyProposal()}
              disabled={Boolean(pendingKey) || proposal?.status !== "valid"}
            >
              {pendingKey ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {proposal?.approvalRequired ? "Approve and apply" : "Apply change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdvancedSettingsActions(props: {
  readonly snapshot: KilnSettingsSnapshot;
  readonly onOpenYaml?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [validation, setValidation] = useState<string | null>(null);

  function exportSnapshot() {
    const blob = new Blob([`${JSON.stringify(props.snapshot, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kiln-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function validateImport(file: File | undefined) {
    if (!file) return;
    try {
      KilnSettingsSnapshotSchema.parse(JSON.parse(await file.text()));
      setValidation("Settings export is valid. Apply changes through the typed controls or CLI so each write retains revision fencing.");
    } catch {
      setValidation("Import rejected: choose a valid secret-free Kiln settings export.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section aria-labelledby="advanced-files-heading" className="mb-5 border-y border-border/70 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h3 id="advanced-files-heading" className="text-sm font-medium text-foreground">YAML and portable inspection</h3>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Open canonical YAML, export the secret-free read model, or validate an export. Imports never bypass typed mutation authority.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={props.onOpenYaml} disabled={!props.onOpenYaml}>
            <FileCode2 aria-hidden="true" />
            Open project YAML
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={exportSnapshot}>
            <Download aria-hidden="true" />
            Export settings
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            Import and validate
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose settings export to validate"
            onChange={(event) => void validateImport(event.target.files?.[0])}
          />
        </div>
      </div>
      <p role="status" className="mt-3 text-xs text-muted-foreground">
        {validation ?? `Schema revision ${props.snapshot.schemaRevision}; ${props.snapshot.modifiedCount} modified; health ${props.snapshot.health}.`}
      </p>
    </section>
  );
}

function SettingRow(props: {
  readonly entry: KilnSettingsEntry;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly onPropose: (request: KilnSettingsProposalRequest, invoker: HTMLElement) => Promise<void>;
}) {
  const [scope, setScope] = useState<KilnConfigMutationScope>(() => preferredScope(props.entry));
  const [draft, setDraft] = useState(() => draftFor(props.entry, preferredScope(props.entry)));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const nextScope = preferredScope(props.entry);
    setScope(nextScope);
    setDraft(draftFor(props.entry, nextScope));
    setLocalError(null);
  }, [props.entry]);

  function proposeSet(invoker: HTMLElement) {
    try {
      const value = valueFromDraft(props.entry, draft);
      setLocalError(null);
      void props.onPropose({
        operation: "setting.set",
        scope,
        key: props.entry.key,
        expectedRevision: revisionForScope(props.entry, scope),
        value,
      }, invoker);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      invoker.focus();
    }
  }

  const selectedTarget = writeTargetForScope(props.entry, scope);

  return (
    <article id={`setting-${safeId(props.entry.key)}`} tabIndex={-1} className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)] lg:items-start">
      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{props.entry.label}</h3>
          {props.entry.modified ? (
            <Badge variant="secondary">{writeTargetForScope(props.entry, scope)?.modified ? "Modified here" : "Modified elsewhere"}</Badge>
          ) : null}
          {selectedTarget?.approvalRequired ? <Badge variant="outline">Approval</Badge> : null}
        </div>
        <p className="max-w-[70ch] text-sm leading-5 text-muted-foreground">{props.entry.description}</p>
        <p className="mt-2 text-xs text-muted-foreground">{provenanceLine(props.entry, scope)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Writes to {scope === "project" ? "this project" : "global defaults"}; authority {authorityLabel(selectedTarget?.authorityImpact ?? props.entry.authorityImpact)}.
        </p>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {props.entry.supportedScopes.length > 1 ? (
            <select
              aria-label={`Write scope for ${props.entry.label}`}
              value={scope}
              onChange={(event) => {
                const nextScope = event.target.value as KilnConfigMutationScope;
                setScope(nextScope);
                setDraft(draftFor(props.entry, nextScope));
              }}
              disabled={props.disabled}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {props.entry.supportedScopes.map((candidate) => <option key={candidate} value={candidate}>{scopeLabel(candidate)}</option>)}
            </select>
          ) : null}
          <SettingControl entry={props.entry} draft={draft} disabled={props.disabled} onDraftChange={setDraft} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.disabled || !props.entry.capabilities.set}
            onClick={(event) => proposeSet(event.currentTarget)}
            aria-label={`Save ${props.entry.label}`}
          >
            {props.pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            Save
          </Button>
          {writeTargetForScope(props.entry, scope)?.modified && props.entry.capabilities.reset ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={props.disabled}
              aria-label={`Reset ${props.entry.label} to inheritance`}
              onClick={(event) => void props.onPropose({
                operation: "setting.reset",
                scope,
                key: props.entry.key,
                expectedRevision: revisionForScope(props.entry, scope),
              }, event.currentTarget)}
            >
              <RotateCcw aria-hidden="true" />
              Reset
            </Button>
          ) : null}
        </div>
        {localError ? <p role="alert" className="text-xs text-destructive">{localError}</p> : null}
      </div>
    </article>
  );
}

function SettingControl(props: {
  readonly entry: KilnSettingsEntry;
  readonly draft: string | boolean;
  readonly disabled: boolean;
  readonly onDraftChange: (draft: string | boolean) => void;
}) {
  const label = `Value for ${props.entry.label}`;
  if (props.entry.control.kind === "toggle") {
    const checked = props.draft === true;
    return (
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={props.disabled}
        onClick={() => props.onDraftChange(!checked)}
        className="inline-flex h-8 min-w-20 items-center justify-between gap-2 rounded-lg border border-input px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <span>{checked ? "On" : "Off"}</span>
        <span aria-hidden="true" className={`h-4 w-7 rounded-full p-0.5 transition-colors ${checked ? "bg-primary" : "bg-muted"}`}>
          <span className={`block size-3 rounded-full bg-background transition-transform ${checked ? "translate-x-3" : "translate-x-0"}`} />
        </span>
      </button>
    );
  }
  if (props.entry.control.kind === "select" || props.entry.control.kind === "theme") {
    const options = props.entry.control.options ?? [];
    return (
      <select
        aria-label={label}
        value={String(props.draft)}
        disabled={props.disabled}
        onChange={(event) => props.onDraftChange(event.target.value)}
        className="h-8 min-w-40 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  if (props.entry.control.kind === "json" || props.entry.control.kind === "list") {
    return (
      <Textarea
        aria-label={label}
        value={String(props.draft)}
        disabled={props.disabled}
        onChange={(event) => props.onDraftChange(event.target.value)}
        placeholder={props.entry.control.kind === "list" ? "Comma or line separated values" : undefined}
        className="min-h-20 sm:min-w-72"
      />
    );
  }
  return (
    <Input
      aria-label={label}
      type={props.entry.control.kind === "number" ? "number" : "text"}
      value={String(props.draft)}
      disabled={props.disabled}
      min={props.entry.control.kind === "number" ? props.entry.control.min : undefined}
      max={props.entry.control.kind === "number" ? props.entry.control.max : undefined}
      onChange={(event) => props.onDraftChange(event.target.value)}
      className="sm:min-w-52"
    />
  );
}

function SettingsState(props: { readonly title: string; readonly detail: string; readonly busy?: boolean; readonly onRetry?: () => undefined | Promise<unknown> }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-5 text-center">
      {props.busy ? <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" /> : <CircleAlert className="size-5 text-muted-foreground" aria-hidden="true" />}
      <h2 className="text-base font-medium">{props.title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{props.detail}</p>
      {props.onRetry ? <Button variant="outline" size="sm" onClick={() => void props.onRetry?.()}>Try again</Button> : null}
    </div>
  );
}

function preferredScope(entry: KilnSettingsEntry): KilnConfigMutationScope {
  return entry.supportedScopes.includes("project") ? "project" : entry.supportedScopes[0] ?? "project";
}

function draftFor(entry: KilnSettingsEntry, scope: KilnConfigMutationScope): string | boolean {
  const target = writeTargetForScope(entry, scope);
  const projected = target?.current
    ?? (scope === preferredScope(entry) ? entry.effective : { value: null });
  if (projected.redacted) return "";
  const value = projected.value;
  if (entry.control.kind === "toggle") return value === true;
  if (entry.control.kind === "json") return JSON.stringify(value, null, 2);
  if (entry.control.kind === "list") return Array.isArray(value) ? value.join(", ") : "";
  return value === null || value === undefined ? "" : String(value);
}

function valueFromDraft(entry: KilnSettingsEntry, draft: string | boolean): unknown {
  if (entry.control.kind === "toggle") return draft === true;
  const text = String(draft);
  if (entry.control.kind === "number") {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error("Enter a valid number.");
    return value;
  }
  if (entry.control.kind === "json") {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Enter valid JSON before proposing this change.");
    }
  }
  if (entry.control.kind === "list") {
    const items = text.split(/[,\n]/u).map((item) => item.trim()).filter(Boolean);
    if (entry.control.itemKind === "number") {
      const numbers = items.map(Number);
      if (numbers.some((value) => !Number.isFinite(value))) throw new Error("Enter valid numeric list values.");
      return numbers;
    }
    return items;
  }
  return text;
}

function provenanceLine(entry: KilnSettingsEntry, scope: KilnConfigMutationScope): string {
  const target = writeTargetForScope(entry, scope);
  return `${title(entry.source)} · ${title(target?.override ?? entry.override)} in ${scopeLabel(scope).toLowerCase()} · ${title((target?.activation ?? entry.activation).replaceAll("-", " "))}`;
}

function writeTargetForScope(entry: KilnSettingsEntry, scope: KilnConfigMutationScope) {
  return entry.writeTargets.find((target) => target.scope === scope);
}

function revisionForScope(entry: KilnSettingsEntry, scope: KilnConfigMutationScope): string {
  return entry.revisions[scope] ?? "absent";
}

function authorityLabel(impact: KilnSettingsEntry["authorityImpact"]): string {
  if (impact === "none") return "does not expand";
  if (impact === "expands-read") return "expands read access";
  if (impact === "expands-write") return "expands write access";
  return "requires evaluation";
}

function feedbackForResult(result: KilnSettingsMutationResult): string {
  if (result.outcome === "committed-reconciliation-failed") {
    return "Change committed, but reconciliation failed. Review Health and retry convergence.";
  }
  if (result.outcome === "rejected") {
    return result.rejectionCode === "revision-conflict"
      ? "Change rejected because configuration changed. Refresh and propose again."
      : `Change rejected (${result.rejectionCode ?? "unknown"}). Review the diagnostics and retry.`;
  }
  return result.readBack.verified
    ? "Change committed and verified from the shared settings model."
    : "Change committed; refreshed effective-state verification is still pending.";
}

function proposalSummary(proposal: KilnSettingsProposalProjection): string {
  const action = proposal.operation === "setting.reset" ? "Remove this override" : "Write the proposed value";
  const authority = proposal.authorityImpact === "none" ? "No authority expansion is expected." : "This can change runtime authority.";
  return `${action} in ${scopeLabel(proposal.scope).toLowerCase()} scope. It activates ${proposal.activation.replaceAll("-", " ")}. ${authority}`;
}

function scopeLabel(scope: KilnConfigMutationScope): string {
  return scope === "project" ? "Project" : "Global";
}

function sectionLabel(section: SettingsSection): string {
  return section === "usage-and-limits" ? "Usage and Limits" : title(section);
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/giu, "-");
}

function focusSettingOrFallback(key: string, section: SettingsSection): void {
  const rowControl = document.querySelector<HTMLElement>(
    `#setting-${safeId(key)} button:not(:disabled), #setting-${safeId(key)} input:not(:disabled), #setting-${safeId(key)} select:not(:disabled)`,
  );
  const fallback = section === "advanced"
    ? document.getElementById("advanced-settings-search")
    : document.getElementById(`settings-${section}-heading`);
  (rowControl ?? fallback)?.focus();
}
