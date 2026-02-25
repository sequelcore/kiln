import type { KilnEventData } from "./types.js";

// All named event types emitted by the /dev/events SSE endpoint.
// Must stay in sync with EventType in @kilnai/core events/index.ts.
const SSE_EVENT_TYPES = [
  "phase_changed", "task_started", "task_completed", "tool_called", "tool_result",
  "thinking", "verification_result", "cost_update", "memory_saved", "memory_recalled",
  "memory_sync", "approval_requested", "approval_received", "worker_assigned", "error",
  "trace_span", "handoff_requested", "handoff_completed", "interrupt_requested", "interrupt_resumed",
  "injection_scanned", "guardian_reviewed", "audit_entry", "tenant_isolation_violation", "security_alert",
  "webhook_received", "trigger_fired", "trigger_failed", "schedule_fired",
  "pii_detected", "content_classified", "policy_evaluated",
] as const;

export interface SseCallbacks {
  onEvent(event: KilnEventData): void;
  onConnect(): void;
  onDisconnect(): void;
}

const DEFAULT_RECONNECT_DELAY_MS = 3000;

export class SseClient {
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectDelay: number;

  constructor(
    private readonly url: string,
    private readonly callbacks: SseCallbacks,
    reconnectDelayMs?: number,
  ) {
    this.reconnectDelay = reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  connect(): void {
    if (this.source) return;

    this.source = new EventSource(this.url);

    this.source.onopen = () => {
      this.callbacks.onConnect();
    };

    // Named events (event: <type>\ndata: ...) require addEventListener.
    // onmessage only fires for unnamed events (bare data: lines).
    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as KilnEventData;
        this.callbacks.onEvent(data);
      } catch {
        // Ignore malformed events
      }
    };

    for (const type of SSE_EVENT_TYPES) {
      this.source.addEventListener(type, handleEvent);
    }

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
