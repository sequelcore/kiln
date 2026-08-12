import { create } from "zustand";
import { readStoredPlanMode } from "./session-store-persistence.js";
import { createConnectionLifecycleSlice } from "./connection-lifecycle-slice.js";
import { createSessionListSlice } from "./session-list-slice.js";
import { createTurnStreamingSlice } from "./turn-streaming-slice.js";
import { createExecutionRouteLifecycleSlice } from "./execution-route-lifecycle-slice.js";
import { createInteractiveUseSlice } from "./interactive-use-slice.js";
import { createVoiceSlice } from "./voice-slice.js";
import { createApprovalGoalSlice } from "./approval-goal-slice.js";
import { createTurnFailureSlice } from "./turn-failure-slice.js";
import type { SessionStore, SessionStoreState } from "./session-store-state.js";

/**
 * Composition root for the session store: the default state snapshot,
 * the eight slices spread into one `create()` call, and the public barrel
 * re-exported below. See `docs/architecture/` for the store's role; this
 * file only wires the pieces together.
 */

const initialPlanMode = readStoredPlanMode() ?? false;

const initialState: SessionStoreState = {
  status: "idle",
  messages: [],
  timelineEntries: [],
  sessionEvents: [],
  currentAssistant: null,
  planMode: initialPlanMode,
  activity: null,
  sessionControlFailure: null,
  providerCatalogStatus: "pending",
  providerCatalogError: null,
  providerOperationFailure: null,
  providers: [],
  providerDiscovery: [],
  providerModelDiscovery: null,
  executionRouteCatalog: { routes: [] },
  activeRouteId: null,
  activeAccountOverrideId: null,
  sessionList: [],
  selectedSessionId: null,
  liveSessionId: null,
  continuationTargetId: null,
  detachedSessionIds: [],
  routedProvider: null,
  routedModel: null,
  routeMode: "auto",
  respondingProvider: null,
  respondingModel: null,
  turnCounter: 0,
  sessionCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  currentTurnTrackedInputTokens: 0,
  currentTurnTrackedOutputTokens: 0,
  clearPending: false,
  turnCancelPending: false,
  goalControlPending: null,
  goalControlFailure: null,
  approvalResponseFailure: null,
  approvalResponsesPending: [],
  executionRouteSelecting: false,
  executionRouteSelectionTarget: null,
  providerAuthenticating: false,
  providerAuthTarget: null,
  providerAuthMessage: null,
  providerAuthDetails: null,
  authorityStatus: null,
  contextUsage: null,
  interactiveUseSnapshot: null,
  browserSessionState: null,
  browserLiveViewportFrame: null,
  browserOperatorInputAck: null,
  outboundSend: null,
  clearTimeoutId: null,
  executionRouteSelectionTimeoutId: null,
  providerAuthTimeoutId: null,
  activityPhase: "idle",
};

export const useSessionStore = create<SessionStore>()((...api) => ({
  ...initialState,
  ...createConnectionLifecycleSlice(...api),
  ...createSessionListSlice(...api),
  ...createTurnStreamingSlice(...api),
  ...createExecutionRouteLifecycleSlice(...api),
  ...createInteractiveUseSlice(...api),
  ...createVoiceSlice(...api),
  ...createApprovalGoalSlice(...api),
  ...createTurnFailureSlice(...api),
}));

export type {
  ActivityPhase,
  ActivityState,
  ApprovalRequest,
  ChangedFileEntry,
  Message,
  SessionStatus,
  TimelineEntry,
  TimelineEventEntry,
  TimelineMessageEntry,
  ToolCallEntry,
  ToolCallStatus,
  WorkItemEntry,
  WorkItemExecutionAttemptEntry,
  WorkItemPauseRequirementEntry,
} from "./session-timeline-types.js";
export type { AuthorityStatus } from "./authority-status-projection.js";
export type { ProviderCatalogStatus, ProviderDescriptor } from "./provider-catalog-projection.js";
export type {
  ApprovalResponseFailure,
  GoalControlFailure,
  ProviderAuthDetails,
  ProviderOperationFailure,
  RouteMode,
  SessionControlFailure,
  SessionStore,
} from "./session-store-state.js";
export {
  deriveChangedFiles,
  deriveToolCallLog,
  derivePendingApprovals,
  deriveWorkItems,
} from "./derived-timeline-selectors.js";
