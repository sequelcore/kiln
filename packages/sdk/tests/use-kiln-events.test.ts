import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { KilnProvider } from "../src/provider.js";
import { useKilnEvents } from "../src/use-kiln-events.js";
import type { KilnConfig, KilnEventData } from "../src/types.js";

// Capture the SseClient constructor args so we can drive callbacks
interface CapturedSse {
  url: string;
  onEvent: (event: KilnEventData) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  connectCalled: boolean;
  disconnectCalled: boolean;
}

let capturedSse: CapturedSse;

vi.mock("../src/sse-client.js", () => ({
  SseClient: class MockSseClient {
    constructor(url: string, callbacks: { onEvent: (e: KilnEventData) => void; onConnect: () => void; onDisconnect: () => void }) {
      capturedSse = {
        url,
        onEvent: callbacks.onEvent,
        onConnect: callbacks.onConnect,
        onDisconnect: callbacks.onDisconnect,
        connectCalled: false,
        disconnectCalled: false,
      };
    }
    connect() {
      capturedSse.connectCalled = true;
    }
    disconnect() {
      capturedSse.disconnectCalled = true;
    }
  },
}));

function createWrapper(config: KilnConfig) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(KilnProvider, { config }, children);
  };
}

describe("useKilnEvents", () => {
  const config: KilnConfig = {
    baseUrl: "http://localhost:4000",
    appName: "test-app",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with empty events array and disconnected", () => {
    const { result } = renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    expect(result.current.events).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it("calls SseClient.connect() on mount", () => {
    renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    expect(capturedSse.connectCalled).toBe(true);
  });

  it("constructs SSE URL from config.baseUrl + /dev/events", () => {
    renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    expect(capturedSse.url).toBe("http://localhost:4000/dev/events");
  });

  it("sets connected to true when onConnect fires", () => {
    const { result } = renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    act(() => {
      capturedSse.onConnect();
    });

    expect(result.current.connected).toBe(true);
  });

  it("sets connected to false when onDisconnect fires", () => {
    const { result } = renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    act(() => {
      capturedSse.onConnect();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      capturedSse.onDisconnect();
    });
    expect(result.current.connected).toBe(false);
  });

  it("appends events when onEvent fires", () => {
    const { result } = renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    const event1: KilnEventData = { type: "phase_changed", timestamp: "2025-01-01T00:00:00Z", data: { phase: "plan" } };
    const event2: KilnEventData = { type: "tool_called", timestamp: "2025-01-01T00:00:01Z", data: { tool: "read" } };

    act(() => {
      capturedSse.onEvent(event1);
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toEqual(event1);

    act(() => {
      capturedSse.onEvent(event2);
    });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[1]).toEqual(event2);
  });

  it("clear() empties the events array", () => {
    const { result } = renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    act(() => {
      capturedSse.onEvent({ type: "phase_changed", timestamp: "2025-01-01", data: {} });
      capturedSse.onEvent({ type: "error", timestamp: "2025-01-01", data: {} });
    });

    expect(result.current.events).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    expect(result.current.events).toHaveLength(0);
  });

  it("caps events at MAX_EVENTS (500) by trimming oldest", () => {
    const { result } = renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    act(() => {
      for (let i = 0; i < 502; i++) {
        capturedSse.onEvent({
          type: "cost_update",
          timestamp: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
          data: { index: i },
        });
      }
    });

    expect(result.current.events).toHaveLength(500);
    // Oldest 2 should have been dropped; first remaining is index 2
    expect(result.current.events[0].data.index).toBe(2);
    expect(result.current.events[499].data.index).toBe(501);
  });

  it("disconnects SSE on unmount", () => {
    const { unmount } = renderHook(() => useKilnEvents(), {
      wrapper: createWrapper(config),
    });

    unmount();

    expect(capturedSse.disconnectCalled).toBe(true);
  });
});
