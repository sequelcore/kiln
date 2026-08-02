import type {
  OperatorCockpitManagedAgentAttentionState,
  OperatorCockpitManagedAgentViewItem,
  OperatorCockpitManagedAgentViewState,
  OperatorCockpitTimelineEntry,
  OperatorCockpitActionTarget,
} from "@kilnai/gateway-contracts";
import { useState } from "react";
import { AlertTriangle, Bot, ExternalLink, Send, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ManagedAgentPromptDeliveryMode = "steer" | "queue";

interface ManagedAgentCockpitPanelProps {
  readonly viewState: OperatorCockpitManagedAgentViewState;
  readonly onOpenResource?: (uri: string, target?: OperatorCockpitActionTarget) => void;
  readonly onCancel?: (input: {
    readonly sessionId: string;
    readonly invocationId: string;
    readonly gatewayTargetId?: string;
  }) => void;
  readonly onPrompt?: (input: {
    readonly sessionId: string;
    readonly invocationId: string;
    readonly gatewayTargetId?: string;
    readonly prompt: string;
    readonly deliveryMode: ManagedAgentPromptDeliveryMode;
    readonly wakeRequested: boolean;
  }) => void;
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
  readonly onOpenResource?: (uri: string, target?: OperatorCockpitActionTarget) => void;
}) {
  const resourceTarget = (uri: string): OperatorCockpitActionTarget => ({
    instanceId: props.item.instanceId,
    sessionId: props.item.sessionId,
    managedInvocationId: props.item.managedInvocationId,
    resourceUri: uri,
    ...(props.item.gatewayTargetId ? { gatewayTargetId: props.item.gatewayTargetId } : {}),
  });
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
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Managed child resources" role="group">
      {resources.map((resource) => (
        <Button
          key={resource.uri}
          type="button"
          variant="outline"
          size="xs"
          disabled={!props.onOpenResource}
          title={resource.uri}
          onClick={() => props.onOpenResource?.(resource.uri, resourceTarget(resource.uri))}
        >
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
          {resource.label}
        </Button>
      ))}
    </div>
  );
}

function ManagedAgentPromptControl(props: {
  readonly item: OperatorCockpitManagedAgentViewItem;
  readonly onPrompt?: ManagedAgentCockpitPanelProps["onPrompt"];
}) {
  const [prompt, setPrompt] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<ManagedAgentPromptDeliveryMode>("steer");
  const active = props.item.attentionState === "active";
  const canPrompt = active && props.onPrompt !== undefined;
  if (!canPrompt) {
    return null;
  }
  const trimmedPrompt = prompt.trim();
  const invocationId = props.item.managedInvocationId;
  const sendPrompt = (): void => {
    if (trimmedPrompt.length === 0) {
      return;
    }
    props.onPrompt?.({
      sessionId: props.item.sessionId,
      invocationId,
      ...(props.item.gatewayTargetId ? { gatewayTargetId: props.item.gatewayTargetId } : {}),
      prompt: trimmedPrompt,
      deliveryMode,
      wakeRequested: deliveryMode === "steer",
    });
    setPrompt("");
  };
  return (
    <div className="mt-3 grid gap-2 border-t border-border/70 pt-3">
      <Textarea
        aria-label={`Prompt managed child ${invocationId}`}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        className="min-h-16 resize-none text-sm"
      />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="inline-flex shrink-0 rounded-md border border-border bg-background p-0.5" role="group" aria-label={`Prompt delivery for ${invocationId}`}>
          <Button
            type="button"
            size="xs"
            variant={deliveryMode === "steer" ? "secondary" : "ghost"}
            aria-pressed={deliveryMode === "steer"}
            aria-label={`Steer prompt delivery for ${invocationId}`}
            onClick={() => setDeliveryMode("steer")}
          >
            Steer
          </Button>
          <Button
            type="button"
            size="xs"
            variant={deliveryMode === "queue" ? "secondary" : "ghost"}
            aria-pressed={deliveryMode === "queue"}
            aria-label={`Queue prompt delivery for ${invocationId}`}
            onClick={() => setDeliveryMode("queue")}
          >
            Queue
          </Button>
        </div>
        <Button
          type="button"
          size="xs"
          disabled={trimmedPrompt.length === 0}
          aria-label={`Send prompt to managed child ${invocationId}`}
          onClick={sendPrompt}
        >
          <Send data-icon="inline-start" aria-hidden="true" />
          Send
        </Button>
      </div>
    </div>
  );
}

