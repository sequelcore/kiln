import type { KilnEventData } from "./types.js";

export interface SseCallbacks {
  onEvent(event: KilnEventData): void;
  onConnect(): void;
  onDisconnect(): void;
}

export class SseClient {
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectDelay = 3000;

  constructor(
    private readonly url: string,
    private readonly callbacks: SseCallbacks,
  ) {}

  connect(): void {
    if (this.source) return;

    this.source = new EventSource(this.url);

    this.source.onopen = () => {
      this.callbacks.onConnect();
    };

    this.source.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as KilnEventData;
        this.callbacks.onEvent(data);
      } catch {
        // Ignore malformed events
      }
    };

    this.source.onerror = () => {
      this.disconnect();
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
      this.callbacks.onDisconnect();
    }
  }
}
