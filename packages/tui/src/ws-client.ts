/**
 * @fileoverview TUI WebSocket client for gateway communication.
 * @module @kilnai/tui
 */
import type {
  GuiDoneFrameFields,
  GuiProviderModelCapabilities,
  GuiProviderDiscoveryResult,
  GuiProviderAuthCompleted,
  GuiProviderAuthFailed,
  GuiProviderCatalogStateFrame,
  ModelCatalog,
  ExecutionTargetChangeFailed,
  ExecutionTargetChanged,
  ExecutionTargetSelectionIntent,
  OperatorActivityPhaseFrame,
  OperatorExecutionMode,
  OperatorSessionEvent,
  OperatorTurnTerminalDisposition,
  OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";
import { OperatorTurnTerminalDispositionSchema } from "@kilnai/gateway-contracts";
import type { TuiDoneFrame } from "./types.js";

/**
 * Inbound frames the TUI gateway sends.
 */
export type TuiProviderModelCapabilities = GuiProviderModelCapabilities;
export type TuiProviderDiscoveryFrame = GuiProviderDiscoveryResult;

export type TuiInboundFrame =
  | { type: "thinking" }
  | { type: "session_event"; event: OperatorSessionEvent }
  | OperatorActivityPhaseFrame
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
  | TuiDoneFrame
  | {
      type: "voice_synthesis_completed";
      requestId: string;
      sourceMessageId: string;
      parts: unknown[];
    }
  | {
      type: "voice_synthesis_failed";
      requestId: string;
      sourceMessageId: string;
      message: string;
      code?: string;
    }
  | { type: "error"; message: string; code?: string }
  | {
      type: "welcome";
      modelCatalog: ModelCatalog;
      greeting?: string;
      executionMode?: OperatorExecutionMode;
    }
  | {
      type: "execution_mode_transitioned";
      executionMode: OperatorExecutionMode;
      planId?: string;
      approvalId?: string;
      planHash?: string;
    }
  | { type: "cleared" }
  | {
      type: "provider_auth_started";
      provider: string;
      requestId: string;
      method: "device_code";
      verificationUri: string;
      userCode: string;
      message?: string;
    }
  | GuiProviderAuthCompleted
  | GuiProviderAuthFailed
  | GuiProviderCatalogStateFrame
  | {
      type: "model_catalog_refreshed";
      requestId: string;
      modelCatalog: ModelCatalog;
    }
  | { type: "model_catalog_refresh_failed"; requestId: string; message: string }
  | ExecutionTargetChanged
  | ExecutionTargetChangeFailed
  | {
      type: "operator_theme_set";
      requestId: string;
      theme: string;
      reason?: string;
    }
  | { type: "approval_requested"; approvalId: string; description: string; sessionId: string }
  | { type: "approval_received"; approvalId: string; approved: boolean; reason?: string; sessionId?: string };

/**
 * Outbound frames the TUI sends to the gateway.
 */
export type TuiOutboundFrame =
  | {
      type: "message";
      content: string;
      executionMode?: OperatorExecutionMode;
      requestedAuthority?: OperatorTurnRequestedAuthority;
      deliberationIntent?: import("@kilnai/gateway-contracts").GuiDeliberationIntent;
      communicationIntent?: import("@kilnai/gateway-contracts").GuiCommunicationIntent;
    }
  | { type: "voice_synthesis_request"; requestId: string; sourceMessageId: string }
  | { type: "clear" }
  | { type: "refresh_model_catalog"; requestId: string }
  | { type: "provider_auth"; provider: string; requestId: string; apiKey?: string; tier?: "go" | "zen" }
  | ({ type: "execution_target"; requestId: string } & ExecutionTargetSelectionIntent)
  | { type: "operator_theme_set_result"; requestId: string; ok: boolean; appliedTheme?: string; error?: string }
  | { type: "approve"; approvalId: string }
  | { type: "reject"; reason: string; approvalId: string }
  | {
      type: "execution_mode_transition";
      toMode: OperatorExecutionMode;
      planId?: string;
      residualRiskAcknowledged?: boolean;
      residualRiskAcknowledgement?: string;
  };

const TUI_DONE_FRAME_KEYS = new Set([
  "type",
  "kilnSessionId",
  "sourceMessageId",
  "content",
  "parts",
  "admittedInput",
  "inputTokens",
  "outputTokens",
  "routedRouteId",
  "routedProvider",
  "routedModel",
  "routingRationale",
  "runtimeContinuity",
  "authorityStatus",
  "outcome",
  "dispositionReason",
  "completion",
  "convergence",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isRuntimeContinuity(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || typeof value.strategy !== "string") return false;
  return isOptionalString(value.feedbackLabel)
    && isOptionalString(value.pressure)
    && isOptionalFiniteNumber(value.supportArtifactCount)
    && (value.supportArtifactSources === undefined
      || (Array.isArray(value.supportArtifactSources)
        && value.supportArtifactSources.every((source) => typeof source === "string")))
    && isOptionalString(value.fallbackLabel)
    && (value.usedCachedSupport === undefined || typeof value.usedCachedSupport === "boolean")
    && isOptionalString(value.selectionReason);
}

function isDoneFrameFields(value: unknown): value is GuiDoneFrameFields {
  if (!isRecord(value)) return false;
  if (!Object.keys(value).every((key) => TUI_DONE_FRAME_KEYS.has(key))) return false;
  if (
    value.type !== "done"
    || typeof value.kilnSessionId !== "string"
    || value.kilnSessionId.trim().length === 0
    || typeof value.content !== "string"
    || typeof value.inputTokens !== "number"
    || !Number.isFinite(value.inputTokens)
    || typeof value.outputTokens !== "number"
    || !Number.isFinite(value.outputTokens)
    || !isOptionalString(value.sourceMessageId)
    || !isOptionalString(value.routedRouteId)
    || !isOptionalString(value.routedProvider)
    || !isOptionalString(value.routedModel)
    || (value.parts !== undefined && !Array.isArray(value.parts))
    || (value.admittedInput !== undefined
      && (!isRecord(value.admittedInput) || typeof value.admittedInput.content !== "string"))
    || !isRuntimeContinuity(value.runtimeContinuity)
  ) {
    return false;
  }
  return true;
}

/** Parse the exact shared terminal disposition carried by a TUI done frame. */
export function parseTuiDoneFrame(value: unknown): TuiDoneFrame | null {
  if (!isRecord(value) || !isDoneFrameFields(value)) return null;

  const dispositionInput: Record<string, unknown> = {
    outcome: value.outcome,
    dispositionReason: value.dispositionReason,
  };
  for (const field of ["completion", "convergence"] as const) {
    if (field in value) dispositionInput[field] = value[field];
  }
  const parsedDisposition = OperatorTurnTerminalDispositionSchema.safeParse(dispositionInput);
  if (!parsedDisposition.success) return null;

  return { ...value, ...parsedDisposition.data };
}

/**
 * Copy only the shared terminal disposition from a validated done frame.
 * The shared schema preserves reason/evidence correlation without recasting the frame.
 */
export function copyTuiTerminalDisposition(frame: TuiDoneFrame): OperatorTurnTerminalDisposition {
  const disposition: Record<string, unknown> = {
    outcome: frame.outcome,
    dispositionReason: frame.dispositionReason,
  };
  if ("completion" in frame) disposition.completion = frame.completion;
  if ("convergence" in frame) disposition.convergence = frame.convergence;
  return OperatorTurnTerminalDispositionSchema.parse(disposition);
}

/**
 * Configuration options for TuiWsClient.
 */
export interface TuiWsClientOptions {
  readonly url: string;
  readonly userId: string;
  readonly onMessage: (frame: TuiInboundFrame) => void;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
  readonly onError?: (err: Error) => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class TuiWsClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private stopped = false;

  constructor(private readonly options: TuiWsClientOptions) {}

  connect(): void {
    if (this.stopped) return;
    const wsUrl = `${this.options.url}?userId=${encodeURIComponent(this.options.userId)}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.startHeartbeat();
      this.options.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);

      // Handle WebSocket pong (heartbeat)
      if (raw === "pong") {
        this.resetHeartbeatTimeout();
        return;
      }

      try {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed) && parsed.type === "done") {
          const frame = parseTuiDoneFrame(parsed);
          if (frame === null) return;
          this.options.onMessage(frame);
          return;
        }
        this.options.onMessage(parsed as TuiInboundFrame);
      } catch {
        // Discard malformed frames
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.options.onClose?.();
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.options.onError?.(new Error("WebSocket error"));
    };
  }

  send(frame: TuiOutboundFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  disconnect(): void {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("ping");
        if (!this.heartbeatTimeoutTimer) {
          this.heartbeatTimeoutTimer = setTimeout(() => {
            // No pong received — close and reconnect
            this.ws?.close(4000, "pong timeout");
          }, HEARTBEAT_TIMEOUT_MS - HEARTBEAT_INTERVAL_MS);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    // Exponential backoff, capped at max
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }
}
