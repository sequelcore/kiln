import type { GuiOutboundFrame, GuiInboundFrame, GuiSessionConnectionState } from "@kilnai/gateway-contracts";

export type { GuiInboundFrame, GuiOutboundFrame, GuiSessionConnectionState };

export class GuiSessionClient {
  private ws: WebSocket | null = null;
  private connectTimeoutId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private heartbeatTimeoutId: number | null = null;
  private reconnectTimeoutId: number | null = null;
  private reconnectDelayMs = 1_000;
  private stopped = true;
  private wsUrls: readonly string[] = [];
  private wsUrlIndex = 0;
  private routeSwitchRequestOrdinal = 0;
  private pendingClear: { timerId: number; resolve: () => void; reject: (err: Error) => void } | null = null;
  private pendingRouteChange: {
    routeId: string;
    requestId: string;
    timerId: number;
    resolve: (v: string) => void;
    reject: (err: Error) => void;
  } | null = null;
  private pendingContinuationSelection: { timerId: number; resolve: (v: { sessionId: string }) => void; reject: (err: Error) => void } | null = null;

  private readonly HEARTBEAT_INTERVAL_MS = 30_000;
  private readonly HEARTBEAT_TIMEOUT_MS = 60_000;
  private readonly RECONNECT_MAX_MS = 30_000;
  private readonly ACK_TIMEOUT_MS = 5_000;

  constructor(private readonly options: GuiSessionClientOptions) {
    this.refreshSocketUrls();
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.reconnectDelayMs = 1_000;
    this.connectTimeoutId = window.setTimeout(() => {
      this.connectTimeoutId = null;
      if (this.stopped) return;
      this.openSocket("connecting");
    }, 0);
  }

  disconnect(): void {
    this.stopped = true;
    this.clearConnectTimer();
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.rejectPending(new Error("GUI session disconnected"));
    this.ws?.close();
    this.ws = null;
    this.emitConnection("disconnected");
  }

  sendMessage(content: string): void {
    this.send({ type: "message", content });
  }

