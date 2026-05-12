/**
 * GUI operator surface frame contracts.
 *
 * Outbound frames flow from the browser (operator) to the runtime gateway.
 * Inbound frames flow from the runtime gateway to the browser.
 */

// --- Dashboard / HTTP response shapes ---

export interface GuiProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: "subscription" | "harness" | "direct-api";
  readonly models: readonly string[];
  readonly free: boolean;
  readonly available: boolean;
  readonly status?: GuiProviderDiscoveryStatus;
  readonly reason?: string;
  readonly authState?: GuiProviderAuthState;
  readonly lastCheckedAt?: string;
}

export type GuiProviderDiscoveryStatus =
  | "available"
  | "missing_auth"
  | "auth_expired"
  | "cli_missing"
  | "endpoint_timeout"
  | "endpoint_error"
  | "empty_model_list"
  | "daemon_unreachable"
  | "model_selection_not_required";

export type GuiProviderAuthState =
  | "authenticated"
  | "missing"
  | "expired"
  | "not_required"
  | "unknown";

export type GuiProviderCatalogStatus = "pending" | "refreshing" | "ready" | "error";

export type GuiProviderReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type OperatorExecutionMode = "execute" | "plan";
export type OperatorTurnRequestedAuthority = "auto" | "read_only" | "audited";

export interface GuiProviderModelCapabilities {
  readonly supportsFunctionTools?: boolean;
  readonly supportsRuntimeTools?: boolean;
  readonly supportsNativeShellTools?: boolean;
  readonly supportsNativePatchTools?: boolean;
  readonly supportsTools?: boolean;
  readonly supportsStreaming?: boolean;
  readonly supportsStructuredOutput?: boolean;
  readonly supportsVision?: boolean;
  readonly supportsParallelToolCalls?: boolean;
  readonly contextWindow?: number;
  readonly defaultReasoningEffort?: GuiProviderReasoningEffort;
  readonly supportedReasoningEfforts?: readonly GuiProviderReasoningEffort[];
}

export interface GuiProviderModelRouteHealth {
  readonly healthy: boolean;
  readonly reason?: string;
  readonly cooldownUntil?: number;
}

export interface GuiProviderDiscoveryResult {
  readonly provider: string;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly modelCapabilities?: Readonly<Record<string, GuiProviderModelCapabilities>>;
  readonly modelRouteHealth?: Readonly<Record<string, GuiProviderModelRouteHealth>>;
  readonly status: GuiProviderDiscoveryStatus;
  readonly reason: string;
  readonly authState: GuiProviderAuthState;
  readonly lastCheckedAt: string;
}

export type GuiProviderAuthMethod = "device_code" | "api_key";

export interface GuiProviderAuthDeviceCodeStarted {
  readonly type: "provider_auth_started";
  readonly provider: string;
  readonly requestId: string;
  readonly method: "device_code";
  readonly verificationUri: string;
  readonly userCode: string;
  readonly message?: string;
}

export interface GuiProviderAuthCompleted {
  readonly type: "provider_auth_completed";
  readonly provider: string;
  readonly requestId: string;
  readonly models: Record<string, string[]>;
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly providers?: readonly GuiProviderDescriptor[];
}

export interface GuiProviderAuthFailed {
  readonly type: "provider_auth_failed";
  readonly provider: string;
  readonly requestId: string;
  readonly message: string;
}

export interface GuiSessionSummary {
  readonly id: string;
  readonly title?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly providersUsed: readonly string[];
  readonly lastProvider?: string;
  readonly completedAt: string;
  readonly cost: number;
  readonly taskSummary: string;
}

export interface GuiSessionListResponse {
  readonly sessions: readonly GuiSessionSummary[];
}

export interface GuiTelemetrySnapshot {
  readonly status: string;
  readonly dominantRegions: readonly string[];
  readonly saturation: number;
  readonly entropy: number;
}

export interface GuiResumeInfo {
  readonly strategy: string;
  readonly feedbackLabel?: string;
}

export interface GuiProviderThreadMeta {
  readonly provider: string;
  readonly providerSessionId?: string;
  readonly lastModel?: string;
  readonly lastUsedAt?: string;
}

export interface GuiWorkspaceTreeEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
}

