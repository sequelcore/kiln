import type {
  GuiBrowserLiveViewportFrame,
  GuiBrowserOperatorInput,
  GuiBrowserOperatorInputAckFrame,
  GuiBrowserSessionState,
  GuiDeliberationIntent,
  GuiInboundFrame,
  GuiInteractiveUseSnapshot,
  GuiOutboundFrame,
  ExecutionRouteCatalog,
  GuiProviderDiscoveryResult,
  GuiProviderModelDiscoveryProjection,
  AvailableModelCatalog,
  GuiSessionDetail,
  GuiSessionEvent,
  OperatorSessionSummary,
  OperatorGoalMaterializationRequirement,
  OperatorTurnRequestedAuthority,
  ContextUsageProjection,
} from "@kilnai/gateway-contracts";
import type {
  ActivityPhase,
  ActivityState,
  Message,
  SessionStatus,
  StoreActivityFrame,
  StoreTextDeltaFrame,
  TimelineEntry,
} from "./session-timeline-types.js";
import type { AuthorityStatus } from "./authority-status-projection.js";
import type { ProviderCatalogStatus, ProviderDescriptor } from "./provider-catalog-projection.js";

/**
 * Composed state and action contract for the session store: the flat state
 * shape shared by every slice, and the full action surface partitioned into
 * one interface per slice. Pure types only, no store dependency.
 */

export const MAX_DETACHED_SESSION_IDS = 20;

export interface PendingExecutionRouteSelection {
  readonly routeId: string;
  readonly accountOverrideId?: string;
  readonly requestId: string;
}

export interface ProviderAuthTarget {
  readonly provider: string;
  readonly requestId: string;
}

export type ProviderAuthDetails =
  | {
      readonly method: "browser_oauth";
      readonly authorizationUri: string;
    }
  | {
      readonly method: "device_code";
      readonly verificationUri: string;
      readonly userCode: string;
    };

export type RouteMode = "user" | "auto" | "responding";

export interface ProviderOperationFailure {
  readonly operation: "catalog" | "select-route" | "authenticate";
  readonly message: string;
  readonly provider?: string;
  readonly model?: string | null;
  readonly requestId?: string;
}

export interface GoalControlFailure {
  readonly requestId: string;
  readonly goalRunId: string;
  readonly action: "pause" | "resume" | "update_objective" | "cancel";
  readonly message: string;
}

export interface ApprovalResponseFailure {
  readonly requestId: string;
  readonly approvalId: string;
  readonly decision: "approve" | "reject";
  readonly message: string;
}

export interface ApprovalResponsePending {
  readonly requestId: string;
  readonly approvalId: string;
  readonly decision: "approve" | "reject";
}

export interface SessionControlFailure {
  readonly action: "clear" | "cancel_turn";
  readonly message: string;
}

export interface SessionStoreState {
  readonly status: SessionStatus;
  readonly messages: readonly Message[];
  readonly timelineEntries: readonly TimelineEntry[];
  readonly sessionEvents: readonly GuiSessionEvent[];
  readonly currentAssistant: string | null;
  readonly planMode: boolean;
  readonly activity: ActivityState | null;
  readonly sessionControlFailure: SessionControlFailure | null;
  readonly providerCatalogStatus: ProviderCatalogStatus;
  readonly providerCatalogError: string | null;
  readonly providerOperationFailure: ProviderOperationFailure | null;
  readonly providers: readonly ProviderDescriptor[];
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection | null;
  /** Runtime-owned discovery/configuration projection; never joined in the browser. */
  readonly availableModels: AvailableModelCatalog | null;
  /** Operator selection authority. Provider/model identities are derived evidence only. */
  readonly executionRouteCatalog: ExecutionRouteCatalog;
  readonly executionRouteCreationResult: Extract<GuiInboundFrame, { type: "execution_route_create_result" }> | null;
  readonly activeRouteId: string | null;
  readonly activeAccountOverrideId: string | null;
  readonly sessionList: readonly OperatorSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly liveSessionId: string | null;
  readonly continuationTargetId: string | null;
  readonly detachedSessionIds: readonly string[];
  readonly routedProvider: string | null;
  readonly routedModel: string | null;
  readonly routeMode: RouteMode;
  readonly respondingProvider: string | null;
  readonly respondingModel: string | null;
  readonly turnCounter: number;
  readonly sessionCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly currentTurnTrackedInputTokens: number;
  readonly currentTurnTrackedOutputTokens: number;
  readonly clearPending: boolean;
  readonly turnCancelPending: boolean;
  readonly goalControlPending: {
    readonly requestId: string;
    readonly goalRunId: string;
    readonly action: "pause" | "resume" | "update_objective" | "cancel";
  } | null;
  readonly goalControlFailure: GoalControlFailure | null;
  readonly approvalResponseFailure: ApprovalResponseFailure | null;
  readonly approvalResponsesPending: readonly ApprovalResponsePending[];
  readonly executionRouteSelecting: boolean;
  readonly executionRouteSelectionTarget: PendingExecutionRouteSelection | null;
  readonly providerAuthenticating: boolean;
  readonly providerAuthTarget: ProviderAuthTarget | null;
  readonly providerAuthMessage: string | null;
  readonly providerAuthDetails: ProviderAuthDetails | null;
  readonly authorityStatus: AuthorityStatus | null;
  readonly contextUsage: ContextUsageProjection | null;
  readonly interactiveUseSnapshot: GuiInteractiveUseSnapshot | null;
  readonly browserSessionState: GuiBrowserSessionState | null;
  readonly browserLiveViewportFrame: GuiBrowserLiveViewportFrame | null;
  readonly browserOperatorInputAck: GuiBrowserOperatorInputAckFrame | null;
  readonly outboundSend: ((frame: GuiOutboundFrame) => void) | null;
  readonly clearTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly executionRouteSelectionTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly providerAuthTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly activityPhase: ActivityPhase;
}

