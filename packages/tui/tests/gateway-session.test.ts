import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewaySession } from "../src/gateway-session.js";
import { setTuiOperatorThemeHandler } from "../src/operator-theme-handler.js";

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

  readonly send = vi.fn();
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

function sentProviderFrame(ws: MockWebSocket): { provider: string; model?: string; requestId: string } {
  const providerCall = ws.send.mock.calls.find(([payload]) => {
    if (typeof payload !== "string" || payload === "ping") return false;
    return (JSON.parse(payload) as { type?: string }).type === "provider";
  });
  expect(providerCall).toBeDefined();
  const frame = JSON.parse(providerCall?.[0] as string) as { type?: string; provider?: string; model?: string; requestId?: string };
  expect(frame.type).toBe("provider");
  expect(typeof frame.provider).toBe("string");
  expect(typeof frame.requestId).toBe("string");
  expect(frame.requestId?.trim()).not.toBe("");
  return frame as { provider: string; model?: string; requestId: string };
}

function sentProviderAuthFrame(ws: MockWebSocket): { provider: string; apiKey?: string; tier?: "go" | "zen"; requestId: string } {
  const providerCall = ws.send.mock.calls.find(([payload]) => {
    if (typeof payload !== "string" || payload === "ping") return false;
    return (JSON.parse(payload) as { type?: string }).type === "provider_auth";
  });
  expect(providerCall).toBeDefined();
  const frame = JSON.parse(providerCall?.[0] as string) as {
    type?: string;
    provider?: string;
    apiKey?: string;
    tier?: "go" | "zen";
    requestId?: string;
  };
  expect(frame.type).toBe("provider_auth");
  expect(typeof frame.provider).toBe("string");
  expect(typeof frame.requestId).toBe("string");
  expect(frame.requestId?.trim()).not.toBe("");
  return frame as { provider: string; apiKey?: string; tier?: "go" | "zen"; requestId: string };
}

function sentOperatorThemeResultFrame(ws: MockWebSocket): {
  requestId: string;
  ok: boolean;
  appliedTheme?: string;
  error?: string;
} {
  const themeCall = ws.send.mock.calls.find(([payload]) => {
    if (typeof payload !== "string" || payload === "ping") return false;
    return (JSON.parse(payload) as { type?: string }).type === "operator_theme_set_result";
  });
  expect(themeCall).toBeDefined();
  const frame = JSON.parse(themeCall?.[0] as string) as {
    type?: string;
    requestId?: string;
    ok?: boolean;
    appliedTheme?: string;
    error?: string;
  };
  expect(frame.type).toBe("operator_theme_set_result");
  expect(typeof frame.requestId).toBe("string");
  expect(typeof frame.ok).toBe("boolean");
  return frame as { requestId: string; ok: boolean; appliedTheme?: string; error?: string };
}

describe("GatewaySession provider switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects immediately when provider_changed does not match the pending request", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const promise = session.switchProvider("openai", "gpt-5");
    await Promise.resolve();

    const frame = sentProviderFrame(ws);
    expect(frame).toMatchObject({
      provider: "openai",
      model: "gpt-5",
    });

    ws.simulateMessage(JSON.stringify({
      type: "provider_changed",
      provider: "openai",
      requestId: "stale-request",
      model: "gpt-5",
    }));

    await expect(promise).rejects.toThrow("Provider switch acknowledgement did not match the pending request");
    await session.dispose();
  });

  it("sends a requestId and resolves the matching provider_changed acknowledgement", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const promise = session.switchProvider("openai", "gpt-5");
    await Promise.resolve();

    const frame = sentProviderFrame(ws);
    ws.simulateMessage(JSON.stringify({
      type: "provider_changed",
      provider: "openai",
      requestId: frame.requestId,
      model: "gpt-5",
    }));

    await expect(promise).resolves.toBe("openai");
    await session.dispose();
  });

  it("rejects a pending provider switch immediately when the gateway returns an error frame", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const promise = session.switchProvider("openai", "gpt-5");
    await Promise.resolve();

    sentProviderFrame(ws);

    let rejection: Error | null = null;
    promise.catch((error: Error) => {
      rejection = error;
      return "";
    });

    ws.simulateMessage(JSON.stringify({
      type: "error",
      message: "Provider switch failed",
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection?.message).toBe("Provider switch failed");
    await expect(promise).rejects.toThrow("Provider switch failed");
    await session.dispose();
  });

  it("rejects missing models for non-modeless providers and allows modeless provider-only switches", async () => {
    const disconnectedSession = new GatewaySession("ws://localhost:4801/tui/ws");
    const disconnectedWs = wsInstances[0];

    await expect(disconnectedSession.switchProvider("openai", "gpt-5")).rejects.toThrow("active TUI gateway connection");
    expect(disconnectedWs.send).not.toHaveBeenCalled();

    disconnectedWs.simulateOpen();

    await expect(disconnectedSession.switchProvider("openai")).rejects.toThrow("Provider 'openai' requires a selected model.");
    expect(disconnectedWs.send).not.toHaveBeenCalledWith(expect.stringContaining("\\\"type\\\":\\\"provider\\\""));

    const modelessSwitch = disconnectedSession.switchProvider("claude");
    await Promise.resolve();

    const modelessFrame = sentProviderFrame(disconnectedWs);
    expect(modelessFrame).toMatchObject({
      provider: "claude",
    });
    expect(modelessFrame).not.toHaveProperty("model");

    disconnectedWs.simulateMessage(JSON.stringify({
      type: "provider_changed",
      provider: "claude",
      requestId: modelessFrame.requestId,
    }));

    await expect(modelessSwitch).resolves.toBe("claude");
    await disconnectedSession.dispose();
  });
});

