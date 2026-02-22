import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SseClient } from "../src/sse-client.js";

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
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
    // Trigger onopen
    const source = (client as unknown as { source: MockEventSource }).source;
    source.onopen?.();
    expect(onConnect).toHaveBeenCalled();
    client.disconnect();
  });

  it("parses incoming events", () => {
    const onEvent = vi.fn();
    const client = new SseClient("http://localhost/events", {
      onEvent,
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
    });

    client.connect();
    const source = (client as unknown as { source: MockEventSource }).source;
    source.onmessage?.({ data: JSON.stringify({ type: "test", timestamp: "2025-01-01", data: {} }) });
    expect(onEvent).toHaveBeenCalledWith({ type: "test", timestamp: "2025-01-01", data: {} });
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