function ManagedAgentNextAction(props: { readonly item: OperatorCockpitManagedAgentViewItem }) {
  const action = props.item.managedInvocationRecovery ?? props.item.managedInvocationPhaseCompletion;
  if (!action?.nextTool) {
    return null;
  }
  const toolChain = action.thenTool ? `${action.nextTool} -> ${action.thenTool}` : action.nextTool;
  return (
    <section className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p className="font-medium">Next governed action</p>
      <dl className="mt-2 grid gap-1 font-mono text-[10.5px] text-destructive/80 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="sr-only">Tool chain</dt>
          <dd className="truncate">{toolChain}</dd>
        </div>
        {action.workItemId ? (
          <div className="min-w-0">
            <dt className="sr-only">Work item</dt>
            <dd className="truncate">work {action.workItemId}</dd>
          </div>
        ) : null}
        {action.reason ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="sr-only">Reason</dt>
            <dd className="truncate">{action.reason}</dd>
          </div>
        ) : null}
        {action.evidenceToRecord.length > 0 ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="sr-only">Evidence to record</dt>
            <dd className="truncate">evidence {action.evidenceToRecord.join(", ")}</dd>
          </div>
        ) : null}
        {action.requiredToolNames.length > 0 ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="sr-only">Required tools</dt>
            <dd className="truncate">tools {action.requiredToolNames.join(", ")}</dd>
          </div>
        ) : null}
        {action.sourceResourceUris.map((uri) => (
          <div key={uri} className="min-w-0 sm:col-span-2">
            <dt className="sr-only">Source resource</dt>
            <dd className="truncate">source {uri}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ManagedAgentWorktreeConflict(props: { readonly item: OperatorCockpitManagedAgentViewItem }) {
  const conflict = props.item.worktreeConflict;
  if (!props.item.worktreeConflictBlocked || !conflict) {
    return null;
  }
  return (
    <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p className="font-medium">Worktree conflict</p>
      <dl className="mt-2 grid gap-1 font-mono text-[10.5px] text-destructive/80 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="sr-only">Status</dt>
          <dd className="truncate">status {conflict.status}</dd>
        </div>
        <div className="min-w-0">
          <dt className="sr-only">Reason</dt>
          <dd className="truncate">{conflict.reason}</dd>
        </div>
        <div className="min-w-0">
          <dt className="sr-only">Requested invocation</dt>
          <dd className="truncate">requested {conflict.requestedInvocationId}</dd>
        </div>
        <div className="min-w-0">
          <dt className="sr-only">Conflicting invocation</dt>
          <dd className="truncate">conflicting {conflict.conflictingInvocationId}</dd>
        </div>
        {conflict.retryAfterInvocationIds.length > 0 ? (
          <div className="min-w-0">
            <dt className="sr-only">Retry after</dt>
            <dd className="truncate">retry after {conflict.retryAfterInvocationIds.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function ManagedAgentExternalRuntimeEvidence(props: { readonly item: OperatorCockpitManagedAgentViewItem }) {
  const attachment = props.item.externalRuntimeAttachment;
  const failures = props.item.externalToolFailures ?? [];
  if (!attachment && failures.length === 0) {
    return null;
  }
  return (
    <section className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p className="font-medium">External runtime evidence</p>
      {attachment ? (
        <p className="mt-1 font-mono text-[10.5px] text-destructive/80">
          {attachment.runtimeId} / {attachment.attachmentId}
        </p>
      ) : null}
      {failures.map((failure) => (
        <p key={`${failure.selector}:${failure.category}`} className="mt-1 text-xs leading-5 text-destructive/80">
          {failure.selector}: {failure.diagnostic}
        </p>
      ))}
    </section>
  );
}

function ManagedAgentItem(props: {
  readonly item: OperatorCockpitManagedAgentViewItem;
  readonly onOpenResource?: ManagedAgentCockpitPanelProps["onOpenResource"];
  readonly onCancel?: ManagedAgentCockpitPanelProps["onCancel"];
  readonly onPrompt?: ManagedAgentCockpitPanelProps["onPrompt"];
}) {
  const item = props.item;
  const needsReview = item.attentionState === "needs_review";
  const terminalFailure = item.attentionState === "failed" || item.attentionState === "timed_out" || item.attentionState === "stale";
  const active = item.attentionState === "active";
  const canCancel = item.cancelControl.status === "requires-control-channel" && props.onCancel !== undefined;
  const timeoutLabel = item.timeoutMs !== undefined
    ? `${item.timeoutMs}ms${item.timeoutSource ? ` ${item.timeoutSource}` : ""}`
    : undefined;
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
            {item.routeSource ? (
              <div className="min-w-0">
                <dt className="sr-only">Route source</dt>
                <dd className="truncate">route source {item.routeSource}</dd>
              </div>
            ) : null}
            {item.parentTurnId ? (
              <div className="min-w-0">
                <dt className="sr-only">Parent turn</dt>
                <dd className="truncate">parent turn {item.parentTurnId}</dd>
              </div>
            ) : null}
            {item.childSessionId ? (
              <div className="min-w-0">
                <dt className="sr-only">Child session</dt>
                <dd className="truncate">child session {item.childSessionId}</dd>
              </div>
            ) : null}
            {item.childTurnId ? (
              <div className="min-w-0">
                <dt className="sr-only">Child turn</dt>
                <dd className="truncate">child turn {item.childTurnId}</dd>
              </div>
            ) : null}
            {timeoutLabel ? (
              <div className="min-w-0">
                <dt className="sr-only">Timeout</dt>
                <dd className="truncate">timeout {timeoutLabel}</dd>
              </div>
            ) : null}
            {item.accountLease ? (
              <>
                <div className="min-w-0">
                  <dt className="sr-only">Account</dt>
                  <dd className="truncate">account {item.accountLease.accountRef}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="sr-only">Account lease</dt>
                  <dd className="truncate">account lease {item.accountLease.lifecycleState}</dd>
                </div>
              </>
            ) : null}
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
          ...(item.gatewayTargetId ? { gatewayTargetId: item.gatewayTargetId } : {}),
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
      <ManagedAgentExternalRuntimeEvidence item={item} />
      <ManagedAgentWorktreeConflict item={item} />
      <ManagedAgentNextAction item={item} />
      <ManagedAgentResources item={item} onOpenResource={props.onOpenResource} />
      <ManagedAgentPromptControl item={item} onPrompt={props.onPrompt} />
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
                onPrompt={props.onPrompt}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
