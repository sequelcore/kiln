import type {
  OperatorCockpitInvocationProjection,
  OperatorCockpitReadOnlyProjection,
  OperatorCockpitSessionProjection,
  OperatorCockpitTimelineEntry,
} from "./operator-cockpit-projection.js";
import type {
  OperatorEventTone,
} from "./operator-event-presentation.js";
import type {
  OperatorSessionEvent,
} from "./frames.js";

export interface OperatorCockpitFocusTarget {
  readonly instanceId: string;
  readonly sessionId: string;
}

export interface OperatorCockpitTimelineFilters {
  readonly instanceId?: string;
  readonly sessionId?: string;
  readonly kinds?: readonly OperatorSessionEvent["kind"][];
  readonly tones?: readonly OperatorEventTone[];
  readonly managedInvocationId?: string;
  readonly toolCallId?: string;
  readonly resourceUri?: string;
}

export interface OperatorCockpitReplayCursorTarget {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly eventId: string;
}

export interface OperatorCockpitManagedAgentDrilldownTarget {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly managedInvocationId: string;
  readonly replayEventId?: string;
}

export interface OperatorCockpitReadOnlyViewStateInput {
  readonly projection: OperatorCockpitReadOnlyProjection;
  readonly viewState: {
    readonly focusTarget?: OperatorCockpitFocusTarget;
    readonly filters?: OperatorCockpitTimelineFilters;
    readonly replayCursor?: OperatorCockpitReplayCursorTarget;
    readonly managedAgentDrilldownTarget?: OperatorCockpitManagedAgentDrilldownTarget;
  };
}

export interface OperatorCockpitReadOnlyViewState {
  readonly mode: "read-only";
  readonly dispatch: "not-dispatched";
  readonly mutationDispatch: "disabled";
  readonly focus: {
    readonly resolved: boolean;
    readonly target?: OperatorCockpitFocusTarget;
  };
  readonly timeline: {
    readonly valid: boolean;
    readonly entries: readonly OperatorCockpitTimelineEntry[];
  };
  readonly replay: {
    readonly resolved: boolean;
    readonly entry?: OperatorCockpitTimelineEntry;
    readonly previousEventId?: string;
    readonly nextEventId?: string;
  };
  readonly managedAgents: OperatorCockpitManagedAgentViewState;
}

export type OperatorCockpitManagedAgentAttentionState =
  | "active"
  | "needs_review"
  | "failed"
  | "cancelled"
  | "clear"
  | "unknown";

export interface OperatorCockpitManagedAgentCancelControl {
  readonly status: "requires-control-channel" | "unavailable";
  readonly reason: string;
}

export interface OperatorCockpitManagedAgentViewItem {
  readonly managedInvocationId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly status: OperatorCockpitInvocationProjection["status"];
  readonly lifecycleState?: string;
  readonly providerRoute?: string;
  readonly attentionState: OperatorCockpitManagedAgentAttentionState;
  readonly dirtyWorkspaceReviewRequired: boolean;
  readonly adoptionGate?: OperatorCockpitInvocationProjection["adoptionGate"];
  readonly transcriptUri?: string;
  readonly resourceUris: readonly string[];
  readonly latestEventId: string;
  readonly lifecycleTimeline: readonly OperatorCockpitTimelineEntry[];
  readonly cancelControl: OperatorCockpitManagedAgentCancelControl;
}

export interface OperatorCockpitManagedAgentViewState {
  readonly items: readonly OperatorCockpitManagedAgentViewItem[];
  readonly activeCount: number;
  readonly attentionCount: number;
  readonly drilldown?: OperatorCockpitManagedAgentDrilldownViewState;
}

export type OperatorCockpitManagedAgentDrilldownFailureReason =
  | "managed-invocation-not-found"
  | "replay-event-not-found";

export type OperatorCockpitManagedAgentDrilldownViewState =
  | {
    readonly resolved: true;
    readonly item: OperatorCockpitManagedAgentViewItem;
    readonly replay: {
      readonly resolved: true;
      readonly entry: OperatorCockpitTimelineEntry;
      readonly previousEventId?: string;
      readonly nextEventId?: string;
    };
  }
  | {
    readonly resolved: false;
    readonly reason: OperatorCockpitManagedAgentDrilldownFailureReason;
  };

