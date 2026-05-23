import type { ReactElement } from "react";
import type {
  NativeCockpitReadOnlyViewState,
} from "../shared/native-cockpit-contract";

export interface ManagedAgentCockpitPanelProps {
  readonly cockpit: NativeCockpitReadOnlyViewState;
  readonly onCancel?: (input: { readonly sessionId: string; readonly invocationId: string }) => void;
}

export function ManagedAgentCockpitPanel({
  cockpit,
  onCancel,
}: ManagedAgentCockpitPanelProps): ReactElement {
  const managedAgents = cockpit.view.managedAgents;
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
                <mark data-attention={item.attentionState}>{item.attentionState}</mark>
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
                  <dt>Review</dt>
                  <dd>{item.dirtyWorkspaceReviewRequired ? "dirty worktree" : "clear"}</dd>
                </div>
                <div>
                  <dt>Cancel</dt>
                  <dd>{item.cancelControl.status}</dd>
                </div>
              </dl>
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
                  })}
                >
                  Cancel
                </button>
              ) : (
                <button type="button" disabled title={item.cancelControl.reason}>
                  Cancel disabled
                </button>
              )}
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
    </section>
  );
}
