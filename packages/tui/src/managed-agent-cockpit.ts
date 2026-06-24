/**
 * @fileoverview Managed-agent cockpit projection adapter for the TUI surface.
 * @module @kilnai/tui
 */

import {
  createOperatorCockpitReadOnlyViewState,
  projectOperatorCockpitReadOnlyView,
  type OperatorCockpitAttachTarget,
  type OperatorCockpitManagedAgentDrilldownTarget,
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

export interface TuiManagedAgentProjectionOptions {
  readonly drilldownTarget?: OperatorCockpitManagedAgentDrilldownTarget;
}

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

export function selectTuiManagedAgentDrilldownTarget(
  events: readonly OperatorSessionEvent[],
): OperatorCockpitManagedAgentDrilldownTarget | undefined {
  const event = [...events].sort(compareSessionEvents).findLast((candidate) => {
    const payload = asRecord(candidate.payload);
    return Boolean(readManagedInvocationId(payload));
  });
  if (!event) {
    return undefined;
  }
  const payload = asRecord(event.payload);
  const managedInvocationId = readManagedInvocationId(payload);
  if (!managedInvocationId) {
    return undefined;
  }
  return {
    instanceId: readString(payload.instanceId) ?? TUI_COCKPIT_ATTACH_TARGET.instanceId,
    sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
    managedInvocationId,
    replayEventId: event.eventId,
  };
}

export function projectTuiManagedAgentViewState(
  events: readonly OperatorSessionEvent[],
  options: TuiManagedAgentProjectionOptions = {},
): OperatorCockpitManagedAgentViewState {
  if (events.length === 0) {
    return {
      ...EMPTY_TUI_MANAGED_AGENT_VIEW_STATE,
      ...(options.drilldownTarget
        ? { drilldown: { resolved: false, reason: "managed-invocation-not-found" } as const }
        : {}),
    };
  }

  const projection = projectOperatorCockpitReadOnlyView({
    projectedAt: new Date().toISOString(),
    attachTargets: [TUI_COCKPIT_ATTACH_TARGET],
    events,
  });
  return createOperatorCockpitReadOnlyViewState({
    projection,
    viewState: {
      ...(options.drilldownTarget ? { managedAgentDrilldownTarget: options.drilldownTarget } : {}),
    },
  }).managedAgents;
}

export function formatManagedAgentCockpitLines(
  viewState: OperatorCockpitManagedAgentViewState,
): readonly string[] {
  if (viewState.items.length === 0) {
    return viewState.drilldown
      ? ["(none)", ...formatManagedAgentDrilldownLines(viewState.drilldown)]
      : ["(none)"];
  }

  return [
    `attention: ${viewState.attentionCount}  active: ${viewState.activeCount}`,
    ...viewState.items.slice(0, 5).flatMap(formatManagedAgentItemLines),
    ...(viewState.drilldown ? formatManagedAgentDrilldownLines(viewState.drilldown) : []),
  ];
}

function normalizeManagedAgentSessionEvent(event: OperatorSessionEvent): OperatorSessionEvent | null {
  const payload = asRecord(event.payload);
  if (event.kind.startsWith("work_item_") && hasManagedOrchestrationAdoptionGate(payload)) {
    const instanceId = readString(payload.instanceId);
    const sessionId = readString(payload.sessionId);
    if (instanceId !== TUI_COCKPIT_ATTACH_TARGET.instanceId || sessionId !== event.kilnSessionId) {
      return null;
    }
    return {
      ...event,
      payload: {
        ...payload,
        instanceId,
        sessionId,
      },
    };
  }

  if (!event.kind.startsWith("agent_invocation_")) {
    return null;
  }

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
  const prefix = item.attentionState === "needs_review"
    || item.attentionState === "timed_out"
    || item.attentionState === "stale"
    || item.attentionState === "failed"
    ? "!"
    : item.attentionState === "active"
      ? ">"
      : "-";
  const route = item.providerRoute ? ` ${item.providerRoute}` : "";
  const dirty = item.dirtyWorkspaceReviewRequired ? " dirty" : "";
  const conflict = item.worktreeConflictBlocked && item.worktreeConflict ? ` conflict:${item.worktreeConflict.status}` : "";
  const adoption = item.adoptionGate ? ` adoption:${item.adoptionGate.status}` : "";
  const resources = item.resourceUris.length > 0 ? ` resources:${item.resourceUris.length}` : "";
  const cancel = item.cancelControl.status === "requires-control-channel" ? " cancel:control" : "";
  const lines = [
    `${prefix} ${item.managedInvocationId} ${item.attentionState} ${item.status}${route}${dirty}${conflict} events:${item.lifecycleTimeline.length}${adoption}${resources}${cancel}`,
  ];
  if (item.parentTurnId || item.childSessionId || item.childTurnId) {
    lines.push(`  lineage parent:${item.parentTurnId ?? "--"} child-session:${item.childSessionId ?? "--"} child-turn:${item.childTurnId ?? "--"}`);
  }
  if (item.routeSource || item.timeoutMs !== undefined || item.timeoutSource) {
    lines.push(`  route-source ${item.routeSource ?? "--"} timeout ${item.timeoutMs !== undefined ? `${item.timeoutMs}ms` : "--"} source:${item.timeoutSource ?? "--"}`);
  }
  if (item.transcriptUri) {
    lines.push(`  tx ${item.transcriptUri}`);
  }
  lines.push(...formatManagedAgentWorktreeConflictLines(item));
  lines.push(...formatManagedAgentNextActionLines(item));
  for (const uri of formatManagedAgentGenericResourceUris(item).slice(0, 2)) {
    lines.push(`  res ${uri}`);
  }
  return lines;
}

function formatManagedAgentDrilldownLines(
  drilldown: NonNullable<OperatorCockpitManagedAgentViewState["drilldown"]>,
): readonly string[] {
  if (!drilldown.resolved) {
    return [`drilldown unresolved ${drilldown.reason}`];
  }
  const item = drilldown.item;
  return [
    `drilldown ${item.managedInvocationId}`,
    `  lifecycle ${item.lifecycleState ?? "unknown"}`,
    `  latest ${item.latestEventId}`,
    `  replay ${drilldown.replay.entry.eventId}`,
    `  prev ${drilldown.replay.previousEventId ?? "--"} next ${drilldown.replay.nextEventId ?? "--"}`,
    ...formatManagedAgentWorktreeConflictLines(item),
    ...formatManagedAgentNextActionLines(item),
    ...formatManagedAgentAdoptionGateLines(item),
    "  timeline:",
    ...item.lifecycleTimeline.map((entry) => (
      `    ${entry.sequence} ${entry.kind} ${entry.eventId}`
    )),
    ...(item.resourceUris.length > 0
      ? [
        "  resources:",
        ...item.resourceUris.map((uri) => `    ${uri}`),
      ]
      : ["  resources: none"]),
  ];
}

function formatManagedAgentWorktreeConflictLines(item: OperatorCockpitManagedAgentViewItem): readonly string[] {
  const conflict = item.worktreeConflict;
  if (!conflict || !item.worktreeConflictBlocked) {
    return [];
  }
  return [
    `  conflict ${conflict.reason} requested:${conflict.requestedInvocationId} conflicting:${conflict.conflictingInvocationId}`,
    ...(conflict.retryAfterInvocationIds.length > 0
      ? [`  retry-after ${conflict.retryAfterInvocationIds.join(",")}`]
      : []),
    ...conflict.resourceUris.map((uri) => `  conflict-res ${uri}`),
    ...conflict.diagnosticUris.map((uri) => `  conflict-diag ${uri}`),
  ];
}

function formatManagedAgentGenericResourceUris(item: OperatorCockpitManagedAgentViewItem): readonly string[] {
  const conflict = item.worktreeConflict;
  if (!conflict || !item.worktreeConflictBlocked) {
    return item.resourceUris;
  }
  const conflictUris = new Set([
    ...conflict.resourceUris,
    ...conflict.diagnosticUris,
  ]);
  return item.resourceUris.filter((uri) => !conflictUris.has(uri));
}

function formatManagedAgentNextActionLines(item: OperatorCockpitManagedAgentViewItem): readonly string[] {
  const action = item.managedInvocationRecovery ?? item.managedInvocationPhaseCompletion;
  if (!action?.nextTool) {
    return [];
  }
  const toolChain = action.thenTool ? `${action.nextTool} -> ${action.thenTool}` : action.nextTool;
  return [
    `  next ${toolChain}${action.workItemId ? ` work:${action.workItemId}` : ""}`,
    ...(action.reason ? [`  reason ${action.reason}`] : []),
    ...(action.evidenceToRecord.length > 0 ? [`  evidence ${action.evidenceToRecord.join(",")}`] : []),
    ...(action.requiredToolNames.length > 0 ? [`  tools ${action.requiredToolNames.join(",")}`] : []),
    ...action.sourceResourceUris.map((uri) => `  source ${uri}`),
  ];
}

function formatManagedAgentAdoptionGateLines(item: OperatorCockpitManagedAgentViewItem): readonly string[] {
  const adoptionGate = item.adoptionGate;
  if (!adoptionGate) {
    return [];
  }
  return [
    `  adoption ${adoptionGate.status}`,
    ...(adoptionGate.adoptedBy && adoptionGate.adoptedAt
      ? [`  adopted by ${adoptionGate.adoptedBy} at ${adoptionGate.adoptedAt}`]
      : []),
    ...(adoptionGate.rejection
      ? [
        `  rejection ${adoptionGate.rejection.gate}`,
        ...(adoptionGate.rejection.summary ? [`  rejection summary ${adoptionGate.rejection.summary}`] : []),
        ...adoptionGate.rejection.evidence.map((uri) => `  rejection evidence ${uri}`),
      ]
      : []),
    ...adoptionGate.blockingEvidence.map((evidence) => `  blocking ${evidence}`),
    ...(adoptionGate.resourceUris.length > 0
      ? [
        "  adoption resources:",
        ...adoptionGate.resourceUris.map((uri) => `    ${uri}`),
      ]
      : []),
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readManagedInvocationId(payload: Record<string, unknown>): string | null {
  const attempt = asRecord(payload.attempt);
  const workItem = asRecord(payload.workItem);
  const adoptionGate = asRecord(payload.managedOrchestrationAdoptionGate);
  return readString(payload.managedInvocationId)
    ?? readString(payload.invocationId)
    ?? readString(payload.latestManagedInvocationId)
    ?? readString(attempt.managedInvocationId)
    ?? readString(workItem.latestManagedInvocationId)
    ?? readString(adoptionGate.childId);
}

function hasManagedOrchestrationAdoptionGate(payload: Record<string, unknown>): boolean {
  return typeof payload.managedOrchestrationAdoptionGate === "object"
    && payload.managedOrchestrationAdoptionGate !== null
    && !Array.isArray(payload.managedOrchestrationAdoptionGate);
}

function compareSessionEvents(a: OperatorSessionEvent, b: OperatorSessionEvent): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  const timestampCompare = a.timestamp.localeCompare(b.timestamp);
  return timestampCompare === 0 ? a.eventId.localeCompare(b.eventId) : timestampCompare;
}
