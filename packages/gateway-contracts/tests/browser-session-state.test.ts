import { describe, expect, it } from "vitest";
import type { GuiBrowserSessionState, GuiInboundFrame } from "../src/frames.js";

describe("browser session state frames", () => {
  it("carries shared browser session state on interactive use updates", () => {
    const browserSession: GuiBrowserSessionState = {
      target: "browser",
      status: "succeeded",
      updatedAt: "2026-05-08T12:00:00.000Z",
      kilnSessionId: "session-1",
      toolCallId: "tool-1",
      toolName: "browser_observe",
      provider: "playwright",
      sessionId: "browser-1",
      operation: "observe",
      url: "https://app.example.com",
      title: "Example App",
      ownership: "agent",
      viewMode: "snapshot",
      stream: {
        status: "unavailable",
        reason: "No live browser stream transport is configured.",
      },
      latestCapture: {
        uri: "kiln://artifacts/browser-1/screenshot",
        relation: "snapshot",
        mimeType: "image/png",
      },
    };

    const frame: GuiInboundFrame = {
      type: "interactive_use_updated",
      snapshot: {
        target: "browser",
        status: "succeeded",
        updatedAt: "2026-05-08T12:00:00.000Z",
        screenshotUri: "kiln://artifacts/browser-1/screenshot",
      },
      browserSession,
    };

    expect(frame.browserSession).toEqual(browserSession);
  });

  it("carries shared browser session state on lifecycle update frames", () => {
    const frame: GuiInboundFrame = {
      type: "browser_session_updated",
      browserSession: {
        target: "browser",
        status: "running",
        updatedAt: "2026-05-08T12:01:00.000Z",
        kilnSessionId: "session-1",
        provider: "playwright",
        sessionId: "browser-1",
        ownership: "agent",
        viewMode: "live",
        stream: {
          status: "live",
        },
      },
    };

    expect(frame.browserSession.stream.status).toBe("live");
    expect(frame.browserSession.viewMode).toBe("live");
  });
});