export function createOperatorCockpitReadOnlyViewState(
  input: OperatorCockpitReadOnlyViewStateInput,
): OperatorCockpitReadOnlyViewState {
  const focusResolved = resolveFocus(input.projection, input.viewState.focusTarget);
  const timeline = resolveFilteredTimeline(input.projection, input.viewState.filters);
  const replay = resolveReplay(input.projection, {
    replayCursor: input.viewState.replayCursor,
    focusResolved,
    filteredTimeline: timeline,
  });

  return {
    mode: "read-only",
    dispatch: "not-dispatched",
    mutationDispatch: "disabled",
    focus: {
      resolved: focusResolved !== null,
      ...(focusResolved ? { target: focusResolved } : {}),
    },
    timeline,
    replay,
    managedAgents: createManagedAgentViewState(
      input.projection,
      input.viewState.managedAgentDrilldownTarget,
    ),
  };
}

function createManagedAgentViewState(
  projection: OperatorCockpitReadOnlyProjection,
  drilldownTarget?: OperatorCockpitManagedAgentDrilldownTarget,
): OperatorCockpitManagedAgentViewState {
  const items = projection.invocations
    .map((invocation) => projectManagedAgentItem(projection, invocation))
    .sort(compareManagedAgentItems);
  return {
    items,
    activeCount: items.filter((item) => item.attentionState === "active").length,
    attentionCount: items.filter((item) => item.attentionState !== "clear").length,
    ...(drilldownTarget ? { drilldown: resolveManagedAgentDrilldown(items, drilldownTarget) } : {}),
  };
}

function projectManagedAgentItem(
  projection: OperatorCockpitReadOnlyProjection,
  invocation: OperatorCockpitInvocationProjection,
): OperatorCockpitManagedAgentViewItem {
  const resourceUris = uniqueStrings(invocation.evidenceResourceUris);
  const attentionState = managedAgentAttentionState(invocation);
  return {
    managedInvocationId: invocation.managedInvocationId,
    instanceId: invocation.instanceId,
    sessionId: invocation.sessionId,
    status: invocation.status,
    ...(invocation.lifecycleState !== undefined ? { lifecycleState: invocation.lifecycleState } : {}),
    ...(invocation.providerRoute !== undefined ? { providerRoute: invocation.providerRoute } : {}),
    attentionState,
    dirtyWorkspaceReviewRequired: invocation.resourceLease?.worktreeReview?.status === "required",
    ...(invocation.adoptionGate !== undefined ? { adoptionGate: invocation.adoptionGate } : {}),
    ...(invocation.transcript?.uri ? { transcriptUri: invocation.transcript.uri } : {}),
    resourceUris,
    latestEventId: invocation.latestEventId,
    lifecycleTimeline: projection.timeline.filter((entry) => (
      entry.instanceId === invocation.instanceId
      && entry.sessionId === invocation.sessionId
      && entry.target.managedInvocationId === invocation.managedInvocationId
    )),
    cancelControl: managedAgentCancelControl(invocation),
  };
}

function managedAgentAttentionState(
  invocation: OperatorCockpitInvocationProjection,
): OperatorCockpitManagedAgentAttentionState {
  if (
    invocation.resourceLease?.worktreeReview?.status === "required" ||
    invocation.resourceLease?.healthStatus === "leaked" ||
    invocation.resourceLease?.cleanupStatus === "failed" ||
    (invocation.adoptionGate?.required === true
      && invocation.adoptionGate.status !== "adopted"
      && invocation.adoptionGate.status !== "not_required")
  ) {
    return "needs_review";
  }
  if (invocation.status === "running" || invocation.status === "requested") {
    return "active";
  }
  if (invocation.status === "failed") {
    return "failed";
  }
  if (invocation.status === "cancelled") {
    return "cancelled";
  }
  if (invocation.status === "completed") {
    return "clear";
  }
  return "unknown";
}

function managedAgentCancelControl(
  invocation: OperatorCockpitInvocationProjection,
): OperatorCockpitManagedAgentCancelControl {
  if (invocation.status === "running" || invocation.status === "requested") {
    return {
      status: "requires-control-channel",
      reason: "Read-only cockpit projection cannot dispatch cancellation.",
    };
  }
  return {
    status: "unavailable",
    reason: "Managed invocation is not active.",
  };
}

