import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// --- Mock WebSocket ---
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn().mockImplementation(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  });

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  simulateError(): void {
    this.onerror?.({} as Event);
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

// --- Mock localStorage ---
const localStorageData: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageData[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageData[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageData[key]; }),
  clear: vi.fn(() => { Object.keys(localStorageData).forEach((k) => delete localStorageData[k]); }),
};

// Apply globals
vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("localStorage", mockLocalStorage);
vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "test-uuid-1234") });

// Import after stubs
const { WsClient } = await import("../src/ws-client.js");

describe("WsClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    mockLocalStorage.clear();
    vi.clearAllMocks();
    (crypto.randomUUID as ReturnType<typeof vi.fn>).mockReturnValue("test-uuid-1234");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("builds correct wss URL for https gateway", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "widget-abc");
      client.connect();
      const ws = MockWebSocket.instances[0];
      expect(ws?.url).toBe("wss://gw.kilvo.app/apps/myapp/ws?widgetId=widget-abc&userId=test-uuid-1234");
    });

    it("builds correct ws URL for http gateway", () => {
      const client = new WsClient("http://localhost:3000", "myapp", "widget-abc");
      client.connect();
      const ws = MockWebSocket.instances[0];
      expect(ws?.url).toBe("ws://localhost:3000/apps/myapp/ws?widgetId=widget-abc&userId=test-uuid-1234");
    });

    it("persists userId in localStorage", () => {
      new WsClient("https://gw.kilvo.app", "myapp", "widget-abc");
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith("kiln_uid_widget-abc", "test-uuid-1234");
    });

    it("reuses existing userId from localStorage", () => {
      localStorageData["kiln_uid_widget-abc"] = "existing-user-id";
      const client = new WsClient("https://gw.kilvo.app", "myapp", "widget-abc");
      client.connect();
      const ws = MockWebSocket.instances[0];
      expect(ws?.url).toContain("userId=existing-user-id");
    });
  });

  describe("connect()", () => {
    it("creates a WebSocket", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("reports connecting status immediately", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      const onStatus = vi.fn();
      client.onStatusChange(onStatus);
      client.connect();
      expect(onStatus).toHaveBeenCalledWith("connecting");
    });

    it("reports connected status on open", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      const onStatus = vi.fn();
      client.onStatusChange(onStatus);
      client.connect();
      MockWebSocket.instances[0]?.simulateOpen();
      expect(onStatus).toHaveBeenCalledWith("connected");
    });

    it("reports error status on ws error", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      const onStatus = vi.fn();
      client.onStatusChange(onStatus);
      client.connect();
      MockWebSocket.instances[0]?.simulateError();
      expect(onStatus).toHaveBeenCalledWith("error");
    });
  });

  describe("send()", () => {
    it("sends JSON frame when connected", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      client.send("Hello world");
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "message", content: "Hello world" }));
    });

    it("sends voice input parts when connected", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      const parts = [
        { type: "audio", mimeType: "audio/webm", data: "YWJj" },
      ];

      client.sendParts(parts, "Voice input");

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: "message",
        content: "Voice input",
        parts,
      }));
    });

    it("does not send when not connected", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      // readyState is CONNECTING, not OPEN
      client.send("Hello");
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("onMessage()", () => {
    it("delivers parsed done frame", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      const onMsg = vi.fn();
      client.onMessage(onMsg);
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      const frame = { type: "done", content: "Hi there", inputTokens: 10, outputTokens: 5 };
      ws.simulateMessage(JSON.stringify(frame));
      expect(onMsg).toHaveBeenCalledWith(frame);
    });

    it("delivers parsed error frame", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      const onMsg = vi.fn();
      client.onMessage(onMsg);
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: "error", message: "Something went wrong" }));
      expect(onMsg).toHaveBeenCalledWith({ type: "error", message: "Something went wrong" });
    });

    it("discards malformed messages", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      const onMsg = vi.fn();
      client.onMessage(onMsg);
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      expect(() => ws.simulateMessage("not-json{{{")).not.toThrow();
      expect(onMsg).not.toHaveBeenCalled();
    });
  });

  describe("auto-reconnect with exponential backoff", () => {
    it("reconnects after unexpected close", () => {
      vi.useFakeTimers();
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      // Simulate unexpected close (not intentional)
      ws.onclose?.({} as CloseEvent);

      expect(MockWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("doubles reconnect delay on each attempt without intermediate open", () => {
      vi.useFakeTimers();
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();

      // First close without open -> delay stays at 1000ms, then doubles to 2000ms
      MockWebSocket.instances[0]!.onclose?.({} as CloseEvent);
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances).toHaveLength(2);

      // Second close without open -> reconnect after 2000ms (doubled)
      MockWebSocket.instances[1]!.onclose?.({} as CloseEvent);
      vi.advanceTimersByTime(1999);
      expect(MockWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances).toHaveLength(3);
    });

    it("caps reconnect delay at 30000ms", () => {
      vi.useFakeTimers();
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();

      // Exhaust 10+ rounds to exceed 30s cap (1s, 2s, 4s, 8s, 16s, 32s -> capped at 30s)
      for (let i = 0; i < 10; i++) {
        MockWebSocket.instances[i]?.simulateOpen();
        MockWebSocket.instances[i]!.onclose?.({} as CloseEvent);
        vi.advanceTimersByTime(32000); // advance past any possible delay
      }

      // After cap, reconnect should happen within 30000ms
      const countBefore = MockWebSocket.instances.length;
      MockWebSocket.instances[countBefore - 1]?.simulateOpen();
      MockWebSocket.instances[countBefore - 1]!.onclose?.({} as CloseEvent);
      vi.advanceTimersByTime(30001);
      expect(MockWebSocket.instances.length).toBe(countBefore + 1);
    });
  });

  describe("disconnect()", () => {
    it("prevents reconnection after disconnect", () => {
      vi.useFakeTimers();
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      MockWebSocket.instances[0]?.simulateOpen();

      client.disconnect();

      vi.advanceTimersByTime(60000);
      // No new instance created
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("sets connected to false after disconnect", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      MockWebSocket.instances[0]?.simulateOpen();
      client.disconnect();
      expect(client.connected).toBe(false);
    });

    it("emits disconnected status", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      const onStatus = vi.fn();
      client.onStatusChange(onStatus);
      client.connect();
      MockWebSocket.instances[0]?.simulateOpen();
      client.disconnect();
      expect(onStatus).toHaveBeenCalledWith("disconnected");
    });
  });

  describe("connected getter", () => {
    it("returns true when WebSocket is OPEN", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      MockWebSocket.instances[0]?.simulateOpen();
      expect(client.connected).toBe(true);
    });

    it("returns false when not connected", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      expect(client.connected).toBe(false);
    });
  });

  describe("identify()", () => {
    it("sends identify frame when connected", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      client.identify({ name: "Alice", email: "alice@test.com" });
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: "identify",
        visitor: { name: "Alice", email: "alice@test.com" },
      }));
    });

    it("does not send identify when not connected", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      client.connect();
      const ws = MockWebSocket.instances[0]!;
      client.identify({ name: "Alice" });
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("userId property", () => {
    it("exposes the userId", () => {
      const client = new WsClient("https://gw.kilvo.app", "myapp", "wid");
      expect(client.userId).toBe("test-uuid-1234");
    });
  });
});
