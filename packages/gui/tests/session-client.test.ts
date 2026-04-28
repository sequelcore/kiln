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
    const frame = JSON.parse(data) as { type?: string; provider?: string; model?: string; requestId?: string };
    if (frame.type === "provider" && frame.provider === "openai" && frame.model === "gpt-5") {
      this.simulateMessage(JSON.stringify({
        type: "provider_changed",
        provider: "openai",
        model: "gpt-5",
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

function createClient(onFrame = vi.fn()): GuiSessionClient {
  return new GuiSessionClient({
    onFrame,
    resolveCandidateBaseUrls: () => ["http://localhost:4810"],
  });
}

function sentProviderFrame(ws: MockWebSocket, index: number): { provider: string; model?: string; requestId: string } {
  const raw = ws.send.mock.calls[index]?.[0];
  expect(typeof raw).toBe("string");
  const frame = JSON.parse(raw as string) as { type?: string; provider?: string; model?: string; requestId?: string };
  expect(frame.type).toBe("provider");
  expect(typeof frame.provider).toBe("string");
  expect(typeof frame.requestId).toBe("string");
  return frame as { provider: string; model?: string; requestId: string };
}

describe("GuiSessionClient provider switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects a pending provider switch from a mismatched provider_changed ack", async () => {
    const onFrame = vi.fn();
    const client = createClient(onFrame);
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = wsInstances[0];
    ws.simulateOpen();

    const promise = client.switchProvider("openai", "gpt-5-other");
    const request = sentProviderFrame(ws, 0);
    ws.simulateMessage(JSON.stringify({
      type: "provider_changed",
      provider: "claude",
      model: "claude-sonnet-4-6",
      requestId: request.requestId,
    }));

    await expect(promise).rejects.toThrow("Provider switch acknowledgement did not match the pending request");
    expect(onFrame).toHaveBeenCalledWith({
      type: "provider_changed",
      provider: "claude",
      model: "claude-sonnet-4-6",
      requestId: request.requestId,
    });
  });

  it("resolves a synchronous matching provider_changed ack without arming a stale timeout", async () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = wsInstances[0];
    ws.simulateOpen();

    const promise = client.switchProvider("openai", "gpt-5");

    await expect(promise).resolves.toBe("openai");

    vi.advanceTimersByTime(5_000);

    expect(sentProviderFrame(ws, 0)).toMatchObject({
      provider: "openai",
      model: "gpt-5",
    });
  });

  it("resolves model-less provider switches when the acknowledgement omits model", async () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = wsInstances[0];
    ws.simulateOpen();

    const promise = client.switchProvider("claude");
    const request = sentProviderFrame(ws, 0);
    ws.simulateMessage(JSON.stringify({
      type: "provider_changed",
      provider: "claude",
      requestId: request.requestId,
    }));

    await expect(promise).resolves.toBe("claude");
    expect(request).toMatchObject({
      provider: "claude",
    });
    expect(request).not.toHaveProperty("model");
  });

  it("rejects a retry from a stale ack for the same provider with a different model", async () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = wsInstances[0];
    ws.simulateOpen();

    const firstPromise = client.switchProvider("openai", "gpt-5-previous");
    sentProviderFrame(ws, 0);

    vi.advanceTimersByTime(5_000);
    await expect(firstPromise).rejects.toThrow("Provider switch timed out");

    const retryPromise = client.switchProvider("openai", "gpt-5-current");
    const retryFrame = sentProviderFrame(ws, 1);

    ws.simulateMessage(JSON.stringify({
      type: "provider_changed",
      provider: "openai",
      model: "gpt-5-previous",
      requestId: retryFrame.requestId,
    }));

    expect(retryFrame).toMatchObject({
      provider: "openai",
      model: "gpt-5-current",
    });
    await expect(retryPromise).rejects.toThrow("Provider switch acknowledgement did not match the pending request");
  });

  it("closes heartbeat timeouts with the reconnectable pong timeout code", () => {
    const client = createClient();
    client.connect();
    vi.advanceTimersByTime(0);
    const ws = wsInstances[0];
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
    const ws = wsInstances[0];
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
