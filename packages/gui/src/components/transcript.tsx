import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TimelineEntry, TimelineEventEntry } from "../lib/session-store.js";
import { MessageRow } from "./message-row.js";

interface TranscriptProps {
  readonly entries: readonly TimelineEntry[];
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

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
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

function JsonDetails(props: { readonly open: boolean; readonly details: unknown }) {
  if (!props.open) return null;
  return (
    <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-[var(--color-border)]/60 bg-[var(--color-background)] px-3 py-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
      {JSON.stringify(props.details, null, 2)}
    </pre>
  );
}

function ToolEventDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const input = asRecord(details.input) ?? details;
  const items: { label: string; value: string }[] = [];
  const status = readString(details.status);
  const result = readString(details.result);
  if (status) items.push({ label: "Status", value: status });
  if (result) items.push({ label: "Result", value: result });
  for (const [key, value] of Object.entries(input).slice(0, 4)) {
    items.push({ label: key, value: formatValue(value) });
  }
  return (
    <>
      <MetaList items={items} />
      <JsonDetails open={props.open} details={props.entry.details} />
    </>
  );
}

function ApprovalEventDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
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
  return (
    <>
      <MetaList items={items} />
      <JsonDetails open={props.open} details={props.entry.details} />
    </>
  );
}

function FileChangedDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
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
      <JsonDetails open={props.open} details={props.entry.details} />
    </>
  );
}

function CostEventDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
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
  return (
    <>
      <MetaList items={items} />
      <JsonDetails open={props.open} details={props.entry.details} />
    </>
  );
}

function ProviderEventDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const provider = asRecord(details.provider);
  const items = [
    readString(provider?.provider) ? { label: "Provider", value: readString(provider?.provider)! } : null,
    readString(provider?.model) ? { label: "Model", value: readString(provider?.model)! } : null,
    readString(details.reason) ? { label: "Why", value: readString(details.reason)! } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  return (
    <>
      <MetaList items={items} />
      <JsonDetails open={props.open} details={props.entry.details} />
    </>
  );
}

function ContinuityEventDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
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
  return (
    <>
      <MetaList items={items} />
      <JsonDetails open={props.open} details={props.entry.details} />
    </>
  );
}

function TurnCompletedDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
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
  return (
    <>
      <MetaList items={items} />
      <JsonDetails open={props.open} details={props.entry.details} />
    </>
  );
}

function EventDetails(props: { readonly entry: TimelineEventEntry; readonly open: boolean }) {
  switch (props.entry.eventKind) {
    case "tool_call_started":
    case "tool_call_completed":
      return <ToolEventDetails entry={props.entry} open={props.open} />;
    case "approval_requested":
    case "approval_resolved":
      return <ApprovalEventDetails entry={props.entry} open={props.open} />;
    case "file_changed":
      return <FileChangedDetails entry={props.entry} open={props.open} />;
    case "cost_updated":
      return <CostEventDetails entry={props.entry} open={props.open} />;
    case "provider_routed":
      return <ProviderEventDetails entry={props.entry} open={props.open} />;
    case "continuity_decided":
      return <ContinuityEventDetails entry={props.entry} open={props.open} />;
    case "turn_completed":
      return <TurnCompletedDetails entry={props.entry} open={props.open} />;
    default:
      return props.entry.details !== undefined ? <JsonDetails open={props.open} details={props.entry.details} /> : null;
  }
}

function TimelineEventRow(props: {
  readonly entry: TimelineEventEntry;
  readonly onApprove?: (sessionId: string) => void;
  readonly onDeny?: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const toneClasses = {
    info: "border-[var(--color-border)] bg-[var(--color-background-element)] text-[var(--color-text-muted)]",
    running: "border-[var(--color-info)]/40 bg-[var(--color-info)]/8 text-[var(--color-info)]",
    success: "border-[var(--color-success)]/40 bg-[var(--color-success)]/8 text-[var(--color-success)]",
    warning: "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/8 text-[var(--color-warning)]",
    error: "border-[var(--color-error)]/40 bg-[var(--color-error)]/8 text-[var(--color-error)]",
  }[props.entry.tone];
  const canResolveApproval = props.entry.eventKind === "approval_requested" && Boolean(props.entry.sessionId);
  const hasDetails = props.entry.details !== undefined;

  return (
    <article className={`rounded-lg border px-4 py-3 shadow-sm ${toneClasses}`}>
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{props.entry.title}</p>
          {props.entry.summary ? (
            <p className="mt-1 text-sm leading-6 text-[var(--color-text)]">{props.entry.summary}</p>
          ) : null}
        </div>
        <time dateTime={props.entry.createdAt} className="shrink-0 text-[10px] opacity-80" title={props.entry.createdAt}>
          {new Date(props.entry.createdAt).toLocaleTimeString()}
        </time>
      </header>
      {hasDetails ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="rounded border border-current/30 px-2 py-1 text-[11px] uppercase tracking-wide hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            {open ? "Hide details" : "Show details"}
          </button>
          {canResolveApproval && props.entry.sessionId ? (
            <>
              <button
                type="button"
                onClick={() => props.onApprove?.(props.entry.sessionId!)}
                className="rounded border border-[var(--color-success)]/50 bg-[var(--color-success)]/10 px-2 py-1 text-[11px] font-medium text-[var(--color-success)] hover:bg-[var(--color-success)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-success)]"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => props.onDeny?.(props.entry.sessionId!)}
                className="rounded border border-[var(--color-error)]/50 bg-[var(--color-error)]/10 px-2 py-1 text-[11px] font-medium text-[var(--color-error)] hover:bg-[var(--color-error)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)]"
              >
                Deny
              </button>
            </>
          ) : null}
        </div>
      ) : canResolveApproval && props.entry.sessionId ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => props.onApprove?.(props.entry.sessionId!)}
            className="rounded border border-[var(--color-success)]/50 bg-[var(--color-success)]/10 px-2 py-1 text-[11px] font-medium text-[var(--color-success)] hover:bg-[var(--color-success)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-success)]"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => props.onDeny?.(props.entry.sessionId!)}
            className="rounded border border-[var(--color-error)]/50 bg-[var(--color-error)]/10 px-2 py-1 text-[11px] font-medium text-[var(--color-error)] hover:bg-[var(--color-error)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)]"
          >
            Deny
          </button>
        </div>
      ) : null}
      <EventDetails entry={props.entry} open={open} />
    </article>
  );
}

export function Transcript(props: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);
  const [hasUserScrolledUp, setHasUserScrolledUp] = useState(false);
  const lastEntry = props.entries[props.entries.length - 1];

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
  }, [props.entries.length, lastEntry?.type === "message" ? lastEntry.message.content : lastEntry?.summary]);

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      <div
        ref={containerRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-label="Transcript"
      >
        {props.entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-background-element)]/50 px-4 py-6 text-sm text-[var(--color-text-muted)]">
            Start a conversation to see the transcript.
          </div>
        ) : (
          props.entries.map((entry) => (
            entry.type === "message"
              ? <MessageRow key={entry.id} message={entry.message} />
              : <TimelineEventRow key={entry.id} entry={entry} onApprove={props.onApprove} onDeny={props.onDeny} />
          ))
        )}
      </div>
      {hasUserScrolledUp ? (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[var(--color-background)] to-transparent" />
      ) : null}
    </section>
  );
}
