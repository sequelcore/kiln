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
  readonly provider: string;
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

export interface GuiDashboardSnapshot {
  readonly providers: readonly GuiProviderDescriptor[];
  readonly sessions: readonly GuiSessionSummary[];
  readonly telemetry: GuiTelemetrySnapshot;
}

// --- Session detail / HTTP response shapes ---

export interface GuiSessionMeta {
  readonly kilnSessionId: string;
  readonly provider: string;
  readonly task: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly costUsd?: number;
  readonly toolCount?: number;
  readonly turnDepth?: number;
  readonly providerSessionId?: string;
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

export interface GuiSessionTranscriptLine {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export interface GuiSessionDetail {
  readonly id: string;
  readonly meta: GuiSessionMeta;
  readonly transcript: readonly GuiSessionTranscriptLine[];
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
  | { type: "resume"; sessionId: string; provider: string }
  | { type: "approve"; sessionId?: string }
  | { type: "reject"; reason: string; sessionId?: string }
  | { type: "approval_response"; approved: boolean; reason?: string; sessionId?: string }
  | { type: "exec" };

/** Frames sent by the gateway to the browser (operator). */
export type GuiInboundFrame =
  | { type: "thinking" }
  | {
      type: "activity";
      activity: string;
      toolName?: string;
      output?: string;
      usd?: number;
      input?: unknown;
      inputTokens?: number;
      outputTokens?: number;
      details?: string;
      sessionId?: string;
      path?: string;
      changeType?: "created" | "modified" | "deleted";
      linesAdded?: number;
      linesRemoved?: number;
    }
  | {
      type: "tool_call_start";
      callId: string;
      toolName: string;
      input: Record<string, unknown>;
      timestamp: string;
    }
  | {
      type: "tool_call_result";
      callId: string;
      toolName: string;
      result: string;
      status: "success" | "error";
      timestamp: string;
    }
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
  | { type: "text_delta"; content: string }
  | { type: "error"; message: string; code?: string }
  | {
      type: "welcome";
      greeting?: string;
      models?: Record<string, string[]>;
      providers?: readonly GuiProviderDescriptor[];
      activeProvider?: string;
      activeModel?: string;
      planMode?: boolean;
      authorityStatus?: {
        effective: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
        completeness: "authoritative" | "partial";
      };
    }
  | { type: "exec_confirmed" }
  | { type: "cleared" }
  | { type: "provider_changed"; provider: string; model?: string }
  | { type: "resume_selected"; sessionId: string; provider: string }
  | { type: "approval_requested"; description: string; sessionId: string }
  | { type: "approval_received"; approved: boolean; reason?: string; sessionId?: string };

/** Connection lifecycle states for the GUI session WebSocket client. */
export type GuiSessionConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