export interface GuiWorkspaceTreeSnapshot {
  readonly rootPath: string;
  readonly entries: readonly GuiWorkspaceTreeEntry[];
  readonly truncated?: boolean;
  readonly source?: "gateway";
  readonly worktreePath?: string;
}

export interface GuiAppTenantDescriptor {
  readonly tenantId: string;
  readonly label?: string;
  readonly enabled: boolean;
}

export interface GuiAppDescriptor {
  readonly name: string;
  readonly runtime: "provider-adapter" | "tenant" | "none";
  readonly channels: readonly string[];
  readonly tenants?: readonly GuiAppTenantDescriptor[];
  readonly runtimeCapable: boolean;
}

export interface GuiDashboardSnapshot {
  readonly providers: readonly GuiProviderDescriptor[];
  readonly sessions: readonly GuiSessionSummary[];
  readonly telemetry: GuiTelemetrySnapshot;
  readonly resumeInfoByProvider: Readonly<Record<string, GuiResumeInfo>>;
  readonly apps?: readonly GuiAppDescriptor[];
  readonly activeAppName?: string;
  readonly activeTenantId?: string;
  readonly workingDirectory?: string;
  readonly domainLabel?: string;
  readonly workspaceTree?: GuiWorkspaceTreeSnapshot;
}

// --- Session detail / HTTP response shapes ---

export interface GuiSessionMeta {
  readonly kilnSessionId: string;
  readonly title?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly providersUsed?: readonly string[];
  readonly lastProvider?: string;
  readonly providerThreads?: readonly GuiProviderThreadMeta[];
  readonly task: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly costUsd?: number;
  readonly toolCount?: number;
  readonly turnDepth?: number;
  readonly resumeStrategy?: string;
  readonly resumeFeedback?: {
    readonly sampleSize: number;
    readonly preferredStrategy?: string;
    readonly influencedChoice: boolean;
  };
  readonly resumeOutcome?: {
    readonly succeeded: boolean;
    readonly finalProvider?: string;
    readonly costUsd: number;
    readonly toolCallCount: number;
    readonly durationMs: number;
    readonly verificationPassed?: boolean;
  };
  readonly sessionLedger?: {
    readonly currentPhase: string;
    readonly resumedFrom?: string;
    readonly workingDirectory?: string;
    readonly worktreePath?: string;
    readonly lastError?: string;
    readonly lastProvider?: string;
    readonly toolCallCount?: number;
    readonly turnDepth?: number;
  };
  readonly exactArtifacts?: readonly string[];
}

export type OperatorSessionEventKind =
  | "turn_started"
  | "user_message"
  | "assistant_message"
  | "assistant_delta"
  | "specification_submitted"
  | "clarification_recorded"
  | "plan_submitted"
  | "plan_analysis_reported"
  | "plan_approved"
  | "provider_routed"
  | "tool_call_started"
  | "tool_call_completed"
  | "approval_requested"
  | "approval_resolved"
  | "config_change_proposed"
  | "config_change_approved"
  | "config_change_applied"
  | "config_change_failed"
  | "file_changed"
  | "cost_updated"
  | "work_item_updated"
  | "agent_invocation_requested"
  | "agent_invocation_started"
  | "agent_invocation_completed"
  | "agent_invocation_failed"
  | "agent_invocation_cancelled"
  | "continuity_decided"
  | "error_recorded"
  | "turn_completed";

export type GuiSessionEventKind = OperatorSessionEventKind;

export type OperatorAgentInvocationSessionEventKind =
  | "agent_invocation_requested"
  | "agent_invocation_started"
  | "agent_invocation_completed"
  | "agent_invocation_failed"
  | "agent_invocation_cancelled";

export interface OperatorSessionEventSource {
  readonly actor: "user" | "assistant" | "system" | "tool" | "runtime";
  readonly surface: "cli" | "tui" | "gui" | "ide" | "gateway" | "runtime";
  readonly component?: string;
}

export type GuiSessionEventSource = OperatorSessionEventSource;

export interface OperatorManagedAgentProviderRoute {
  readonly providerId: string;
  readonly surface: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
}

export interface OperatorManagedAgentRouteHealthSnapshot {
  readonly status: "healthy";
  readonly reason: string;
}

