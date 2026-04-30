import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  formatOperatorEventValue,
  operatorEmptyStatePhraseAt,
} from "@kilnai/gateway-contracts";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, LoaderCircle, Terminal } from "lucide-react";
import type { ActivityPhase, TimelineEntry, TimelineEventEntry } from "../lib/session-store.js";
import { ActivityPhaseIndicator } from "./activity-phase-indicator.js";
import { MessageRow } from "./message-row.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function compactDisplayText(value: string, maxLength = 140): string {
  const parsed = parseJsonRecord(value);
  const source = readString(parsed?.output) ?? value;
  const firstLine = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? source.trim();
  const normalized = firstLine.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function eventSummaryText(entry: TimelineEventEntry): string | null {
  if (!entry.summary) return null;
  return compactDisplayText(entry.summary, 150);
}

function detailDisplayText(value: unknown, maxLength = 180): string | null {
  const formatted = formatOperatorEventValue(value);
  if (!formatted) return null;
  return compactDisplayText(formatted, maxLength);
}

function MetaList(props: { readonly items: readonly { label: string; value: string }[] }) {
  if (props.items.length === 0) return null;
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {props.items.map((item) => (
        <div key={`${item.label}:${item.value}`} className="min-w-0 overflow-hidden rounded-md border border-[var(--color-border)]/50 bg-[var(--color-background)] px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">{item.label}</dt>
          <dd className="mt-1 break-words text-sm leading-5 text-[var(--color-text)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ToolPreviewText(props: { readonly text: string; readonly outputKind: string }) {
  const lines = props.text.replace(/\r\n/g, "\n").split("\n");
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground">
      {lines.map((line, index) => (
        <span
          key={`${index}:${line}`}
          className={cn(
            "block min-h-5",
            props.outputKind === "diff" && line.startsWith("+") ? "text-success" : null,
            props.outputKind === "diff" && line.startsWith("-") ? "text-destructive" : null,
            props.outputKind === "diff" && line.startsWith("@@") ? "text-primary" : null,
          )}
        >
          {line.length > 0 ? line : " "}
        </span>
      ))}
    </pre>
  );
}

function ToolResultPresentationDetails(props: { readonly entry: TimelineEventEntry }) {
  const presentation = props.entry.toolPresentation;
  if (!presentation) return null;
  const previewLabel = {
    command: "Command preview",
    diff: "Diff preview",
    markdown: "Markdown preview",
    text: "Text preview",
    tree: "Tree preview",
    code: "Code preview",
    table: "Table preview",
    image: "Image preview",
    resource_links: "Resource link",
    form: "Form preview",
    empty: "No output",
  }[presentation.outputKind] ?? "Preview";
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="min-w-0 rounded-md border border-border/70 bg-background px-3 py-2">
        <p className="truncate text-sm font-medium leading-5 text-foreground">{presentation.title}</p>
        {presentation.summary ? (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{presentation.summary}</p>
        ) : null}
      </div>
      <MetaList items={presentation.fields} />
      {presentation.resourceLinks?.map((resource) => (
        <div key={resource.uri} className="min-w-0 rounded-md border border-border/70 bg-background px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{previewLabel}</p>
          <p className="mt-1 truncate text-sm font-medium text-foreground">{resource.title ?? resource.uri}</p>
          <p className="mt-1 break-all font-mono text-[11px] leading-5 text-muted-foreground">{resource.uri}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {resource.mimeType ? <span>{resource.mimeType}</span> : null}
            {resource.size !== undefined ? <span>{resource.size} bytes</span> : null}
            {resource.relation ? <span>{resource.relation}</span> : null}
          </div>
        </div>
      ))}
      {presentation.preview ? (
        <div className="rounded-md border border-border/70 bg-background-element/35 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{previewLabel}</p>
            {presentation.preview.truncated ? (
              <span className="font-mono text-[10px] text-muted-foreground">truncated</span>
            ) : null}
          </div>
          <ToolPreviewText text={presentation.preview.text} outputKind={presentation.outputKind} />
        </div>
      ) : null}
      {presentation.raw.available ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Raw available</Badge>
          <Button type="button" variant="ghost" size="xs">Open inspector</Button>
          {presentation.raw.resourceUri ? (
            <span className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">{presentation.raw.resourceUri}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolEventDetails(props: { readonly entry: TimelineEventEntry }) {
  if (props.entry.toolPresentation) {
    return <ToolResultPresentationDetails entry={props.entry} />;
  }
  const details = asRecord(props.entry.details);
  if (!details) return null;
  const input = asRecord(details.input) ?? details;
  const items: { label: string; value: string }[] = [];
  const status = readString(details.status);
  const result = readString(details.result);
  if (status) items.push({ label: "Status", value: status });
  if (result) items.push({ label: "Result", value: compactDisplayText(result, 180) });
  for (const [key, value] of Object.entries(input)
    .filter(([key]) => key !== "status" && key !== "result" && key !== "toolCallId" && key !== "toolName")
    .slice(0, 4)) {
    const formatted = detailDisplayText(value);
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

function isToolEvent(entry: TimelineEventEntry): boolean {
  return entry.eventKind === "tool_call_started" || entry.eventKind === "tool_call_completed";
}

function eventIcon(entry: TimelineEventEntry) {
  return {
    info: Terminal,
    running: LoaderCircle,
    success: CheckCircle2,
    warning: CircleAlert,
    error: CircleAlert,
  }[entry.tone];
}

function eventBadgeVariant(entry: TimelineEventEntry): "outline" | "secondary" | "destructive" {
  return {
    info: "outline",
    running: "secondary",
    success: "secondary",
    warning: "outline",
    error: "destructive",
  }[entry.tone] as "outline" | "secondary" | "destructive";
}

function InlineToolEventRow(props: { readonly entry: TimelineEventEntry }) {
  const [open, setOpen] = useState(false);
  const Icon = eventIcon(props.entry);
  const summary = eventSummaryText(props.entry);
  const hasDetails = canRenderEventDetails(props.entry);

  return (
    <article data-role="tool" className="mx-auto flex w-full max-w-3xl justify-start px-1">
      <div className="flex min-w-0 max-w-[min(42rem,94%)] flex-1 gap-2">
        <span className="mt-2 h-auto w-px shrink-0 rounded-full bg-border" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-muted/25 px-2.5 py-1.5 text-sm shadow-[0_1px_0_rgba(255,255,255,0.03)]">
            <Icon
              aria-hidden="true"
              className={cn(
                "shrink-0 text-muted-foreground",
                props.entry.tone === "running" ? "animate-spin" : null,
                props.entry.tone === "error" ? "text-destructive" : null,
              )}
            />
            <Badge variant={eventBadgeVariant(props.entry)} className="max-w-[11rem] truncate">
              {props.entry.title}
            </Badge>
            {summary ? (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {summary}
              </span>
            ) : null}
            <time
              dateTime={props.entry.createdAt}
              className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/70 sm:inline"
              title={props.entry.createdAt}
            >
              {new Date(props.entry.createdAt).toLocaleTimeString()}
            </time>
            {hasDetails ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={open ? "Hide details" : "Show details"}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
              >
                {open ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
              </Button>
            ) : null}
          </div>
          {open ? (
            <div className="mt-2 max-w-[min(36rem,100%)] rounded-md border border-border/70 bg-background/80 px-3 pb-3 pt-1">
              <EventDetails entry={props.entry} open={open} />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function TimelineEventRow(props: {
  readonly entry: TimelineEventEntry;
  readonly onApprove?: (sessionId: string) => void;
  readonly onDeny?: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const toneClasses: Record<TimelineEventEntry["tone"], string> = {
    info: "border-border bg-card text-foreground",
    running: "border-border bg-card text-foreground",
    success: "border-border bg-card text-foreground",
    warning: "border-border bg-card text-foreground",
    error: "border-destructive/60 bg-card text-foreground",
  };
  const Icon = eventIcon(props.entry);
  const canResolveApproval = props.entry.eventKind === "approval_requested" && Boolean(props.entry.sessionId);
  const hasDetails = canRenderEventDetails(props.entry);
  const summary = eventSummaryText(props.entry);

  return (
    <article className={`mx-auto w-full max-w-3xl rounded-lg border px-3 py-2 shadow-sm ${toneClasses[props.entry.tone]}`}>
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground" aria-hidden="true">
            <Icon className={props.entry.tone === "running" ? "animate-spin" : ""} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant={eventBadgeVariant(props.entry)} className="max-w-full truncate">
                {props.entry.title}
              </Badge>
              <time dateTime={props.entry.createdAt} className="shrink-0 font-mono text-[10px] text-muted-foreground" title={props.entry.createdAt}>
                {new Date(props.entry.createdAt).toLocaleTimeString()}
              </time>
            </div>
            {summary ? (
              <p className="mt-1 max-w-full truncate text-sm leading-5 text-muted-foreground">{summary}</p>
            ) : null}
          </div>
        </div>
        {hasDetails ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={open ? "Hide details" : "Show details"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
          </Button>
        ) : null}
      </header>
      {canResolveApproval && props.entry.sessionId ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
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

function EmptyTranscript() {
  const phraseRef = useRef<string | null>(null);
  if (phraseRef.current === null) {
    phraseRef.current = operatorEmptyStatePhraseAt(Date.now());
  }
  const phrase = phraseRef.current;

  return (
    <div className="grid min-h-full place-items-center px-4 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg text-foreground" aria-hidden="true">
          <span className="grid gap-1">
            <span className="block h-px w-5 rounded-full bg-current opacity-30" />
            <span className="block h-px w-4 rounded-full bg-current opacity-80" />
            <span className="block h-px w-5 rounded-full bg-current opacity-55" />
            <span className="block h-px w-3 rounded-full bg-current" />
          </span>
        </div>
        <div className="flex flex-col gap-1" aria-live="off">
          <p className="text-2xl font-semibold tracking-normal text-foreground">{phrase}</p>
          <p className="text-sm text-muted-foreground">Kiln</p>
        </div>
      </div>
    </div>
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
          <EmptyTranscript />
        ) : (
          props.entries.map((entry) => (
            entry.type === "message"
              ? <MessageRow key={entry.id} message={entry.message} />
              : isToolEvent(entry)
                ? <InlineToolEventRow key={entry.id} entry={entry} />
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
