import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SseClient } from "../src/sse-client.js";

class MockEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, ((e: { data: string }) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, handler: (e: { data: string }) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  dispatchNamed(type: string, data: string): void {
    const handlers = this.listeners.get(type) ?? [];
    for (const h of handlers) h({ data });
  }

  close() {
    this.closed = true;
  }
}

describe("SseClient", () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    // @ts-expect-error -- mock
    globalThis.EventSource = MockEventSource;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it("connects and calls onConnect", () => {
    const onConnect = vi.fn();
    const client = new SseClient("http://localhost/events", {
      onEvent: vi.fn(),
      onConnect,
      onDisconnect: vi.fn(),
    });

    client.connect();
    const source = (client as unknown as { source: MockEventSource }).source;
    source.onopen?.();
    expect(onConnect).toHaveBeenCalled();
    client.disconnect();
  });

  it("parses named SSE events via addEventListener", () => {
    const onEvent = vi.fn();
    const client = new SseClient("http://localhost/events", {
      onEvent,
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
    });

    client.connect();
    const source = (client as unknown as { source: MockEventSource }).source;
    source.dispatchNamed("phase_changed", JSON.stringify({ type: "phase_changed", timestamp: "2025-01-01", data: {} }));
    expect(onEvent).toHaveBeenCalledWith({ type: "phase_changed", timestamp: "2025-01-01", data: {} });
    client.disconnect();
  });

  it("handles all registered named event types", () => {
    const onEvent = vi.fn();
    const client = new SseClient("http://localhost/events", {
      onEvent,
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
    });

    client.connect();
    const source = (client as unknown as { source: MockEventSource }).source;

    const typesToCheck = ["cost_update", "tool_called", "memory_saved", "pii_detected"];
    for (const type of typesToCheck) {
      onEvent.mockClear();
      source.dispatchNamed(type, JSON.stringify({ type, timestamp: "2025-01-01", data: {} }));
      expect(onEvent).toHaveBeenCalledOnce();
    }

    client.disconnect();
  });

  it("ignores malformed event data", () => {
    const onEvent = vi.fn();
    const client = new SseClient("http://localhost/events", {
      onEvent,
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
    });

    client.connect();
    const source = (client as unknown as { source: MockEventSource }).source;
    source.dispatchNamed("phase_changed", "not-json");
    expect(onEvent).not.toHaveBeenCalled();
    client.disconnect();
  });

  it("disconnects and calls onDisconnect", () => {
    const onDisconnect = vi.fn();
    const client = new SseClient("http://localhost/events", {
      onEvent: vi.fn(),
      onConnect: vi.fn(),
      onDisconnect,
    });

    client.connect();
    client.disconnect();
    expect(onDisconnect).toHaveBeenCalled();
  });
});
