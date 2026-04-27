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
      content?: string;
      text?: string;
      planMode?: boolean;
      resumeSessionId?: string;
    }
  | { type: "clear" }
  | { type: "provider"; provider: string; model?: string }
  | { type: "resume"; sessionId: string }
  | { type: "approve"; sessionId?: string }
  | { type: "reject"; reason: string; sessionId?: string }
  | { type: "approval_response"; approved: boolean; reason?: string; sessionId?: string }
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
    | { type: "provider_changed"; provider: string; model?: string }
    | { type: "resume_selected"; sessionId: string };

/** Connection lifecycle states for the GUI session WebSocket client. */
export type GuiSessionConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
