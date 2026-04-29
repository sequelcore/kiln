import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatOperatorEventValue } from "@kilnai/gateway-contracts";
import type { ActivityPhase, TimelineEntry, TimelineEventEntry } from "../lib/session-store.js";
import { ActivityPhaseIndicator } from "./activity-phase-indicator.js";
import { MessageRow } from "./message-row.js";
import { Button } from "@/components/ui/button";

interface TranscriptProps {
  readonly entries: readonly TimelineEntry[];
  readonly activityPhase?: ActivityPhase;
  readonly activityToolName?: string;
  readonly activityDetails?: string;
  readonly onApprove?: (sessionId: string) => void;
  readonly onDeny?: (sessionId: string) => void;
}

const BOTTOM_THRESHOLD_PX = 24;

function isAtBottom(node: HTMLDivElement): boolean {
  const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
  return distanceFromBottom <= BOTTOM_THRESHOLD_PX;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatUsd(value: number | null): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function MetaList(props: { readonly items: readonly { label: string; value: string }[] }) {
  if (props.items.length === 0) return null;
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {props.items.map((item) => (
        <div key={`${item.label}:${item.value}`} className="rounded-md border border-[var(--color-border)]/50 bg-[var(--color-background)] px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">{item.label}</dt>
          <dd className="mt-1 text-sm leading-5 text-[var(--color-text)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ToolEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const input = asRecord(details.input) ?? details;
  const items: { label: string; value: string }[] = [];
  const status = readString(details.status);
  const result = readString(details.result);
  if (status) items.push({ label: "Status", value: status });
  if (result) items.push({ label: "Result", value: result });
  for (const [key, value] of Object.entries(input).slice(0, 4)) {
    const formatted = formatOperatorEventValue(value);
    if (formatted) {
      items.push({ label: key, value: formatted });
    }
  }
  return <MetaList items={items} />;
}

function ApprovalEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const resolution = asRecord(details.resolution);
  const items = [
    readString(details.action) ? { label: "Action", value: readString(details.action)! } : null,
    readString(details.justification) ? { label: "Why", value: readString(details.justification)! } : null,
    readString(details.approvalId) ? { label: "Approval ID", value: readString(details.approvalId)! } : null,
    readString(resolution?.decision) ? { label: "Decision", value: readString(resolution?.decision)! } : null,
    readString(resolution?.resolvedBy) ? { label: "Resolved by", value: readString(resolution?.resolvedBy)! } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function FileChangedDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const diffPreview = readString(details.diffPreview);
  const diffTruncated = details.diffTruncated === true;
  const items = [
    readString(details.path) ? { label: "Path", value: readString(details.path)! } : null,
    readString(details.changeType) ? { label: "Change", value: readString(details.changeType)! } : null,
    readNumber(details.linesAdded) !== null ? { label: "Lines added", value: String(readNumber(details.linesAdded)) } : null,
    readNumber(details.linesRemoved) !== null ? { label: "Lines removed", value: String(readNumber(details.linesRemoved)) } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return (
    <>
      <MetaList items={items} />
      {diffPreview ? (
        <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-background-element)] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-dim)]">Diff preview</p>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-[11px] leading-5 text-[var(--color-text)]">
            {diffPreview}
          </pre>
          {diffTruncated ? (
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Preview truncated.</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CostEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const provider = asRecord(details.provider);
  const usage = asRecord(details.usage);
  const cost = asRecord(details.cost);
  const items = [
    readString(provider?.provider) ? { label: "Provider", value: readString(provider?.provider)! } : null,
    readString(provider?.model) ? { label: "Model", value: readString(provider?.model)! } : null,
    formatUsd(readNumber(cost?.deltaUsd)) ? { label: "Cost", value: formatUsd(readNumber(cost?.deltaUsd))! } : null,
    readNumber(usage?.inputTokens) !== null ? { label: "Input tokens", value: String(readNumber(usage?.inputTokens)) } : null,
    readNumber(usage?.outputTokens) !== null ? { label: "Output tokens", value: String(readNumber(usage?.outputTokens)) } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function ProviderEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const provider = asRecord(details.provider);
  const items = [
    readString(provider?.provider) ? { label: "Provider", value: readString(provider?.provider)! } : null,
    readString(provider?.model) ? { label: "Model", value: readString(provider?.model)! } : null,
    readString(details.reason) ? { label: "Why", value: readString(details.reason)! } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function ContinuityEventDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const runtimeContinuity = asRecord(details.runtimeContinuity);
  const items = [
    readString(details.decision) ? { label: "Decision", value: readString(details.decision)! } : null,
    readString(details.reason) ? { label: "Reason", value: readString(details.reason)! } : null,
    readString(runtimeContinuity?.strategy) ? { label: "Strategy", value: readString(runtimeContinuity?.strategy)! } : null,
    readString(runtimeContinuity?.selectionReason) ? { label: "Selection", value: readString(runtimeContinuity?.selectionReason)! } : null,
    readString(runtimeContinuity?.feedbackLabel) ? { label: "Feedback", value: readString(runtimeContinuity?.feedbackLabel)! } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function TurnCompletedDetails(props: { readonly entry: TimelineEventEntry }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const authority = asRecord(details.authorityStatus);
  const runtimeContinuity = asRecord(details.runtimeContinuity);
  const items = [
    readString(details.routedProvider) ? { label: "Provider", value: readString(details.routedProvider)! } : null,
    readString(details.routedModel) ? { label: "Model", value: readString(details.routedModel)! } : null,
    readString(runtimeContinuity?.strategy) ? { label: "Continuity", value: readString(runtimeContinuity?.strategy)! } : null,
    readString(runtimeContinuity?.selectionReason) ? { label: "Why", value: readString(runtimeContinuity?.selectionReason)! } : null,
    readString(authority?.effective) ? { label: "Authority", value: readString(authority?.effective)! } : null,
    readNumber(details.inputTokens) !== null ? { label: "Input tokens", value: String(readNumber(details.inputTokens)) } : null,
    readNumber(details.outputTokens) !== null ? { label: "Output tokens", value: String(readNumber(details.outputTokens)) } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return <MetaList items={items} />;
}

function canRenderEventDetails(entry: TimelineEventEntry): boolean {
  if (entry.details === undefined) return false;
  switch (entry.eventKind) {
    case "tool_call_started":
    case "tool_call_completed":
    case "approval_requested":
    case "approval_resolved":
    case "file_changed":
    case "cost_updated":
    case "provider_routed":
    case "continuity_decided":
    case "turn_completed":
      return true;
    default:
      return false;
  }
}

function EventDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
  if (!props.open) return null;
  switch (props.entry.eventKind) {
    case "tool_call_started":
    case "tool_call_completed":
      return <ToolEventDetails entry={props.entry} />;
    case "approval_requested":
    case "approval_resolved":
      return <ApprovalEventDetails entry={props.entry} />;
    case "file_changed":
      return <FileChangedDetails entry={props.entry} />;
    case "cost_updated":
      return <CostEventDetails entry={props.entry} />;
    case "provider_routed":
      return <ProviderEventDetails entry={props.entry} />;
    case "continuity_decided":
      return <ContinuityEventDetails entry={props.entry} />;
    case "turn_completed":
      return <TurnCompletedDetails entry={props.entry} />;
    default:
      return null;
  }
}

function TimelineEventRow(props: {
  readonly entry: TimelineEventEntry;
  readonly onApprove?: (sessionId: string) => void;
  readonly onDeny?: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const toneClasses = {
    info: "border-border bg-card text-muted-foreground",
    running: "border-border bg-card text-foreground",
    success: "border-border bg-card text-foreground",
    warning: "border-border bg-card text-foreground",
    error: "border-destructive bg-card text-destructive",
  }[props.entry.tone];
  const canResolveApproval = props.entry.eventKind === "approval_requested" && Boolean(props.entry.sessionId);
  const hasDetails = canRenderEventDetails(props.entry);

  return (
    <article className={`mx-auto w-full max-w-3xl rounded-lg border px-3 py-2 ${toneClasses}`}>
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em]">{props.entry.title}</p>
          {props.entry.summary ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{props.entry.summary}</p>
          ) : null}
        </div>
        <time dateTime={props.entry.createdAt} className="shrink-0 font-mono text-[10px] text-muted-foreground" title={props.entry.createdAt}>
          {new Date(props.entry.createdAt).toLocaleTimeString()}
        </time>
      </header>
      {hasDetails ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide details" : "Show details"}
          </Button>
          {canResolveApproval && props.entry.sessionId ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => props.onApprove?.(props.entry.sessionId!)}
              >
                Approve
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={() => props.onDeny?.(props.entry.sessionId!)}
              >
                Deny
              </Button>
            </>
          ) : null}
        </div>
      ) : canResolveApproval && props.entry.sessionId ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => props.onApprove?.(props.entry.sessionId!)}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={() => props.onDeny?.(props.entry.sessionId!)}
          >
            Deny
          </Button>
        </div>
      ) : null}
      <EventDetails entry={props.entry} open={open} />
    </article>
  );
}

function AssistantActivityRow(props: {
  readonly phase: ActivityPhase;
  readonly toolName?: string;
  readonly details?: string;
}) {
  return (
    <article data-role="assistant" className="mx-auto flex w-full max-w-3xl justify-start">
      <div className="max-w-[min(46rem,92%)] rounded-lg border border-dashed bg-card px-3 py-2">
        <header className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Assistant</span>
        </header>
        <ActivityPhaseIndicator
          phase={props.phase}
          toolName={props.toolName}
          details={props.details}
        />
      </div>
    </article>
  );
}

export function Transcript(props: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);
  const [hasUserScrolledUp, setHasUserScrolledUp] = useState(false);
  const lastEntry = props.entries[props.entries.length - 1];
  const lastEntryAnchor = lastEntry?.type === "message" ? lastEntry.message.content : lastEntry?.summary;
  const hasStreamingAssistant = props.entries.some((entry) => (
    entry.type === "message"
    && entry.message.role === "assistant"
    && entry.message.streaming === true
  ));
  const showAssistantActivity = props.activityPhase
    && props.activityPhase !== "idle"
    && !(props.activityPhase === "streaming" && hasStreamingAssistant);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const onScroll = () => {
      const atBottom = isAtBottom(node);
      shouldStickRef.current = atBottom;
      setHasUserScrolledUp(!atBottom);
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || !shouldStickRef.current) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [props.entries.length, lastEntryAnchor, showAssistantActivity, props.activityPhase]);

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      <div
        ref={containerRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-label="Transcript"
      >
        {props.entries.length === 0 && !showAssistantActivity ? (
          <div className="mx-auto w-full max-w-3xl rounded-lg border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            Start a conversation to see the transcript.
          </div>
        ) : (
          props.entries.map((entry) => (
            entry.type === "message"
              ? <MessageRow key={entry.id} message={entry.message} />
              : <TimelineEventRow key={entry.id} entry={entry} onApprove={props.onApprove} onDeny={props.onDeny} />
          ))
        )}
        {showAssistantActivity ? (
          <AssistantActivityRow
            phase={props.activityPhase!}
            toolName={props.activityToolName}
            details={props.activityDetails}
          />
        ) : null}
      </div>
      {hasUserScrolledUp ? (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[var(--color-background)] to-transparent" />
      ) : null}
    </section>
  );
}