describe("GatewaySession provider authentication", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends provider_auth and resolves matching completion", async () => {
    const onWelcome = vi.fn();
    const session = new GatewaySession("ws://localhost:4801/tui/ws", onWelcome);
    const ws = wsInstances[0];
    ws.simulateOpen();

    const promise = session.authenticateProvider("opencode-go", { apiKey: "sk-test", tier: "go" });
    await Promise.resolve();

    const frame = sentProviderAuthFrame(ws);
    expect(frame).toMatchObject({
      provider: "opencode-go",
      apiKey: "sk-test",
      tier: "go",
    });

    ws.simulateMessage(JSON.stringify({
      type: "provider_auth_completed",
      provider: "opencode-go",
      requestId: frame.requestId,
      models: { "opencode-go": ["minimax-m2.5"] },
      providerDiscovery: [],
    }));

    await expect(promise).resolves.toBeUndefined();
    expect(onWelcome).toHaveBeenCalledWith({ "opencode-go": ["minimax-m2.5"] }, []);
    await session.dispose();
  });

  it("forwards device code auth start details before completion", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    const onStarted = vi.fn();
    ws.simulateOpen();

    const promise = session.authenticateProvider("codex-oauth", { onStarted });
    await Promise.resolve();

    const frame = sentProviderAuthFrame(ws);
    ws.simulateMessage(JSON.stringify({
      type: "provider_auth_started",
      provider: "codex-oauth",
      requestId: frame.requestId,
      method: "device_code",
      verificationUri: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
    }));

    expect(onStarted).toHaveBeenCalledWith({
      verificationUri: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
      message: undefined,
    });

    ws.simulateMessage(JSON.stringify({
      type: "provider_auth_completed",
      provider: "codex-oauth",
      requestId: frame.requestId,
      models: { "codex-oauth": ["gpt-5.4"] },
      providerDiscovery: [],
    }));

    await expect(promise).resolves.toBeUndefined();
    await session.dispose();
  });
});

describe("GatewaySession operator theme frames", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("applies operator theme requests through the registered TUI handler", async () => {
    const applyTheme = vi.fn().mockResolvedValue({ ok: true, appliedTheme: "dracula" });
    const clearHandler = setTuiOperatorThemeHandler(applyTheme);
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage(JSON.stringify({
      type: "operator_theme_set",
      requestId: "theme-1",
      theme: "dracula",
      scope: "session",
      reason: "test",
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(applyTheme).toHaveBeenCalledWith({
      theme: "dracula",
      scope: "session",
      reason: "test",
    });
    await vi.waitFor(() => {
      expect(ws.send.mock.calls.some(([payload]) => (
        typeof payload === "string"
        && payload !== "ping"
        && (JSON.parse(payload) as { type?: string }).type === "operator_theme_set_result"
      ))).toBe(true);
    });
    expect(sentOperatorThemeResultFrame(ws)).toMatchObject({
      requestId: "theme-1",
      ok: true,
      appliedTheme: "dracula",
    });

    clearHandler();
    await session.dispose();
  });
});
