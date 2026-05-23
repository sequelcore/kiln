/**
 * @fileoverview Managed-agent cockpit projection adapter for the TUI surface.
 * @module @kilnai/tui
 */

import {
  createOperatorCockpitReadOnlyViewState,
  projectOperatorCockpitReadOnlyView,
  type OperatorCockpitAttachTarget,
  type OperatorCockpitManagedAgentViewItem,
  type OperatorCockpitManagedAgentViewState,
  type OperatorSessionEvent,
} from "@kilnai/gateway-contracts";

const TUI_COCKPIT_ATTACH_TARGET: OperatorCockpitAttachTarget = {
  instanceId: "local-tui",
  label: "Local TUI",
  kind: "local",
  gatewayUrl: "http://localhost",
};

export const EMPTY_TUI_MANAGED_AGENT_VIEW_STATE: OperatorCockpitManagedAgentViewState = {
  items: [],
  activeCount: 0,
  attentionCount: 0,
};

export function appendManagedAgentSessionEvent(
  events: readonly OperatorSessionEvent[],
  event: OperatorSessionEvent,
): readonly OperatorSessionEvent[] {
  const normalized = normalizeManagedAgentSessionEvent(event);
  if (!normalized) {
    return events;
  }
  if (events.some((candidate) => candidate.eventId === normalized.eventId)) {
    return events;
  }
  return [...events, normalized].sort(compareSessionEvents);
}

export function projectTuiManagedAgentViewState(
  events: readonly OperatorSessionEvent[],
): OperatorCockpitManagedAgentViewState {
  if (events.length === 0) {
    return EMPTY_TUI_MANAGED_AGENT_VIEW_STATE;
  }

  const projection = projectOperatorCockpitReadOnlyView({
    projectedAt: new Date().toISOString(),
    attachTargets: [TUI_COCKPIT_ATTACH_TARGET],
    events,
  });
  return createOperatorCockpitReadOnlyViewState({
    projection,
    viewState: {},
  }).managedAgents;
}

export function formatManagedAgentCockpitLines(
  viewState: OperatorCockpitManagedAgentViewState,
): readonly string[] {
  if (viewState.items.length === 0) {
    return ["(none)"];
  }

  return [
    `attention: ${viewState.attentionCount}  active: ${viewState.activeCount}`,
    ...viewState.items.slice(0, 5).flatMap(formatManagedAgentItemLines),
  ];
}

function normalizeManagedAgentSessionEvent(event: OperatorSessionEvent): OperatorSessionEvent | null {
  if (!event.kind.startsWith("agent_invocation_")) {
    return null;
  }

  const payload = asRecord(event.payload);
  const managedInvocationId = readString(payload.managedInvocationId) ?? readString(payload.invocationId);
  if (!managedInvocationId) {
    return null;
  }

  return {
    ...event,
    payload: {
      ...payload,
      instanceId: readString(payload.instanceId) ?? TUI_COCKPIT_ATTACH_TARGET.instanceId,
      sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
      managedInvocationId,
    },
  };
}

function formatManagedAgentItemLines(item: OperatorCockpitManagedAgentViewItem): readonly string[] {
  const prefix = item.attentionState === "needs_review" || item.attentionState === "failed"
    ? "!"
    : item.attentionState === "active"
      ? ">"
      : "-";
  const route = item.providerRoute ? ` ${item.providerRoute}` : "";
  const dirty = item.dirtyWorkspaceReviewRequired ? " dirty" : "";
  const resources = item.resourceUris.length > 0 ? ` resources:${item.resourceUris.length}` : "";
  const cancel = item.cancelControl.status === "requires-control-channel" ? " cancel:control" : "";
  const lines = [
    `${prefix} ${item.managedInvocationId} ${item.attentionState} ${item.status}${route}${dirty} events:${item.lifecycleTimeline.length}${resources}${cancel}`,
  ];
  if (item.transcriptUri) {
    lines.push(`  tx ${item.transcriptUri}`);
  }
  for (const uri of item.resourceUris.slice(0, 2)) {
    lines.push(`  res ${uri}`);
  }
  return lines;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function compareSessionEvents(a: OperatorSessionEvent, b: OperatorSessionEvent): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  const timestampCompare = a.timestamp.localeCompare(b.timestamp);
  return timestampCompare === 0 ? a.eventId.localeCompare(b.eventId) : timestampCompare;
}