  clearSession(): Promise<void> {
    if (this.pendingClear) throw new Error("Clear session already in flight");
    this.send({ type: "clear" });
    return new Promise<void>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        this.pendingClear = null;
        reject(new Error("Clear session timed out"));
      }, this.ACK_TIMEOUT_MS);
      this.pendingClear = { timerId, resolve, reject };
    });
  }

  switchExecutionRoute(routeId: string, accountOverrideId?: string): Promise<string> {
    if (this.pendingRouteChange) throw new Error("Execution target switch already in flight");
    const requestId = `execution-route-${++this.routeSwitchRequestOrdinal}`;
    return new Promise<string>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        this.pendingRouteChange = null;
        reject(new Error("Execution target switch timed out"));
      }, this.ACK_TIMEOUT_MS);
      const pending = { routeId, requestId, timerId, resolve, reject };
      this.pendingRouteChange = pending;
      try {
        this.send({
          type: "execution_route",
          routeId,
          ...(accountOverrideId ? { accountOverrideId } : {}),
          requestId,
        });
      } catch (error) {
        if (this.pendingRouteChange === pending) {
          window.clearTimeout(timerId);
          this.pendingRouteChange = null;
          reject(toError(error, "Execution target switch failed"));
        }
      }
    });
  }

  selectContinuationSession(
    sessionId: string,
    options: { readonly gatewayTargetId?: string } = {},
  ): Promise<{ sessionId: string }> {
    if (this.pendingContinuationSelection) throw new Error("Resume selection already in flight");
    if (!sessionId.trim()) throw new Error("Resume selection requires sessionId");
    this.send({
      type: "continue",
      sessionId,
      ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
    });
    return new Promise<{ sessionId: string }>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        this.pendingContinuationSelection = null;
        reject(new Error("Resume selection timed out"));
      }, this.ACK_TIMEOUT_MS);
      this.pendingContinuationSelection = { timerId, resolve, reject };
    });
  }

  executePlanMode(): void {
    this.send({ type: "execution_mode_transition", toMode: "execute" });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private openSocket(connectionState: "connecting" | "reconnecting"): void {
    const wsUrl = this.nextSocketUrl();
    this.emitConnection(connectionState);
    try {
      this.ws = new WebSocket(wsUrl);
    } catch (error) {
      this.options.onError?.(toError(error, `Unable to open GUI socket at ${wsUrl}`));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelayMs = 1_000;
      this.wsUrlIndex = 0;
      this.startHeartbeat();
      this.emitConnection("connected");
    };

    this.ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      if (raw === "pong") {
        this.resetHeartbeatTimeout();
        return;
      }
      let frame: GuiInboundFrame | null = null;
      try {
        frame = JSON.parse(raw) as GuiInboundFrame;
      } catch {
        return;
      }
      this.handleFrame(frame);
    };

    this.ws.onerror = () => {
      this.options.onError?.(new Error("GUI WebSocket transport error"));
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.stopHeartbeat();
      this.rejectPending(new Error("GUI session connection closed"));
      if (this.stopped) {
        this.emitConnection("disconnected");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private handleFrame(frame: GuiInboundFrame): void {
    if (frame.type === "cleared" && this.pendingClear) {
      window.clearTimeout(this.pendingClear.timerId);
      this.pendingClear.resolve();
      this.pendingClear = null;
    }
    if (frame.type === "execution_route_changed" && this.pendingRouteChange) {
      if (frame.routeId === this.pendingRouteChange.routeId && frame.requestId === this.pendingRouteChange.requestId) {
        window.clearTimeout(this.pendingRouteChange.timerId);
        this.pendingRouteChange.resolve(frame.routeId);
        this.pendingRouteChange = null;
      } else {
        window.clearTimeout(this.pendingRouteChange.timerId);
        this.pendingRouteChange.reject(new Error("Execution target acknowledgement did not match the pending request"));
        this.pendingRouteChange = null;
      }
    }
    if (frame.type === "continuation_selected" && this.pendingContinuationSelection) {
      window.clearTimeout(this.pendingContinuationSelection.timerId);
      this.pendingContinuationSelection.resolve({ sessionId: frame.sessionId });
      this.pendingContinuationSelection = null;
    }
    if (frame.type === "error") {
      if (this.pendingClear) {
        window.clearTimeout(this.pendingClear.timerId);
        this.pendingClear.reject(new Error(frame.message));
        this.pendingClear = null;
      }
      if (this.pendingRouteChange) {
        window.clearTimeout(this.pendingRouteChange.timerId);
        this.pendingRouteChange.reject(new Error(frame.message));
        this.pendingRouteChange = null;
      }
      if (this.pendingContinuationSelection) {
        window.clearTimeout(this.pendingContinuationSelection.timerId);
        this.pendingContinuationSelection.reject(new Error(frame.message));
        this.pendingContinuationSelection = null;
      }
    }
    this.options.onFrame(frame);
  }

  private send(frame: GuiOutboundFrame): void {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error("GUI session socket is not connected");
    this.ws.send(JSON.stringify(frame));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatIntervalId = window.setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send("ping");
      if (this.heartbeatTimeoutId === null) {
        this.heartbeatTimeoutId = window.setTimeout(() => {
          this.ws?.close(4000, "pong timeout");
        }, this.HEARTBEAT_TIMEOUT_MS - this.HEARTBEAT_INTERVAL_MS);
      }
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId !== null) {
      window.clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
    if (this.heartbeatTimeoutId !== null) {
      window.clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutId !== null) {
      window.clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeoutId !== null || this.stopped) return;
    this.emitConnection("reconnecting");
    const timeoutMs = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.RECONNECT_MAX_MS);
    this.reconnectTimeoutId = window.setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.openSocket("reconnecting");
    }, timeoutMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimeoutId !== null) {
      window.clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimeoutId !== null) {
      window.clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
  }

  private emitConnection(state: GuiSessionConnectionState): void {
    this.options.onConnectionStateChange?.(state);
  }

  private nextSocketUrl(): string {
    this.refreshSocketUrls();
    const next = this.wsUrls[this.wsUrlIndex];
    if (!next) throw new Error("No GUI WebSocket endpoint available");
    this.wsUrlIndex = (this.wsUrlIndex + 1) % this.wsUrls.length;
    return next;
  }

  private refreshSocketUrls(): void {
    const candidateBaseUrls = this.options.resolveCandidateBaseUrls();
    const wsUrls = candidateBaseUrls.map((baseUrl) => toWebSocketUrl(baseUrl));
    if (wsUrls.length === 0) throw new Error("No GUI WebSocket candidates available");
    this.wsUrls = wsUrls;
    if (this.wsUrlIndex >= this.wsUrls.length) this.wsUrlIndex = 0;
  }

  private rejectPending(error: Error): void {
    if (this.pendingClear) {
      window.clearTimeout(this.pendingClear.timerId);
      this.pendingClear.reject(error);
      this.pendingClear = null;
    }
    if (this.pendingRouteChange) {
      window.clearTimeout(this.pendingRouteChange.timerId);
      this.pendingRouteChange.reject(error);
      this.pendingRouteChange = null;
    }
    if (this.pendingContinuationSelection) {
      window.clearTimeout(this.pendingContinuationSelection.timerId);
      this.pendingContinuationSelection.reject(error);
      this.pendingContinuationSelection = null;
    }
  }

}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL("/gui/ws", baseUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else url.protocol = "ws:";
  return url.toString();
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.length > 0) return new Error(error);
  return new Error(fallbackMessage);
}

export interface GuiSessionClientOptions {
  readonly baseUrl?: string;
  readonly onFrame: (frame: GuiInboundFrame) => void;
  readonly onConnectionStateChange?: (state: GuiSessionConnectionState) => void;
  readonly onError?: (error: Error) => void;
  readonly resolveCandidateBaseUrls: () => string[];
}