export interface OperatorManagedAgentProviderModelProofSnapshot {
  readonly status: "live-proven" | "configured" | "unproven";
  readonly source: string;
  readonly requiresToolCalls?: boolean;
}

export interface OperatorManagedAgentResourcePlaneSnapshot {
  readonly available: boolean;
  readonly resourceUris: readonly string[];
  readonly reason?: string;
}

export interface OperatorManagedAgentChildIdentitySnapshot {
  readonly agentId: string;
  readonly requestedAgentProfile?: string;
  readonly admittedAgentProfile?: string;
  readonly displayName?: string;
}

export interface OperatorManagedAgentCapabilitySnapshot {
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly routeId: string;
  readonly routeHealth: OperatorManagedAgentRouteHealthSnapshot;
  readonly providerModelProof: OperatorManagedAgentProviderModelProofSnapshot;
  readonly providerRoute: OperatorManagedAgentProviderRoute;
  readonly adapterKind: "direct" | "harness";
  readonly executionMode: "direct-provider" | "local-harness" | "cli-harness" | "remote-harness";
  readonly adapterDescriptor: Record<string, unknown>;
  readonly authorityProfile: Record<string, unknown>;
  readonly contextMode: "isolated" | "resources" | "fork";
  readonly resourcePlane: OperatorManagedAgentResourcePlaneSnapshot;
  readonly childIdentity: OperatorManagedAgentChildIdentitySnapshot;
}

export interface OperatorManagedAgentInvocationEventPayload extends Record<string, unknown> {
  readonly invocationId: string;
  readonly agentId: string;
  readonly profile?: string;
  readonly providerRoute?: OperatorManagedAgentProviderRoute;
  readonly adapterKind?: "direct" | "harness";
  readonly executionMode?: "direct-provider" | "local-harness" | "cli-harness" | "remote-harness";
  readonly requestedAuthority?: "auto" | "read_only" | "audited" | "destructive";
  readonly authorityProfileId?: string;
  readonly capabilitySnapshot?: OperatorManagedAgentCapabilitySnapshot;
}

export interface OperatorSessionEvent {
  readonly eventId: string;
  readonly kilnSessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly kind: OperatorSessionEventKind;
  readonly turnId?: string;
  readonly parentEventId?: string;
  readonly source?: OperatorSessionEventSource;
  readonly payload: Record<string, unknown>;
}

export interface OperatorManagedAgentInvocationSessionEvent extends OperatorSessionEvent {
  readonly kind: OperatorAgentInvocationSessionEventKind;
  readonly payload: OperatorManagedAgentInvocationEventPayload;
}

export type GuiSessionEvent = OperatorSessionEvent;

export interface GuiSessionDetail {
  readonly id: string;
  readonly meta: GuiSessionMeta;
  readonly events: readonly OperatorSessionEvent[];
}

// --- WebSocket frame shapes ---

export type OperatorThemeScope = "session" | "persisted";

export interface OperatorThemeSetFrame {
  readonly type: "operator_theme_set";
  readonly requestId: string;
  readonly theme: string;
  readonly scope: OperatorThemeScope;
  readonly reason?: string;
}

export interface OperatorThemeSetResultFrame {
  readonly type: "operator_theme_set_result";
  readonly requestId: string;
  readonly ok: boolean;
  readonly appliedTheme?: string;
  readonly error?: string;
}

export type OperatorActivityPhase =
  | "idle"
  | "thinking"
  | "tool_running"
  | "awaiting_approval"
  | "streaming";

export interface OperatorActivityPhaseFrame {
  readonly type: "activity_phase";
  readonly kilnSessionId: string;
  readonly turnId?: string;
  readonly phase: OperatorActivityPhase;
  readonly toolName?: string;
  readonly details?: string;
}

export interface GuiMemoryLatticeInvalidatedFrame {
  readonly type: "memory_lattice_invalidated";
  readonly occurredAt: string;
  readonly reason:
    | "record_created"
    | "record_updated"
    | "record_deleted"
    | "relation_created"
    | "relation_deleted"
    | "revision_created"
    | "context_admitted"
    | "context_deferred";
  readonly scope?: {
    readonly kind: string;
    readonly id: string;
  };
  readonly layer?: string;
  readonly recordId?: string;
  readonly relationId?: string;
  readonly revisionId?: string;
  readonly admissionId?: string;
}

