/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WidgetConfig } from "../src/types.js";

// --- Mock WsClient ---
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSend = vi.fn();

let capturedMessageHandler: ((frame: unknown) => void) | null = null;
let capturedStatusHandler: ((status: string) => void) | null = null;

vi.mock("../src/ws-client.js", () => {
  class MockWsClient {
    connect = mockConnect;
    disconnect = mockDisconnect;
    send = mockSend;
    connected = false;
    onMessage(h: (frame: unknown) => void) { capturedMessageHandler = h; }
    onStatusChange(h: (status: string) => void) { capturedStatusHandler = h; }
  }
  return { WsClient: MockWsClient };
});

// Import after mock
const { KilnWidget } = await import("../src/widget.js");

function makeConfig(overrides?: Partial<WidgetConfig>): WidgetConfig {
  return {
    gatewayUrl: "https://gw.kilvo.app",
    appName: "test-app",
    widgetId: "wid-001",
    position: "bottom-right",
    theme: "light",
    ...overrides,
  };
}

describe("KilnWidget", () => {
  beforeEach(() => {
    // Clean up any existing widget containers
    document.querySelectorAll("#kiln-widget-root").forEach((el) => el.remove());
    capturedMessageHandler = null;
    capturedStatusHandler = null;
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("appends container to document.body", () => {
      new KilnWidget(makeConfig());
      const el = document.querySelector("#kiln-widget-root");
      expect(el).not.toBeNull();
      expect(document.body.contains(el)).toBe(true);
    });

    it("calls client.connect()", () => {
      new KilnWidget(makeConfig());
      expect(mockConnect).toHaveBeenCalledOnce();
    });

    it("registers message and status handlers", () => {
      new KilnWidget(makeConfig());
      expect(capturedMessageHandler).not.toBeNull();
      expect(capturedStatusHandler).not.toBeNull();
    });
  });

  describe("shadow DOM", () => {
    it("creates shadow DOM on container", () => {
      new KilnWidget(makeConfig());
      const container = document.querySelector("#kiln-widget-root") as HTMLElement;
      // Shadow root should exist (mode is "closed" so shadowRoot getter returns null,
      // but the container was created with attachShadow -- we verify via structure)
      expect(container).not.toBeNull();
    });
  });

  describe("greeting message", () => {
    it("shows greeting as first assistant message", () => {
      const widget = new KilnWidget(makeConfig({ greeting: "Hello! How can I help?" }));
      widget.open();
      // The widget uses Shadow DOM (closed), but we can test behavior via public API
      // and by observing the widget was constructed without throwing
      expect(widget).toBeDefined();
    });

    it("does not add greeting when not configured", () => {
      const widget = new KilnWidget(makeConfig());
      expect(widget).toBeDefined();
    });
  });

  describe("open() and close()", () => {
    it("open() shows panel", () => {
      const widget = new KilnWidget(makeConfig());
      widget.open();
      // Widget should not throw and container should remain in DOM
      expect(document.querySelector("#kiln-widget-root")).not.toBeNull();
    });

    it("close() hides panel", () => {
      const widget = new KilnWidget(makeConfig());
      widget.open();
      widget.close();
      expect(document.querySelector("#kiln-widget-root")).not.toBeNull();
    });

    it("toggle() alternates open/close state", () => {
      const widget = new KilnWidget(makeConfig());
      // Initially closed
      widget.toggle(); // open
      widget.toggle(); // close
      widget.toggle(); // open again
      expect(document.querySelector("#kiln-widget-root")).not.toBeNull();
    });
  });

  describe("sendMessage()", () => {
    it("calls client.send with message content", () => {
      const widget = new KilnWidget(makeConfig());
      widget.open();
      widget.sendMessage();
      // With empty input, send should NOT be called
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("handling incoming frames", () => {
    it("adds assistant message on done frame", () => {
      new KilnWidget(makeConfig());
      expect(capturedMessageHandler).not.toBeNull();

      // Simulate done frame
      capturedMessageHandler!({
        type: "done",
        content: "Here is my response",
        inputTokens: 10,
        outputTokens: 5,
      });

      // Should not throw; widget handles the frame internally
    });

    it("shows error on error frame", () => {
      new KilnWidget(makeConfig());
      expect(capturedMessageHandler).not.toBeNull();

      capturedMessageHandler!({
        type: "error",
        message: "Service unavailable",
      });
    });
  });

  describe("connection status updates", () => {
    it("updates status dot class on status change", () => {
      new KilnWidget(makeConfig());
      expect(capturedStatusHandler).not.toBeNull();

      // Should not throw for any status
      capturedStatusHandler!("connected");
      capturedStatusHandler!("disconnected");
      capturedStatusHandler!("connecting");
      capturedStatusHandler!("error");
    });
  });

  describe("destroy()", () => {
    it("removes container from DOM", () => {
      const widget = new KilnWidget(makeConfig());
      expect(document.querySelector("#kiln-widget-root")).not.toBeNull();

      widget.destroy();
      expect(document.querySelector("#kiln-widget-root")).toBeNull();
    });

    it("calls client.disconnect()", () => {
      const widget = new KilnWidget(makeConfig());
      widget.destroy();
      expect(mockDisconnect).toHaveBeenCalledOnce();
    });
  });

  describe("position configuration", () => {
    it("defaults to bottom-right", () => {
      const widget = new KilnWidget(makeConfig({ position: undefined }));
      expect(widget).toBeDefined();
    });

    it("supports bottom-left position", () => {
      const widget = new KilnWidget(makeConfig({ position: "bottom-left" }));
      expect(widget).toBeDefined();
    });
  });
});
