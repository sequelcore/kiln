/**
 * @fileoverview TUI WebSocket client for gateway communication.
 * @module @kilnai/tui
 */
/**
 * Inbound frames the TUI gateway sends.
 */
export type TuiInboundFrame =
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
      type: "done";
      content: string;
      parts?: unknown[];
      inputTokens: number;
      outputTokens: number;
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
  | { type: "error"; message: string; code?: string }
  | { type: "welcome"; greeting?: string; models?: Record<string, string[]>; planMode?: boolean }
  | { type: "exec_confirmed" } // Plan mode exit confirmed, execution can proceed
  | { type: "cleared" }
  | { type: "provider_changed"; provider: string }
  | { type: "approval_requested"; description: string; sessionId: string }
  | { type: "approval_received"; approved: boolean; reason?: string; sessionId?: string };

/**
 * Outbound frames the TUI sends to the gateway.
 */
export type TuiOutboundFrame =
  | { type: "message"; content: string }
  | { type: "clear" }
  | { type: "provider"; provider: string; model?: string }
  | { type: "approve"; sessionId?: string }
  | { type: "reject"; reason: string; sessionId?: string }
  | { type: "exec" }; // Exit plan mode and execute

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
        this.heartbeatTimeoutTimer = setTimeout(() => {
          // No pong received — close and reconnect
          this.ws?.close();
        }, HEARTBEAT_TIMEOUT_MS - HEARTBEAT_INTERVAL_MS);
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    // Exponential backoff, capped at max
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }
}