function resolveManagedAgentDrilldown(
  items: readonly OperatorCockpitManagedAgentViewItem[],
  target: OperatorCockpitManagedAgentDrilldownTarget,
): OperatorCockpitManagedAgentDrilldownViewState {
  const item = items.find((candidate) => (
    candidate.instanceId === target.instanceId
    && candidate.sessionId === target.sessionId
    && candidate.managedInvocationId === target.managedInvocationId
  ));
  if (!item) {
    return {
      resolved: false,
      reason: "managed-invocation-not-found",
    };
  }
  const replayEventId = target.replayEventId ?? item.latestEventId;
  const replayIndex = item.lifecycleTimeline.findIndex((entry) => entry.eventId === replayEventId);
  if (replayIndex === -1) {
    return {
      resolved: false,
      reason: "replay-event-not-found",
    };
  }
  return {
    resolved: true,
    item,
    replay: {
      resolved: true,
      entry: item.lifecycleTimeline[replayIndex]!,
      previousEventId: item.lifecycleTimeline[replayIndex - 1]?.eventId,
      nextEventId: item.lifecycleTimeline[replayIndex + 1]?.eventId,
    },
  };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function compareManagedAgentItems(
  a: OperatorCockpitManagedAgentViewItem,
  b: OperatorCockpitManagedAgentViewItem,
): number {
  const attentionCompare = attentionRank(a.attentionState) - attentionRank(b.attentionState);
  if (attentionCompare !== 0) return attentionCompare;
  const sessionCompare = a.sessionId.localeCompare(b.sessionId);
  return sessionCompare === 0 ? a.managedInvocationId.localeCompare(b.managedInvocationId) : sessionCompare;
}

function attentionRank(state: OperatorCockpitManagedAgentAttentionState): number {
  switch (state) {
    case "needs_review": return 0;
    case "failed": return 1;
    case "active": return 2;
    case "cancelled": return 3;
    case "unknown": return 4;
    case "clear": return 5;
  }
}

function resolveFocus(
  projection: OperatorCockpitReadOnlyProjection,
  target?: OperatorCockpitFocusTarget,
): OperatorCockpitFocusTarget | null {
  if (!target) return null;
  return projection.sessions.some((session) => (
    session.instanceId === target.instanceId
    && session.sessionId === target.sessionId
  )) ? target : null;
}

function resolveFilteredTimeline(
  projection: OperatorCockpitReadOnlyProjection,
  filters?: OperatorCockpitTimelineFilters,
): { readonly valid: boolean; readonly entries: readonly OperatorCockpitTimelineEntry[] } {
  if (!filters) {
    return { valid: true, entries: projection.timeline };
  }
  if ((filters.sessionId || filters.managedInvocationId || filters.toolCallId) && !filters.instanceId) {
    return { valid: false, entries: [] };
  }
  if ((filters.managedInvocationId || filters.toolCallId) && !filters.sessionId) {
    return { valid: false, entries: [] };
  }
  if (!validateFilters(projection, filters)) {
    return { valid: false, entries: [] };
  }

  const entries = projection.timeline.filter((entry) => {
    if (filters.instanceId && entry.instanceId !== filters.instanceId) return false;
    if (filters.sessionId && entry.sessionId !== filters.sessionId) return false;
    if (filters.kinds && filters.kinds.length > 0 && !filters.kinds.includes(entry.kind)) return false;
    if (filters.tones && filters.tones.length > 0 && !filters.tones.includes(entry.tone)) return false;
    if (filters.managedInvocationId && entry.target.managedInvocationId !== filters.managedInvocationId) return false;
    if (filters.toolCallId && !entryContainsToolCallId(projection, entry, filters.toolCallId)) return false;
    if (filters.resourceUri && !entryContainsResourceUri(entry, filters.resourceUri)) return false;
    return true;
  });
  return { valid: true, entries };
}

function validateFilters(
  projection: OperatorCockpitReadOnlyProjection,
  filters: OperatorCockpitTimelineFilters,
): boolean {
  if (filters.instanceId && !projection.instances.some((instance) => instance.instanceId === filters.instanceId)) {
    return false;
  }
  if (filters.sessionId && !sessionExists(projection.sessions, filters.instanceId, filters.sessionId)) {
    return false;
  }
  if (filters.managedInvocationId && !projection.invocations.some((invocation) => {
    if (invocation.managedInvocationId !== filters.managedInvocationId) return false;
    if (filters.instanceId && invocation.instanceId !== filters.instanceId) return false;
    if (filters.sessionId && invocation.sessionId !== filters.sessionId) return false;
    return true;
  })) return false;
  if (filters.toolCallId && !projection.toolSummaries.some((tool) => {
    if (tool.toolCallId !== filters.toolCallId) return false;
    if (filters.instanceId && tool.instanceId !== filters.instanceId) return false;
    if (filters.sessionId && tool.sessionId !== filters.sessionId) return false;
    return true;
  })) return false;
  if (filters.resourceUri && !projection.timeline.some((entry) => entryContainsResourceUri(entry, filters.resourceUri!))) {
    return false;
  }
  return true;
}

function sessionExists(
  sessions: readonly OperatorCockpitSessionProjection[],
  instanceId: string | undefined,
  sessionId: string,
): boolean {
  return sessions.some((session) => (
    session.sessionId === sessionId
    && (!instanceId || session.instanceId === instanceId)
  ));
}

function entryContainsToolCallId(
  projection: OperatorCockpitReadOnlyProjection,
  entry: OperatorCockpitTimelineEntry,
  toolCallId: string,
): boolean {
  if (entry.target.toolCallId === toolCallId) return true;
  return projection.toolSummaries.some((tool) => (
    tool.toolCallId === toolCallId
    && tool.instanceId === entry.instanceId
    && tool.sessionId === entry.sessionId
    && tool.latestEventId === entry.eventId
  ));
}

function entryContainsResourceUri(entry: OperatorCockpitTimelineEntry, resourceUri: string): boolean {
  return Boolean(entry.resourceLinks?.some((resource) => resource.uri === resourceUri));
}

function resolveReplay(
  projection: OperatorCockpitReadOnlyProjection,
  input: {
    readonly replayCursor?: OperatorCockpitReplayCursorTarget;
    readonly focusResolved: OperatorCockpitFocusTarget | null;
    readonly filteredTimeline: { readonly valid: boolean; readonly entries: readonly OperatorCockpitTimelineEntry[] };
  },
): OperatorCockpitReadOnlyViewState["replay"] {
  if (!input.replayCursor) {
    return { resolved: false };
  }
  if (!input.filteredTimeline.valid) {
    return { resolved: false };
  }
  const entry = projection.timeline.find((candidate) => (
    candidate.instanceId === input.replayCursor!.instanceId
    && candidate.sessionId === input.replayCursor!.sessionId
    && candidate.eventId === input.replayCursor!.eventId
  ));
  if (!entry) return { resolved: false };

  const navigationEntries = selectNavigationEntries(projection, input.focusResolved, input.filteredTimeline.entries, entry);
  const cursorIndex = navigationEntries.findIndex((candidate) => candidate.eventId === entry.eventId);
  if (cursorIndex === -1) return { resolved: false };

  return {
    resolved: true,
    entry,
    previousEventId: navigationEntries[cursorIndex - 1]?.eventId,
    nextEventId: navigationEntries[cursorIndex + 1]?.eventId,
  };
}

function selectNavigationEntries(
  projection: OperatorCockpitReadOnlyProjection,
  focusResolved: OperatorCockpitFocusTarget | null,
  filteredTimeline: readonly OperatorCockpitTimelineEntry[],
  entry: OperatorCockpitTimelineEntry,
): readonly OperatorCockpitTimelineEntry[] {
  if (filteredTimeline.length > 0 && filteredTimeline.some((candidate) => candidate.eventId === entry.eventId)) {
    return filteredTimeline;
  }
  if (focusResolved) {
    return projection.timeline.filter((candidate) => (
      candidate.instanceId === focusResolved.instanceId
      && candidate.sessionId === focusResolved.sessionId
    ));
  }
  return projection.timeline.filter((candidate) => (
    candidate.instanceId === entry.instanceId
    && candidate.sessionId === entry.sessionId
  ));
}
