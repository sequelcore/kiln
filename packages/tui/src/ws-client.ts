/**
 * @fileoverview TUI WebSocket client for gateway communication.
 * @module @kilnai/tui
 */
import type {
  GuiProviderModelDiscoveryProjection,
  OperatorActivityPhaseFrame,
  OperatorExecutionMode,
  OperatorSessionEvent,
  OperatorThemeScope,
  OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";

/**
 * Inbound frames the TUI gateway sends.
 */
export interface TuiProviderModelCapabilities {
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
  readonly defaultReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly supportedReasoningEfforts?: ("minimal" | "low" | "medium" | "high" | "xhigh")[];
}

export interface TuiProviderDiscoveryFrame {
  readonly provider: string;
  readonly available: boolean;
  readonly models: string[];
  readonly modelCapabilities?: Record<string, TuiProviderModelCapabilities>;
  readonly status: string;
  readonly reason: string;
  readonly authState: string;
  readonly lastCheckedAt: string;
}

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
  | {
      type: "done";
      sourceMessageId?: string;
      content: string;
      parts?: unknown[];
      inputTokens: number;
      outputTokens: number;
      outcome: "completed" | "failed" | "cancelled" | "paused";
      routedProvider?: string;
      routedModel?: string;
      runtimeContinuity?: {
        strategy: string;
        feedbackLabel?: string;
        pressure?: string;
        supportArtifactCount?: number;
        supportArtifactSources?: string[];
        fallbackLabel?: string;
        usedCachedSupport?: boolean;
        selectionReason?: string;
      };
    }
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
      greeting?: string;
      models?: Record<string, string[]>;
      providerModelDiscovery: GuiProviderModelDiscoveryProjection;
      providerDiscovery?: TuiProviderDiscoveryFrame[];
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
  | {
      type: "provider_auth_completed";
      provider: string;
      requestId: string;
      providerModelDiscovery: GuiProviderModelDiscoveryProjection;
      models: Record<string, string[]>;
      providerDiscovery: TuiProviderDiscoveryFrame[];
    }
  | { type: "provider_auth_failed"; provider: string; requestId: string; message: string }
  | {
      type: "providers_refreshed";
      providerModelDiscovery: GuiProviderModelDiscoveryProjection;
      models: Record<string, string[]>;
      providerDiscovery: TuiProviderDiscoveryFrame[];
    }
  | { type: "provider_changed"; provider: string; model?: string; requestId: string }
  | {
      type: "operator_theme_set";
      requestId: string;
      theme: string;
      scope: OperatorThemeScope;
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
      reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    }
  | { type: "voice_synthesis_request"; requestId: string; sourceMessageId: string }
  | { type: "clear" }
  | { type: "refresh_providers" }
  | { type: "provider_auth"; provider: string; requestId: string; apiKey?: string; tier?: "go" | "zen" }
  | { type: "provider"; provider: string; model?: string; requestId: string }
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
        const frame = JSON.parse(raw) as TuiInboundFrame;
        this.options.onMessage(frame);
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
