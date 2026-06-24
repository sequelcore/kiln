import type { ReactElement } from "react";
import type { NativeWorkItemSummary } from "./native-gateway-cockpit.js";

interface NativeWorkItemsPanelProps {
  readonly items: readonly NativeWorkItemSummary[];
}

export function NativeWorkItemsPanel(props: NativeWorkItemsPanelProps): ReactElement {
  return (
    <section className="native-panel work-items-panel" aria-label="Work items">
      <h2>Work Items</h2>
      {props.items.length === 0 ? (
        <p className="empty-state">No governed work items observed.</p>
      ) : (
        <ul className="work-item-list">
          {props.items.slice(0, 6).map((item) => (
            <li key={item.id}>
              <header>
                <div>
                  <strong>{item.id}</strong>
                  <span>{item.summary}</span>
                </div>
                <mark>{item.status.replace(/_/g, " ")}</mark>
              </header>
              <dl className="native-grid">
                <div>
                  <dt>Workflow</dt>
                  <dd>{item.workflowProfile}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>{item.providedEvidence.length}/{item.expectedEvidence.length}</dd>
                </div>
                {item.authorityProfile ? (
                  <div>
                    <dt>Authority</dt>
                    <dd>{item.authorityProfile}</dd>
                  </div>
                ) : null}
                {item.assignedAgentProfile ? (
                  <div>
                    <dt>Agent</dt>
                    <dd>{item.assignedAgentProfile}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Resource</dt>
                  <dd>{item.resourceUri}</dd>
                </div>
                <div>
                  <dt>Pause requirements</dt>
                  <dd>{item.pendingPauseRequirementCount}</dd>
                </div>
              </dl>
              {item.missingEvidence.length > 0 ? (
                <p className="work-item-warning">Missing: {item.missingEvidence.join(", ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
