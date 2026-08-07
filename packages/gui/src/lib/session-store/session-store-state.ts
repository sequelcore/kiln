import type {
  GuiBrowserLiveViewportFrame,
  GuiBrowserOperatorInput,
  GuiBrowserOperatorInputAckFrame,
  GuiBrowserSessionState,
  GuiDeliberationIntent,
  GuiInboundFrame,
  GuiInteractiveUseSnapshot,
  GuiOutboundFrame,
  GuiProviderDiscoveryResult,
  GuiProviderModelDiscoveryProjection,
  GuiSessionDetail,
  GuiSessionEvent,
  GuiSessionSummary,
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

export interface ProviderSwitchTarget {
  readonly provider: string;
  readonly model: string | null;
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

export interface SessionStoreState {
  readonly status: SessionStatus;
  readonly messages: readonly Message[];
  readonly timelineEntries: readonly TimelineEntry[];
  readonly sessionEvents: readonly GuiSessionEvent[];
  readonly currentAssistant: string | null;
  readonly planMode: boolean;
  readonly activity: ActivityState | null;
  readonly errorBanner: string | null;
  readonly providerCatalogStatus: ProviderCatalogStatus;
  readonly providerCatalogError: string | null;
  readonly providers: readonly ProviderDescriptor[];
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection | null;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly sessionList: readonly GuiSessionSummary[];
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
  readonly providerSwitching: boolean;
  readonly providerSwitchTarget: ProviderSwitchTarget | null;
  readonly providerAuthenticating: boolean;
  readonly providerAuthTarget: ProviderAuthTarget | null;
  readonly providerAuthMessage: string | null;
  readonly providerAuthDetails: ProviderAuthDetails | null;
  readonly providerExplicitSelection: boolean;
  readonly authorityStatus: AuthorityStatus | null;
  readonly contextUsage: ContextUsageProjection | null;
  readonly interactiveUseSnapshot: GuiInteractiveUseSnapshot | null;
  readonly browserSessionState: GuiBrowserSessionState | null;
  readonly browserLiveViewportFrame: GuiBrowserLiveViewportFrame | null;
  readonly browserOperatorInputAck: GuiBrowserOperatorInputAckFrame | null;
  readonly outboundSend: ((frame: GuiOutboundFrame) => void) | null;
  readonly clearTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly providerSwitchTimeoutId: ReturnType<typeof setTimeout> | null;
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
  setSessionList: (sessions: readonly GuiSessionSummary[]) => void;
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

export interface ProviderLifecycleActions {
  markProviderCatalogRefreshing: () => void;
  markProviderCatalogError: (message: string) => void;
  onWelcome: (frame: Extract<GuiInboundFrame, { type: "welcome" }>) => void;
  onProvidersRefreshed: (
    providers: readonly ProviderDescriptor[],
    providerDiscovery?: readonly GuiProviderDiscoveryResult[],
    providerModelDiscovery?: GuiProviderModelDiscoveryProjection,
  ) => void;
  onProviderChanged: (frame: Extract<GuiInboundFrame, { type: "provider_changed" }>) => void;
  onProviderAuthStarted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_started" }>) => void;
  onProviderAuthCompleted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_completed" }>) => void;
  onProviderAuthFailed: (frame: Extract<GuiInboundFrame, { type: "provider_auth_failed" }>) => void;
  switchProvider: (provider: string, model?: string) => boolean;
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
  sendApprovalResponse: (
    approved: boolean,
    reason: string | undefined,
    approvalId: string,
    options?: { readonly gatewayTargetId?: string },
  ) => boolean;
}

export interface ErrorHandlingActions {
  setErrorBanner: (message: string | null) => void;
  clearErrorBanner: () => void;
  onError: (frame: Extract<GuiInboundFrame, { type: "error" }>) => void;
}

export type SessionStoreActions =
  & ConnectionLifecycleActions
  & SessionListActions
  & TurnStreamingActions
  & ProviderLifecycleActions
  & InteractiveUseActions
  & VoiceActions
  & ApprovalGoalActions
  & ErrorHandlingActions;

export type SessionStore = SessionStoreState & SessionStoreActions;
