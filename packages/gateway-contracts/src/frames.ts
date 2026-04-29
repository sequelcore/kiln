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

export interface GuiProviderModelCapabilities {
  readonly supportsTools?: boolean;
  readonly supportsStreaming?: boolean;
  readonly supportsStructuredOutput?: boolean;
  readonly supportsVision?: boolean;
  readonly supportsParallelToolCalls?: boolean;
  readonly contextWindow?: number;
  readonly defaultReasoningEffort?: GuiProviderReasoningEffort;
  readonly supportedReasoningEfforts?: readonly GuiProviderReasoningEffort[];
}

export interface GuiProviderDiscoveryResult {
  readonly provider: string;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly modelCapabilities?: Readonly<Record<string, GuiProviderModelCapabilities>>;
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

export interface GuiDashboardSnapshot {
  readonly providers: readonly GuiProviderDescriptor[];
  readonly sessions: readonly GuiSessionSummary[];
  readonly telemetry: GuiTelemetrySnapshot;
  readonly resumeInfoByProvider: Readonly<Record<string, GuiResumeInfo>>;
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

export type GuiSessionEventKind =
  | "turn_started"
  | "user_message"
  | "assistant_message"
  | "assistant_delta"
  | "provider_routed"
  | "tool_call_started"
  | "tool_call_completed"
  | "approval_requested"
  | "approval_resolved"
  | "file_changed"
  | "cost_updated"
  | "agent_invocation_requested"
  | "agent_invocation_started"
  | "agent_invocation_completed"
  | "agent_invocation_failed"
  | "agent_invocation_cancelled"
  | "continuity_decided"
  | "error_recorded"
  | "turn_completed";

export interface GuiSessionEventSource {
  readonly actor: "user" | "assistant" | "system" | "tool" | "runtime";
  readonly surface: "cli" | "tui" | "gui" | "ide" | "gateway" | "runtime";
  readonly component?: string;
}

export interface GuiSessionEvent {
  readonly eventId: string;
  readonly kilnSessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly kind: GuiSessionEventKind;
  readonly turnId?: string;
  readonly parentEventId?: string;
  readonly source?: GuiSessionEventSource;
  readonly payload: Record<string, unknown>;
}

export interface GuiSessionDetail {
  readonly id: string;
  readonly meta: GuiSessionMeta;
  readonly events: readonly GuiSessionEvent[];
}

// --- WebSocket frame shapes ---

/** Frames sent by the browser (operator) to the gateway. */
export type GuiOutboundFrame =
  | {
      type: "message";
      content: string;
      planMode?: boolean;
      resumeSessionId?: string;
      reasoningEffort?: GuiProviderReasoningEffort;
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
  | { type: "resume"; sessionId: string }
  | { type: "approve"; sessionId?: string }
  | { type: "reject"; reason: string; sessionId?: string }
  | { type: "exec" };

/** Frames sent by the gateway to the browser (operator). */
export type GuiInboundFrame =
  | { type: "thinking" }
  | { type: "session_event"; event: GuiSessionEvent }
  | {
      type: "activity_phase";
      phase: "idle" | "thinking" | "tool_running" | "awaiting_approval" | "streaming";
      toolName?: string;
      details?: string;
    }
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
      planMode?: boolean;
      workingDirectory?: string;
      domainLabel?: string;
      authorityStatus?: {
        effective: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
        completeness: "authoritative" | "partial";
      };
    }
    | { type: "exec_confirmed" }
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
