import type { WsInboundFrame, WsOutboundFrame, VisitorInfo, ConnectionStatus } from "./types.js";

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private intentionalClose = false;
  private messageHandler: ((frame: WsInboundFrame) => void) | null = null;
  private statusHandler: ((status: ConnectionStatus) => void) | null = null;
  private readonly url: string;
  readonly userId: string;

  constructor(gatewayUrl: string, appName: string, widgetId: string) {
    const protocol = gatewayUrl.startsWith("https") ? "wss" : "ws";
    const host = gatewayUrl.replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "");

    const storageKey = `kiln_uid_${widgetId}`;
    this.userId = localStorage.getItem(storageKey) ?? crypto.randomUUID();
    localStorage.setItem(storageKey, this.userId);

    this.url = `${protocol}://${host}/apps/${appName}/ws?widgetId=${widgetId}&userId=${encodeURIComponent(this.userId)}`;
  }

  connect(): void {
    this.intentionalClose = false;
    this.setStatus("connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.setStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string);
        // Respond to server heartbeat pings with a pong
        if (parsed.type === "ping") {
          try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* closing */ }
          return;
        }
        this.messageHandler?.(parsed as WsInboundFrame);
      } catch {
        // Discard malformed frames
      }
    };

    ws.onerror = () => this.setStatus("error");

    ws.onclose = () => {
      this.ws = null;
      if (!this.intentionalClose) {
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    };
  }

  send(content: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame: WsOutboundFrame = { type: "message", content };
    this.ws.send(JSON.stringify(frame));
  }

  identify(visitor: VisitorInfo): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame: WsOutboundFrame = { type: "identify", visitor };
    this.ws.send(JSON.stringify(frame));
  }

  onMessage(handler: (frame: WsInboundFrame) => void): void {
    this.messageHandler = handler;
  }

  onStatusChange(handler: (status: ConnectionStatus) => void): void {
    this.statusHandler = handler;
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private setStatus(status: ConnectionStatus): void {
    this.statusHandler?.(status);
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}
