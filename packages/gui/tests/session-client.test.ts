import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuiSessionClient } from "../src/api/session-client.js";

let wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((this: MockWebSocket, ev: Event) => void) | null = null;
  onmessage: ((this: MockWebSocket, ev: MessageEvent) => void) | null = null;
  onclose: ((this: MockWebSocket, ev: CloseEvent) => void) | null = null;
  onerror: ((this: MockWebSocket, ev: Event) => void) | null = null;

  readonly send = vi.fn((data: string) => {
    if (data === "ping") return;
    const frame = JSON.parse(data) as { type?: string; routeId?: string; requestId?: string };
    if (frame.type === "execution_route" && frame.routeId === "terra") {
      this.simulateMessage(JSON.stringify({
        type: "execution_route_changed",
        routeId: "terra",
        requestId: frame.requestId,
      }));
    }
  });

  readonly close = vi.fn();

  constructor(readonly url: string) {
    wsInstances.push(this);
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.call(this, new Event("open"));
  }

  simulateMessage(data: string): void {
    this.onmessage?.call(this, new MessageEvent("message", { data }));
  }
}

function firstWebSocket(): MockWebSocket {
  expect(wsInstances).not.toHaveLength(0);
  const ws = wsInstances[0];
  if (!ws) {
    throw new Error("Expected a created WebSocket instance");
  }
  return ws;
}

function createClient(onFrame = vi.fn()): GuiSessionClient {
  return new GuiSessionClient({
    onFrame,
    resolveCandidateBaseUrls: () => ["http://localhost:4810"],
  });
}

function sentRouteFrame(ws: MockWebSocket, index: number): { routeId: string; accountOverrideId?: string; requestId: string } {
  const raw = ws.send.mock.calls[index]?.[0];
  expect(typeof raw).toBe("string");
  const frame = JSON.parse(raw as string) as { type?: string; routeId?: string; accountOverrideId?: string; requestId?: string };
  expect(frame.type).toBe("execution_route");
  expect(typeof frame.routeId).toBe("string");
  expect(typeof frame.requestId).toBe("string");
  return frame as { routeId: string; accountOverrideId?: string; requestId: string };
}

describe("GuiSessionClient execution target selection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects a pending route switch from a mismatched acknowledgement", async () => {
    const onFrame = vi.fn();
    const client = createClient(onFrame);
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = firstWebSocket();
    ws.simulateOpen();

    const promise = client.switchExecutionRoute("terra-other");
    const request = sentRouteFrame(ws, 0);
    ws.simulateMessage(JSON.stringify({
      type: "execution_route_changed",
      routeId: "other",
      requestId: request.requestId,
    }));

    await expect(promise).rejects.toThrow("Execution target acknowledgement did not match the pending request");
    expect(onFrame).toHaveBeenCalledWith({
      type: "execution_route_changed",
      routeId: "other",
      requestId: request.requestId,
    });
  });

  it("resolves a synchronous matching route acknowledgement without arming a stale timeout", async () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = firstWebSocket();
    ws.simulateOpen();

    const promise = client.switchExecutionRoute("terra");

    await expect(promise).resolves.toBe("terra");

    vi.advanceTimersByTime(5_000);

    expect(sentRouteFrame(ws, 0)).toMatchObject({
      routeId: "terra",
    });
  });

  it("preserves an explicit account override", async () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = firstWebSocket();
    ws.simulateOpen();

    const promise = client.switchExecutionRoute("terra-work", "work");
    const request = sentRouteFrame(ws, 0);
    ws.simulateMessage(JSON.stringify({
      type: "execution_route_changed",
      routeId: "terra-work",
      requestId: request.requestId,
    }));

    await expect(promise).resolves.toBe("terra-work");
    expect(request).toMatchObject({
      routeId: "terra-work",
      accountOverrideId: "work",
    });
  });

  it("rejects a retry from a stale route acknowledgement", async () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = firstWebSocket();
    ws.simulateOpen();

    const firstPromise = client.switchExecutionRoute("previous");
    sentRouteFrame(ws, 0);

    vi.advanceTimersByTime(5_000);
    await expect(firstPromise).rejects.toThrow("Execution target switch timed out");

    const retryPromise = client.switchExecutionRoute("current");
    const retryFrame = sentRouteFrame(ws, 1);

    ws.simulateMessage(JSON.stringify({
      type: "execution_route_changed",
      routeId: "previous",
      requestId: retryFrame.requestId,
    }));

    expect(retryFrame).toMatchObject({
      routeId: "current",
    });
    await expect(retryPromise).rejects.toThrow("Execution target acknowledgement did not match the pending request");
  });

  it("closes heartbeat timeouts with the reconnectable pong timeout code", () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = firstWebSocket();
    ws.simulateOpen();

    vi.advanceTimersByTime(30_000);
    expect(ws.send).toHaveBeenCalledWith("ping");

    vi.advanceTimersByTime(30_000);

    expect(ws.close).toHaveBeenCalledWith(4000, "pong timeout");
  });

  it("does not close after pong clears the outstanding heartbeat watchdog", () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = firstWebSocket();
    ws.simulateOpen();

    vi.advanceTimersByTime(30_000);
    expect(ws.send).toHaveBeenCalledWith("ping");

    ws.simulateMessage("pong");
    vi.advanceTimersByTime(30_000);
    ws.simulateMessage("pong");
    vi.advanceTimersByTime(30_000);

    expect(ws.close).not.toHaveBeenCalledWith(4000, "pong timeout");
  });
});
