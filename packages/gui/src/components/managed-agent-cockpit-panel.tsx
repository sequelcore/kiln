import type {
  OperatorCockpitManagedAgentAttentionState,
  OperatorCockpitManagedAgentViewItem,
  OperatorCockpitManagedAgentViewState,
  OperatorCockpitTimelineEntry,
} from "@kilnai/gateway-contracts";
import { AlertTriangle, Bot, ExternalLink, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ManagedAgentCockpitPanelProps {
  readonly viewState: OperatorCockpitManagedAgentViewState;
  readonly onOpenResource?: (uri: string) => void;
  readonly onCancel?: (input: { readonly sessionId: string; readonly invocationId: string }) => void;
}

const ATTENTION_LABELS: Record<OperatorCockpitManagedAgentAttentionState, string> = {
  active: "Active",
  needs_review: "Review required",
  timed_out: "Timed out",
  stale: "Stale heartbeat",
  failed: "Failed",
  cancelled: "Cancelled",
  clear: "Clear",
  unknown: "Unknown",
};

function statusVariant(state: OperatorCockpitManagedAgentAttentionState): "default" | "destructive" | "outline" | "secondary" {
  if (state === "failed" || state === "needs_review" || state === "timed_out" || state === "stale") return "destructive";
  if (state === "active") return "secondary";
  return "outline";
}

function resourceLabel(uri: string): string {
  const normalized = uri.split("?")[0] ?? uri;
  const leaf = normalized.split("/").filter(Boolean).at(-1) ?? uri;
  return leaf.replace(/[-_]/g, " ");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function timelineLabel(entry: OperatorCockpitTimelineEntry): string {
  return entry.compactText && entry.compactText !== entry.title ? `${entry.title}: ${entry.compactText}` : entry.title;
}

function ManagedAgentTimeline(props: { readonly entries: readonly OperatorCockpitTimelineEntry[] }) {
  if (props.entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No lifecycle events projected yet.</p>;
  }
  return (
    <ol className="mt-3 grid gap-2" aria-label="Managed child lifecycle">
      {props.entries.slice(-4).map((entry) => (
        <li key={entry.eventId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-xs">
          <span className="mt-1 size-1.5 rounded-full bg-muted-foreground/65" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{timelineLabel(entry)}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
              <span>{entry.eventId}</span>
              <span className="text-muted-foreground/50">/</span>
              <span>{formatTimestamp(entry.timestamp)}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ManagedAgentResources(props: {
  readonly item: OperatorCockpitManagedAgentViewItem;
  readonly onOpenResource?: (uri: string) => void;
}) {
  const resources = [
    ...(props.item.transcriptUri ? [{ uri: props.item.transcriptUri, label: "Transcript" }] : []),
    ...props.item.resourceUris
      .filter((uri) => uri !== props.item.transcriptUri)
      .map((uri) => ({ uri, label: resourceLabel(uri) })),
  ];
  if (resources.length === 0) {
    return <p className="text-xs text-muted-foreground">No transcript or evidence resources attached.</p>;
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Managed child resources">
      {resources.map((resource) => (
        <Button
          key={resource.uri}
          type="button"
          variant="outline"
          size="xs"
          disabled={!props.onOpenResource}
          title={resource.uri}
          onClick={() => props.onOpenResource?.(resource.uri)}
        >
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
          {resource.label}
        </Button>
      ))}
    </div>
  );
}

function ManagedAgentItem(props: {
  readonly item: OperatorCockpitManagedAgentViewItem;
  readonly onOpenResource?: (uri: string) => void;
  readonly onCancel?: (input: { readonly sessionId: string; readonly invocationId: string }) => void;
}) {
  const item = props.item;
  const needsReview = item.attentionState === "needs_review";
  const terminalFailure = item.attentionState === "failed" || item.attentionState === "timed_out" || item.attentionState === "stale";
  const active = item.attentionState === "active";
  const canCancel = item.cancelControl.status === "requires-control-channel" && props.onCancel !== undefined;
  return (
    <article className="rounded-md border border-border/70 bg-card px-4 py-3 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={cn(
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border",
            active ? "border-primary/45 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground",
            (needsReview || terminalFailure) && "border-destructive/45 bg-destructive/10 text-destructive",
          )}
          aria-hidden="true"
        >
          {needsReview || terminalFailure ? <ShieldAlert className="size-4" /> : <Bot className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground">
              {item.managedInvocationId}
            </h3>
            <Badge variant={statusVariant(item.attentionState)}>{ATTENTION_LABELS[item.attentionState]}</Badge>
            <Badge variant="outline">{item.status}</Badge>
          </div>
          <dl className="mt-2 grid gap-1 font-mono text-[10.5px] text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
            <div className="min-w-0">
              <dt className="sr-only">Session</dt>
              <dd className="truncate">session {item.sessionId}</dd>
            </div>
            <div className="min-w-0">
              <dt className="sr-only">Instance</dt>
              <dd className="truncate">instance {item.instanceId}</dd>
            </div>
            <div className="min-w-0">
              <dt className="sr-only">Lifecycle</dt>
              <dd className="truncate">lifecycle {item.lifecycleState ?? "unknown"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="sr-only">Provider</dt>
              <dd className="truncate">route {item.providerRoute ?? "unknown"}</dd>
            </div>
          </dl>
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!canCancel}
          aria-label={canCancel ? `Cancel managed child ${item.managedInvocationId}` : undefined}
          title={item.cancelControl.reason}
          className="shrink-0"
          onClick={() => props.onCancel?.({
            sessionId: item.sessionId,
            invocationId: item.managedInvocationId,
          })}
        >
          <AlertTriangle data-icon="inline-start" aria-hidden="true" />
          {canCancel ? "Cancel" : item.cancelControl.status === "requires-control-channel" ? "Cancel requires control channel" : "Cancel unavailable"}
        </Button>
      </div>
      {item.dirtyWorkspaceReviewRequired ? (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">Dirty worktree preserved</p>
          <p className="mt-1 text-xs leading-5 text-destructive/80">
            Review required before cleanup, adoption, or merge decisions.
          </p>
        </div>
      ) : null}
      <ManagedAgentResources item={item} onOpenResource={props.onOpenResource} />
      <ManagedAgentTimeline entries={item.lifecycleTimeline} />
    </article>
  );
}

export function ManagedAgentCockpitPanel(props: ManagedAgentCockpitPanelProps) {
  return (
    <section aria-label="Managed agents" className="flex h-full min-h-0 min-w-0 flex-col bg-workspace-viewer">
      <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border/70 bg-card/70 px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">Managed Agents</p>
          <p className="truncate font-mono text-[10.5px] text-muted-foreground">
            {props.viewState.attentionCount} attention / {props.viewState.activeCount} active
          </p>
        </div>
        <Badge variant={props.viewState.attentionCount > 0 ? "secondary" : "outline"}>
          {props.onCancel ? "live control" : "read only"}
        </Badge>
      </header>
      {props.viewState.items.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 py-16 text-center">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">No managed children in the current session</p>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              Child lifecycle events projected through the shared cockpit contract will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3">
            {props.viewState.items.map((item) => (
              <ManagedAgentItem
                key={`${item.instanceId}:${item.sessionId}:${item.managedInvocationId}`}
                item={item}
                onOpenResource={props.onOpenResource}
                onCancel={props.onCancel}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