export type GuiInteractiveUseTarget = "browser" | "computer";
export type GuiInteractiveUseStatus = "running" | "succeeded" | "failed";

export interface GuiInteractiveUseSnapshot {
  readonly target: GuiInteractiveUseTarget;
  readonly status: GuiInteractiveUseStatus;
  readonly updatedAt: string;
  readonly kilnSessionId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly provider?: string;
  readonly sessionId?: string;
  readonly operation?: string;
  readonly url?: string;
  readonly title?: string;
  readonly visibleText?: string;
  readonly windowTitle?: string;
  readonly application?: string;
  readonly closeMethod?: string;
  readonly screenshotUri?: string;
  readonly screenshotDataUrl?: string;
  readonly actionSummary?: string;
  readonly error?: string;
}

export interface GuiInteractiveUseUpdatedFrame {
  readonly type: "interactive_use_updated";
  readonly snapshot: GuiInteractiveUseSnapshot;
}

/** Frames sent by the browser (operator) to the gateway. */
export type GuiOutboundFrame =
  | {
      type: "message";
      content: string;
      executionMode?: OperatorExecutionMode;
      requestedAuthority?: OperatorTurnRequestedAuthority;
      resumeSessionId?: string;
      reasoningEffort?: GuiProviderReasoningEffort;
      appName?: string;
      tenantId?: string;
    }
  | { type: "clear" }
  | { type: "refresh_providers" }
  | {
      type: "provider_auth";
      provider: string;
      requestId: string;
      apiKey?: string;
      tier?: "go" | "zen";
    }
  | { type: "provider"; provider: string; model?: string; requestId: string }
  | OperatorThemeSetResultFrame
  | { type: "resume"; sessionId: string }
  | { type: "approve"; approvalId: string }
  | { type: "reject"; reason: string; approvalId: string }
  | {
      type: "execution_mode_transition";
      toMode: OperatorExecutionMode;
      planId?: string;
      residualRiskAcknowledged?: boolean;
      residualRiskAcknowledgement?: string;
    };

/** Frames sent by the gateway to the browser (operator). */
export type GuiInboundFrame =
  | { type: "thinking" }
  | OperatorThemeSetFrame
  | { type: "session_event"; event: OperatorSessionEvent }
  | OperatorActivityPhaseFrame
  | GuiInteractiveUseUpdatedFrame
  | GuiMemoryLatticeInvalidatedFrame
  | {
      type: "done";
      content: string;
      parts?: readonly unknown[];
      inputTokens: number;
      outputTokens: number;
      routedProvider?: string;
      routedModel?: string;
      runtimeContinuity?: {
        strategy: string;
        feedbackLabel?: string;
        pressure?: string;
        supportArtifactCount?: number;
        supportArtifactSources?: readonly string[];
        fallbackLabel?: string;
        usedCachedSupport?: boolean;
        selectionReason?: string;
      };
      authorityStatus?: {
        effective: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
        completeness: "authoritative" | "partial";
        };
      }
  | { type: "error"; message: string; code?: string }
  | {
      type: "welcome";
      greeting?: string;
      models?: Record<string, string[]>;
      providerDiscovery?: readonly GuiProviderDiscoveryResult[];
      providers?: readonly GuiProviderDescriptor[];
      activeProvider?: string;
      activeModel?: string;
      executionMode?: OperatorExecutionMode;
      workingDirectory?: string;
      domainLabel?: string;
      authorityStatus?: {
        effective: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
        completeness: "authoritative" | "partial";
      };
    }
    | {
        type: "execution_mode_transitioned";
        executionMode: OperatorExecutionMode;
        planId?: string;
        approvalId?: string;
        planHash?: string;
      }
    | { type: "cleared" }
    | GuiProviderAuthDeviceCodeStarted
    | GuiProviderAuthCompleted
    | GuiProviderAuthFailed
    | {
      type: "providers_refreshed";
      models: Record<string, string[]>;
      providerDiscovery: readonly GuiProviderDiscoveryResult[];
      providers: readonly GuiProviderDescriptor[];
    }
    | { type: "provider_changed"; provider: string; model?: string; requestId: string }
    | { type: "resume_selected"; sessionId: string };

/** Connection lifecycle states for the GUI session WebSocket client. */
export type GuiSessionConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
