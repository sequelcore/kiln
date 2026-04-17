export type GuiOutboundFrame =
  | { type: "message"; content: string }
  | { type: "clear" }
  | { type: "provider"; provider: string; model?: string }
  | { type: "resume"; sessionId: string; provider: string }
  | { type: "approve"; sessionId?: string }
  | { type: "reject"; reason: string; sessionId?: string }
  | { type: "exec" };

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
  | { type: "text_delta"; content: string }
  | { type: "error"; message: string; code?: string }
  | { type: "welcome"; greeting?: string; models?: Record<string, string[]>; planMode?: boolean }
  | { type: "exec_confirmed" }
  | { type: "cleared" }
  | { type: "provider_changed"; provider: string }
  | { type: "resume_selected"; sessionId: string; provider: string }
  | { type: "approval_requested"; description: string; sessionId: string }
  | { type: "approval_received"; approved: boolean; reason?: string; sessionId?: string };

export type GuiSessionConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface GuiSessionClientOptions {
  readonly baseUrl?: string;
  readonly onFrame: (frame: GuiInboundFrame) => void;
  readonly onConnectionStateChange?: (state: GuiSessionConnectionState) => void;
  readonly onError?: (error: Error) => void;
  readonly resolveCandidateBaseUrls: () => string[];
}

interface PendingPromise<T> {
  readonly timerId: number;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const ACK_TIMEOUT_MS = 5_000;

export class GuiSessionClient {
  private ws: WebSocket | null = null;
  private connectTimeoutId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private heartbeatTimeoutId: number | null = null;
  private reconnectTimeoutId: number | null = null;
  private reconnectDelayMs = RECONNECT_MIN_MS;
  private stopped = true;
  private wsUrls: readonly string[] = [];
  private wsUrlIndex = 0;
  private pendingClear: PendingPromise<void> | null = null;
  private pendingProviderChange: PendingPromise<string> | null = null;
  private pendingResumeSelection: PendingPromise<{ sessionId: string; provider: string }> | null = null;

  constructor(private readonly options: GuiSessionClientOptions) {
    this.refreshSocketUrls();
  }

  connect(): void {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.reconnectDelayMs = RECONNECT_MIN_MS;
    this.connectTimeoutId = window.setTimeout(() => {
      this.connectTimeoutId = null;
      if (this.stopped) {
        return;
      }
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
    if (this.pendingClear) {
      throw new Error("Clear session already in flight");
    }

    this.send({ type: "clear" });
    return new Promise<void>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        this.pendingClear = null;
        reject(new Error("Clear session timed out"));
      }, ACK_TIMEOUT_MS);

      this.pendingClear = { timerId, resolve, reject };
    });
  }

  switchProvider(provider: string, model?: string): Promise<string> {
    if (this.pendingProviderChange) {
      throw new Error("Provider switch already in flight");
    }

    this.send({ type: "provider", provider, ...(model ? { model } : {}) });
    return new Promise<string>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        this.pendingProviderChange = null;
        reject(new Error("Provider switch timed out"));
      }, ACK_TIMEOUT_MS);

      this.pendingProviderChange = { timerId, resolve, reject };
    });
  }

  selectResumeSession(sessionId: string, provider: string): Promise<{ sessionId: string; provider: string }> {
    if (this.pendingResumeSelection) {
      throw new Error("Resume selection already in flight");
    }

    if (sessionId.trim().length === 0 || provider.trim().length === 0) {
      throw new Error("Resume selection requires sessionId and provider");
    }

    this.send({ type: "resume", sessionId, provider });
    return new Promise<{ sessionId: string; provider: string }>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        this.pendingResumeSelection = null;
        reject(new Error("Resume selection timed out"));
      }, ACK_TIMEOUT_MS);

      this.pendingResumeSelection = { timerId, resolve, reject };
    });
  }

  approve(sessionId?: string): void {
    this.send({ type: "approve", sessionId });
  }

  reject(reason: string, sessionId?: string): void {
    this.send({ type: "reject", reason, sessionId });
  }

  executePlanMode(): void {
    this.send({ type: "exec" });
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
      this.reconnectDelayMs = RECONNECT_MIN_MS;
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

    if (frame.type === "provider_changed" && this.pendingProviderChange) {
      window.clearTimeout(this.pendingProviderChange.timerId);
      this.pendingProviderChange.resolve(frame.provider);
      this.pendingProviderChange = null;
    }

    if (frame.type === "resume_selected" && this.pendingResumeSelection) {
      window.clearTimeout(this.pendingResumeSelection.timerId);
      this.pendingResumeSelection.resolve({ sessionId: frame.sessionId, provider: frame.provider });
      this.pendingResumeSelection = null;
    }

    if (frame.type === "error") {
      if (this.pendingClear) {
        window.clearTimeout(this.pendingClear.timerId);
        this.pendingClear.reject(new Error(frame.message));
        this.pendingClear = null;
      }
      if (this.pendingProviderChange) {
        window.clearTimeout(this.pendingProviderChange.timerId);
        this.pendingProviderChange.reject(new Error(frame.message));
        this.pendingProviderChange = null;
      }
      if (this.pendingResumeSelection) {
        window.clearTimeout(this.pendingResumeSelection.timerId);
        this.pendingResumeSelection.reject(new Error(frame.message));
        this.pendingResumeSelection = null;
      }
    }

    this.options.onFrame(frame);
  }

  private send(frame: GuiOutboundFrame): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("GUI session socket is not connected");
    }
    this.ws.send(JSON.stringify(frame));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatIntervalId = window.setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        return;
      }
      this.ws.send("ping");
      this.heartbeatTimeoutId = window.setTimeout(() => {
        this.ws?.close();
      }, HEARTBEAT_TIMEOUT_MS - HEARTBEAT_INTERVAL_MS);
    }, HEARTBEAT_INTERVAL_MS);
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
    if (this.reconnectTimeoutId !== null || this.stopped) {
      return;
    }

    this.emitConnection("reconnecting");
    const timeoutMs = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
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
    if (!next) {
      throw new Error("No GUI WebSocket endpoint available");
    }
    this.wsUrlIndex = (this.wsUrlIndex + 1) % this.wsUrls.length;
    return next;
  }

  private refreshSocketUrls(): void {
    const candidateBaseUrls = this.options.resolveCandidateBaseUrls();
    const wsUrls = candidateBaseUrls.map((baseUrl) => toWebSocketUrl(baseUrl));
    if (wsUrls.length === 0) {
      throw new Error("No GUI WebSocket candidates available");
    }
    this.wsUrls = wsUrls;
    if (this.wsUrlIndex >= this.wsUrls.length) {
      this.wsUrlIndex = 0;
    }
  }

  private rejectPending(error: Error): void {
    if (this.pendingClear) {
      window.clearTimeout(this.pendingClear.timerId);
      this.pendingClear.reject(error);
      this.pendingClear = null;
    }

    if (this.pendingProviderChange) {
      window.clearTimeout(this.pendingProviderChange.timerId);
      this.pendingProviderChange.reject(error);
      this.pendingProviderChange = null;
    }

    if (this.pendingResumeSelection) {
      window.clearTimeout(this.pendingResumeSelection.timerId);
      this.pendingResumeSelection.reject(error);
      this.pendingResumeSelection = null;
    }
  }
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL("/gui/ws", baseUrl);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    url.protocol = "ws:";
  }
  return url.toString();
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.length > 0) {
    return new Error(error);
  }
  return new Error(fallbackMessage);
}
