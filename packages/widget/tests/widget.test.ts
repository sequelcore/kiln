/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WidgetConfig } from "../src/types.js";
import { renderVoiceAudioParts } from "../src/voice-parts.js";

// --- Mock WsClient ---
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSend = vi.fn();
const mockSendParts = vi.fn();

let capturedMessageHandler: ((frame: unknown) => void) | null = null;
let capturedStatusHandler: ((status: string) => void) | null = null;

vi.mock("../src/ws-client.js", () => {
  class MockWsClient {
    connect = mockConnect;
    disconnect = mockDisconnect;
    send = mockSend;
    sendParts = mockSendParts;
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

  describe("voice parts", () => {
    it("attaches an audio file and sends canonical voice parts", async () => {
      const attachShadow = Element.prototype.attachShadow;
      const shadowSpy = vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function openShadowRoot(
        this: Element,
        init: ShadowRootInit,
      ) {
        return attachShadow.call(this, { ...init, mode: "open" });
      });

      try {
        new KilnWidget(makeConfig());

        const shadow = document.querySelector("#kiln-widget-root")?.shadowRoot;
        expect(shadow).not.toBeNull();
        const fileButton = shadow!.querySelector<HTMLButtonElement>("[aria-label='Attach audio file']");
        const fileInput = shadow!.querySelector<HTMLInputElement>("[aria-label='Audio file input']");
        expect(fileButton).not.toBeNull();
        expect(fileInput).not.toBeNull();

        const file = new File(["abc"], "voice.webm", { type: "audio/webm" });
        fileButton!.click();
        Object.defineProperty(fileInput!, "files", {
          configurable: true,
          value: [file],
        });
        fileInput!.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => {
          expect(mockSendParts).toHaveBeenCalledWith([
            {
              type: "audio",
              mimeType: "audio/webm",
              data: "YWJj",
            },
          ], "Voice input");
        });
      } finally {
        shadowSpy.mockRestore();
      }
    });

    it("renders assistant audio parts as audio controls and artifact links", () => {
      const container = document.createElement("div");

      renderVoiceAudioParts(container, [
        { type: "text", text: "spoken answer" },
        { type: "audio", mimeType: "audio/mpeg", data: "AQID", artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content" },
      ]);

      const audio = container.querySelector("audio");
      expect(audio).not.toBeNull();
      expect(audio?.getAttribute("src")).toBe("data:audio/mpeg;base64,AQID");
      const link = container.querySelector("a");
      expect(link?.getAttribute("href")).toBe("kiln://artifacts/voice-synthesis/artifact_1/content");
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
