import type { ReactElement } from "react";
import type {
  NativeCockpitReadOnlyViewState,
} from "../shared/native-cockpit-contract";
import type {
  OperatorCockpitManagedAgentAttentionState,
  OperatorCockpitManagedAgentDrilldownViewState,
  OperatorCockpitManagedAgentViewItem,
} from "@kilnai/gateway-contracts";

export interface ManagedAgentCockpitPanelProps {
  readonly cockpit: NativeCockpitReadOnlyViewState;
  readonly onCancel?: (input: {
    readonly sessionId: string;
    readonly invocationId: string;
    readonly gatewayTargetId?: string;
  }) => void;
  readonly selectedManagedInvocationId?: string;
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

function ManagedAgentNextAction({
  item,
}: {
  readonly item: OperatorCockpitManagedAgentViewItem;
}): ReactElement | null {
  const action = item.managedInvocationRecovery ?? item.managedInvocationPhaseCompletion;
  if (!action?.nextTool) {
    return null;
  }
  const toolChain = action.thenTool ? `${action.nextTool} -> ${action.thenTool}` : action.nextTool;
  return (
    <section className="managed-agent-next-action" aria-label={`${item.managedInvocationId} next governed action`}>
      <h3>Next governed action</h3>
      <dl className="managed-agent-details">
        <div>
          <dt>Tools</dt>
          <dd>{toolChain}</dd>
        </div>
        {action.workItemId ? (
          <div>
            <dt>Work</dt>
            <dd>work {action.workItemId}</dd>
          </div>
        ) : null}
        {action.reason ? (
          <div>
            <dt>Reason</dt>
            <dd>{action.reason}</dd>
          </div>
        ) : null}
        {action.evidenceToRecord.length > 0 ? (
          <div>
            <dt>Evidence</dt>
            <dd>evidence {action.evidenceToRecord.join(", ")}</dd>
          </div>
        ) : null}
        {action.requiredToolNames.length > 0 ? (
          <div>
            <dt>Required Tools</dt>
            <dd>tools {action.requiredToolNames.join(", ")}</dd>
          </div>
        ) : null}
        {action.sourceResourceUris.map((uri) => (
          <div key={uri}>
            <dt>Source</dt>
            <dd>source {uri}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ManagedAgentCockpitPanel({
  cockpit,
  onCancel,
  selectedManagedInvocationId,
}: ManagedAgentCockpitPanelProps): ReactElement {
  const managedAgents = cockpit.view.managedAgents;
  const drilldown = resolveSelectedDrilldown(managedAgents.drilldown, selectedManagedInvocationId);
  return (
    <section className="native-panel managed-agent-panel" aria-label="Managed agent cockpit">
      <div className="panel-heading-row">
        <div>
          <p className="eyebrow">Operator Cockpit</p>
          <h2>Managed Agents</h2>
        </div>
        <dl className="summary-pills" aria-label="Managed agent summary">
          <div>
            <dt>Attention</dt>
            <dd>{managedAgents.attentionCount}</dd>
          </div>
          <div>
            <dt>Active</dt>
            <dd>{managedAgents.activeCount}</dd>
          </div>
        </dl>
      </div>

      {managedAgents.items.length === 0 ? (
        <p className="empty-state">No managed child invocations are visible.</p>
      ) : (
        <ol className="managed-agent-list">
          {managedAgents.items.map((item) => (
            <li key={`${item.instanceId}:${item.sessionId}:${item.managedInvocationId}`}>
              <header>
                <div>
                  <strong>{item.managedInvocationId}</strong>
                  <span>{item.providerRoute ?? "unrouted"}</span>
                </div>
                <mark data-attention={item.attentionState}>{ATTENTION_LABELS[item.attentionState]}</mark>
              </header>
              <dl className="managed-agent-details">
                <div>
                  <dt>Status</dt>
                  <dd>{item.status}</dd>
                </div>
                <div>
                  <dt>Lifecycle</dt>
                  <dd>{item.lifecycleState ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Route source</dt>
                  <dd>{item.routeSource ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Attachment</dt>
                  <dd>{item.externalRuntimeAttachment
                    ? `${item.externalRuntimeAttachment.runtimeId}/${item.externalRuntimeAttachment.attachmentId}`
                    : "not attached"}</dd>
                </div>
                <div>
                  <dt>Parent turn</dt>
                  <dd>{item.parentTurnId ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Child session</dt>
                  <dd>{item.childSessionId ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Child turn</dt>
                  <dd>{item.childTurnId ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Timeout</dt>
                  <dd>{item.timeoutMs !== undefined ? `${item.timeoutMs}ms ${item.timeoutSource ?? "unknown"}` : "unknown"}</dd>
                </div>
                <div>
                  <dt>Review</dt>
                  <dd>{item.worktreeConflictBlocked ? "worktree conflict" : item.dirtyWorkspaceReviewRequired ? "dirty worktree" : "clear"}</dd>
                </div>
                <div>
                  <dt>Adoption</dt>
                  <dd>{item.adoptionGate?.status ?? "not visible"}</dd>
                </div>
                <div>
                  <dt>Cancel</dt>
                  <dd>{item.cancelControl.status}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{item.accountLease?.accountRef ?? "not leased"}</dd>
                </div>
                <div>
                  <dt>Account lease</dt>
                  <dd>{item.accountLease
                    ? `${item.accountLease.lifecycleState} / ${item.accountLease.selectionReason}`
                    : "not applicable"}</dd>
                </div>
              </dl>
              {(item.externalToolFailures ?? []).map((failure) => (
                <p className="resource-line" key={`${failure.selector}:${failure.category}`}>
                  <span>External failure</span>
                  <code>{failure.selector}: {failure.diagnostic}</code>
                </p>
              ))}
              {item.transcriptUri ? (
                <p className="resource-line">
                  <span>Transcript</span>
                  <code>{item.transcriptUri}</code>
                </p>
              ) : null}
              {item.resourceUris.length > 0 ? (
                <ul className="resource-list" aria-label={`${item.managedInvocationId} resources`}>
                  {item.resourceUris.slice(0, 4).map((uri) => (
                    <li key={uri}>
                      <code>{uri}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.cancelControl.status === "requires-control-channel" && onCancel ? (
                <button
                  type="button"
                  title={item.cancelControl.reason}
                        onClick={() => onCancel({
                          sessionId: item.sessionId,
                          invocationId: item.managedInvocationId,
                          ...(item.gatewayTargetId ? { gatewayTargetId: item.gatewayTargetId } : {}),
                        })}
                >
                  Cancel
                </button>
              ) : (
                <button type="button" disabled title={item.cancelControl.reason}>
                  Cancel disabled
                </button>
              )}
              {item.worktreeConflictBlocked && item.worktreeConflict ? (
                <section className="worktree-conflict" aria-label={`${item.managedInvocationId} worktree conflict`}>
                  <h3>Worktree conflict</h3>
                  <dl className="managed-agent-details">
                    <div>
                      <dt>Status</dt>
                      <dd>status {item.worktreeConflict.status}</dd>
                    </div>
                    <div>
                      <dt>Reason</dt>
                      <dd>{item.worktreeConflict.reason}</dd>
                    </div>
                    <div>
                      <dt>Requested</dt>
                      <dd>requested {item.worktreeConflict.requestedInvocationId}</dd>
                    </div>
                    <div>
                      <dt>Conflicting</dt>
                      <dd>conflicting {item.worktreeConflict.conflictingInvocationId}</dd>
                    </div>
                    {item.worktreeConflict.retryAfterInvocationIds.length > 0 ? (
                      <div>
                        <dt>Retry After</dt>
                        <dd>retry after {item.worktreeConflict.retryAfterInvocationIds.join(", ")}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              ) : null}
              <ManagedAgentNextAction item={item} />
              <ol className="timeline-list" aria-label={`${item.managedInvocationId} lifecycle timeline`}>
                {item.lifecycleTimeline.slice(-4).map((entry) => (
                  <li key={entry.eventId}>
                    <span>{entry.kind}</span>
                    <small>{entry.compactText}</small>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {drilldown ? <ManagedAgentDrilldownPanel drilldown={drilldown} /> : null}
    </section>
  );
}

function resolveSelectedDrilldown(
  drilldown: OperatorCockpitManagedAgentDrilldownViewState | undefined,
  selectedManagedInvocationId: string | undefined,
): OperatorCockpitManagedAgentDrilldownViewState | undefined {
  if (!drilldown) {
    return undefined;
  }
  if (!drilldown.resolved || !selectedManagedInvocationId) {
    return drilldown;
  }
  return drilldown.item.managedInvocationId === selectedManagedInvocationId ? drilldown : undefined;
}

function ManagedAgentDrilldownPanel({
  drilldown,
}: {
  readonly drilldown: OperatorCockpitManagedAgentDrilldownViewState;
}): ReactElement {
  if (!drilldown.resolved) {
    return (
      <section className="managed-agent-detail" aria-label="Managed agent detail">
        <h3>Managed Agent Detail</h3>
        <p>Detail unavailable: {drilldown.reason}</p>
      </section>
    );
  }
  return <ResolvedManagedAgentDrilldown item={drilldown.item} drilldown={drilldown} />;
}

function ResolvedManagedAgentDrilldown({
  item,
  drilldown,
}: {
  readonly item: OperatorCockpitManagedAgentViewItem;
  readonly drilldown: Extract<OperatorCockpitManagedAgentDrilldownViewState, { readonly resolved: true }>;
}): ReactElement {
  return (
    <section className="managed-agent-detail" aria-label="Managed agent detail">
      <header>
        <h3>Managed Agent Detail</h3>
        <strong>{item.managedInvocationId}</strong>
      </header>
      <dl className="managed-agent-details">
        <div>
          <dt>Lifecycle</dt>
          <dd>{item.lifecycleState ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Latest</dt>
          <dd>{item.latestEventId}</dd>
        </div>
        <div>
          <dt>Replay</dt>
          <dd>{drilldown.replay.entry.eventId}</dd>
        </div>
        <div>
          <dt>Previous</dt>
          <dd>{drilldown.replay.previousEventId ?? "--"}</dd>
        </div>
        <div>
          <dt>Next</dt>
          <dd>{drilldown.replay.nextEventId ?? "--"}</dd>
        </div>
        <div>
          <dt>Adoption</dt>
          <dd>{item.adoptionGate?.status ?? "not visible"}</dd>
        </div>
        {item.adoptionGate?.adoptedBy ? (
          <div>
            <dt>Adopted By</dt>
            <dd>{item.adoptionGate.adoptedBy}</dd>
          </div>
        ) : null}
        {item.adoptionGate?.adoptedAt ? (
          <div>
            <dt>Adopted At</dt>
            <dd>{item.adoptionGate.adoptedAt}</dd>
          </div>
        ) : null}
        {item.adoptionGate?.blockingEvidence.length ? (
          <div>
            <dt>Blocking Evidence</dt>
            <dd>{item.adoptionGate.blockingEvidence.join(", ")}</dd>
          </div>
        ) : null}
        {item.adoptionGate?.rejection ? (
          <div>
            <dt>Rejection</dt>
            <dd>{[
              item.adoptionGate.rejection.gate,
              item.adoptionGate.rejection.summary,
              ...item.adoptionGate.rejection.evidence,
            ].filter(Boolean).join(" · ")}</dd>
          </div>
        ) : null}
      </dl>
      <ol className="timeline-list" aria-label={`${item.managedInvocationId} full lifecycle timeline`}>
        {item.lifecycleTimeline.map((entry) => (
          <li key={entry.eventId}>
            <span>{entry.kind}</span>
            <small>{entry.eventId}</small>
            <small>{entry.compactText}</small>
          </li>
        ))}
      </ol>
      {item.resourceUris.length > 0 ? (
        <ul className="resource-list" aria-label={`${item.managedInvocationId} full resources`}>
          {item.resourceUris.map((uri) => (
            <li key={uri}>
              <code>{uri}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
