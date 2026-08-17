import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { KilnProvider } from "../src/provider.js";
import { useKilnWsChat } from "../src/use-kiln-ws-chat.js";
import type { KilnConfig } from "../src/types.js";

const communicationEvidence = {
  version: "v1",
  requestIndex: 0,
  providerId: "codex-oauth",
  modelId: "gpt-5.6-sol",
  finalPromptHash: `sha256:${"a".repeat(64)}`,
  estimatedTokens: 10,
  componentCount: 1,
  componentScopeCounts: { static: 1, dynamic: 0, deferred: 0 },
  effectivePrompt: {
    version: "v1",
    components: [{
      id: `sha256:${"b".repeat(64)}`,
      revision: `sha256:${"c".repeat(64)}`,
      scope: "static",
      estimatedTokens: 10,
      provenance: { source: `sha256:${"d".repeat(64)}` },
    }],
    finalPromptHash: `sha256:${"a".repeat(64)}`,
    estimatedTokens: 10,
  },
  evidenceIdentity: `sha256:${"e".repeat(64)}`,
} as const;

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Auto-connect
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError() {
    this.onerror?.();
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

function createWrapper(config: KilnConfig) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(KilnProvider, { config, children });
  };
}

describe("useKilnWsChat", () => {
  const config: KilnConfig = {
    baseUrl: "http://localhost:4000",
    appName: "test-app",
    userId: "user-1",
  };

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects to correct URL derived from baseUrl + appName", () => {
    renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toBe(
      "ws://localhost:4000/apps/test-app/ws?userId=user-1",
    );
  });

  it("uses wss protocol for https baseUrl", () => {
    const httpsConfig: KilnConfig = { ...config, baseUrl: "https://api.example.com" };
    renderHook(() => useKilnWsChat(), { wrapper: createWrapper(httpsConfig) });

    expect(MockWebSocket.instances[0]!.url).toMatch(/^wss:\/\//);
  });

  it("adds user message to messages on send", async () => {
    const { result } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });

    // Wait for WS to connect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      MockWebSocket.instances[0]!.readyState = WebSocket.OPEN;
    });

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!.role).toBe("user");
    expect(result.current.messages[0]!.content).toBe("hello");
  });

  it("sends requestedAuthority in the message frame", async () => {
    const { result } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });
    const ws = MockWebSocket.instances[0]!;

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      ws.readyState = WebSocket.OPEN;
    });

    await act(async () => {
      await result.current.send("hello", {
        requestedAuthority: "audited",
        communicationIntent: { responseDetail: "concise", requiredContent: ["warning"] },
      });
    });

    expect(JSON.parse(ws.send.mock.calls[0]?.[0] as string)).toEqual({
      type: "message",
      content: "hello",
      requestedAuthority: "audited",
      communicationIntent: { responseDetail: "concise", requiredContent: ["warning"] },
    });
  });

  it("sets isLoading true on send, false on done frame", async () => {
    const { result } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });
    const ws = MockWebSocket.instances[0]!;

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      ws.readyState = WebSocket.OPEN;
    });

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.isLoading).toBe(true);

    act(() => {
      ws.simulateMessage({ type: "done", content: "world", inputTokens: 5, outputTokens: 10 });
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("parses done frame and adds assistant message with content + parts", async () => {
    const { result } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });
    const ws = MockWebSocket.instances[0]!;

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      ws.readyState = WebSocket.OPEN;
    });

    await act(async () => {
      await result.current.send("hi");
    });

    const responseParts = [{ type: "text", text: "response" }];
    act(() => {
      ws.simulateMessage({
        type: "done",
        content: "response",
        parts: responseParts,
        inputTokens: 3,
        outputTokens: 7,
        effectivePromptObservation: communicationEvidence,
      });
    });

    expect(result.current.messages).toHaveLength(2);
    const assistantMsg = result.current.messages[1]!;
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("response");
    expect(assistantMsg.parts).toEqual(responseParts);
    expect(result.current.communicationEvidence).toEqual(communicationEvidence);
  });

  it("handles error frame by setting error state", async () => {
    const { result } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });
    const ws = MockWebSocket.instances[0]!;

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      ws.readyState = WebSocket.OPEN;
    });

    await act(async () => {
      await result.current.send("hi");
    });

    act(() => {
      ws.simulateMessage({ type: "error", message: "Something went wrong" });
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("Something went wrong");
    expect(result.current.isLoading).toBe(false);
  });

  it("reports error when WebSocket not connected", async () => {
    const { result } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });

    // Don't wait for connection -- WS is still CONNECTING
    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("WebSocket not connected");
  });

  it("clearMessages resets state", async () => {
    const { result } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });
    const ws = MockWebSocket.instances[0]!;

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      ws.readyState = WebSocket.OPEN;
    });

    await act(async () => {
      await result.current.send("hello");
    });

    act(() => {
      ws.simulateMessage({ type: "done", content: "world", inputTokens: 1, outputTokens: 2 });
    });

    expect(result.current.messages).toHaveLength(2);

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("closes WebSocket on unmount", async () => {
    const { unmount } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });
    const ws = MockWebSocket.instances[0]!;

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      ws.readyState = WebSocket.OPEN;
    });

    unmount();

    expect(ws.close).toHaveBeenCalled();
  });

  it("sends correctly formatted message frame via WebSocket", async () => {
    const { result } = renderHook(() => useKilnWsChat(), { wrapper: createWrapper(config) });
    const ws = MockWebSocket.instances[0]!;

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      ws.readyState = WebSocket.OPEN;
    });

    await act(async () => {
      await result.current.send("hello");
    });

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "message", content: "hello" }),
    );
  });
});