export interface ConnectionLifecycleActions {
  setConnectionStatus: (status: SessionStatus) => void;
  setSender: (send: ((frame: GuiOutboundFrame) => void) | null) => void;
  onCleared: () => void;
  sendClear: () => boolean;
  disconnect: () => void;
}

export interface SessionListActions {
  setSessionList: (sessions: readonly OperatorSessionSummary[]) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
  viewSessionDetail: (detail: GuiSessionDetail) => void;
  setContinuation: (sessionId: string | null) => void;
}

export interface TurnStreamingActions {
  onSessionEvent: (event: GuiSessionEvent) => void;
  onTextDelta: (frame: StoreTextDeltaFrame) => void;
  onActivity: (frame: StoreActivityFrame) => void;
  onDone: (frame: Extract<GuiInboundFrame, { type: "done" }>) => void;
  onTurnCancelResult: (frame: Extract<GuiInboundFrame, { type: "turn_cancel_result" }>) => void;
  onActivityPhase: (frame: Extract<GuiInboundFrame, { type: "activity_phase" }>) => void;
  onExecConfirmed: () => void;
  sendMessage: (
    text: string,
    options?: {
      parts?: readonly unknown[];
      displayContent?: string;
      deliberationIntent?: GuiDeliberationIntent;
      requestedAuthority?: OperatorTurnRequestedAuthority;
      governedWorkRequirement?: OperatorGoalMaterializationRequirement;
      gatewayTargetId?: string;
      appName?: string;
      tenantId?: string;
    },
  ) => boolean;
  cancelActiveTurn: () => boolean;
  setPlanMode: (enabled: boolean, options?: { readonly gatewayTargetId?: string }) => void;
}

export interface ExecutionRouteLifecycleActions {
  markProviderCatalogRefreshing: () => void;
  markProviderCatalogError: (message: string) => void;
  onWelcome: (frame: Extract<GuiInboundFrame, { type: "welcome" }>) => void;
  onExecutionRoutesRefreshed: (frame: Extract<GuiInboundFrame, { type: "execution_routes_refreshed" }>) => void;
  onExecutionRouteCreateResult: (frame: Extract<GuiInboundFrame, { type: "execution_route_create_result" }>) => void;
  onExecutionRouteChanged: (frame: Extract<GuiInboundFrame, { type: "execution_route_changed" }>) => void;
  onExecutionRouteChangeFailed: (frame: Extract<GuiInboundFrame, { type: "execution_route_change_failed" }>) => void;
  onProviderAuthStarted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_started" }>) => void;
  onProviderAuthCompleted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_completed" }>) => void;
  onProviderAuthFailed: (frame: Extract<GuiInboundFrame, { type: "provider_auth_failed" }>) => void;
  selectExecutionRoute: (routeId: string, accountOverrideId?: string) => boolean;
  authenticateProvider: (provider: string, options?: { apiKey?: string; tier?: "go" | "zen" }) => boolean;
}

export interface InteractiveUseActions {
  onInteractiveUseUpdated: (frame: Extract<GuiInboundFrame, { type: "interactive_use_updated" }>) => void;
  onBrowserSessionUpdated: (frame: Extract<GuiInboundFrame, { type: "browser_session_updated" }>) => void;
  onBrowserLiveViewportFrame: (frame: Extract<GuiInboundFrame, { type: "browser_live_viewport_frame" }>) => void;
  onBrowserOperatorInputAck: (frame: Extract<GuiInboundFrame, { type: "browser_operator_input_ack" }>) => void;
  sendBrowserOperatorInput: (
    request: {
      readonly sessionId: string;
      readonly gatewayTargetId?: string;
      readonly input: GuiBrowserOperatorInput;
    },
  ) => boolean;
  requestBrowserSessionControl: (
    action: "takeover" | "release",
    options?: { readonly gatewayTargetId?: string; readonly sessionId?: string; readonly reason?: string },
  ) => boolean;
}

export interface VoiceActions {
  onVoiceSynthesisCompleted: (frame: Extract<GuiInboundFrame, { type: "voice_synthesis_completed" }>) => void;
  onVoiceSynthesisFailed: (frame: Extract<GuiInboundFrame, { type: "voice_synthesis_failed" }>) => void;
  requestVoiceSynthesis: (messageId: string) => boolean;
}

export interface ApprovalGoalActions {
  controlGoal: (input: {
    readonly goalRunId: string;
    readonly action: "pause" | "resume" | "update_objective" | "cancel";
    readonly objective?: string;
    readonly reason?: string;
  }) => boolean;
  onGoalControlResult: (frame: Extract<GuiInboundFrame, { type: "goal_control_result" }>) => void;
  onApprovalResponseResult: (frame: Extract<GuiInboundFrame, { type: "approval_response_result" }>) => void;
  sendApprovalResponse: (
    approved: boolean,
    reason: string | undefined,
    approvalId: string,
    options?: { readonly gatewayTargetId?: string },
  ) => boolean;
}

export interface ErrorHandlingActions {
  onError: (frame: Extract<GuiInboundFrame, { type: "error" }>) => void;
}

export type SessionStoreActions =
  & ConnectionLifecycleActions
  & SessionListActions
  & TurnStreamingActions
  & ExecutionRouteLifecycleActions
  & InteractiveUseActions
  & VoiceActions
  & ApprovalGoalActions
  & ErrorHandlingActions;

export type SessionStore = SessionStoreState & SessionStoreActions;
