import { describe, expect, it } from "vitest";
import type {
  GuiBrowserLiveViewportFrame,
  GuiBrowserOperatorInputAckFrame,
  GuiBrowserSessionState,
  GuiInboundFrame,
  GuiOutboundFrame,
} from "../src/frames.js";

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
        latestCapture: {
          uri: "kiln://artifacts/browser-1/live-frame",
          relation: "snapshot",
          mimeType: "image/png",
          width: 1440,
          height: 900,
          transport: "cdp-screencast",
        },
      },
    };

    expect(frame.browserSession.stream.status).toBe("live");
    expect(frame.browserSession.viewMode).toBe("live");
    expect(frame.browserSession.latestCapture?.transport).toBe("cdp-screencast");
  });

  it("carries operator browser session control requests", () => {
    const frame: GuiOutboundFrame = {
      type: "browser_session_control",
      action: "takeover",
      sessionId: "browser-1",
      reason: "Inspect before continuing.",
      requestId: "browser-control-1",
    };

    expect(frame.action).toBe("takeover");
    expect(frame.sessionId).toBe("browser-1");
  });

  it("carries managed-agent cancel control requests and acknowledgements", () => {
    const outbound: GuiOutboundFrame = {
      type: "managed_agent_control",
      action: "cancel",
      sessionId: "session-1",
      invocationId: "child-1",
      reason: "Operator stopped duplicate work.",
      requestId: "managed-agent-control-1",
    };
    const inbound: GuiInboundFrame = {
      type: "managed_agent_control_result",
      action: "cancel",
      sessionId: "session-1",
      invocationId: "child-1",
      status: "accepted",
      requestId: "managed-agent-control-1",
      handledAt: "2026-05-23T12:00:00.000Z",
    };

    expect(outbound.action).toBe("cancel");
    expect(inbound.status).toBe("accepted");
  });

  it("carries live viewport frames without requiring durable screenshot rows", () => {
    const frame: GuiInboundFrame = {
      type: "browser_live_viewport_frame",
      sessionId: "browser-1",
      kilnSessionId: "session-1",
      frameId: "frame-42",
      sequence: 42,
      transport: "cdp-screencast",
      format: "jpeg",
      dataUrl: "data:image/jpeg;base64,abc123",
      width: 1280,
      height: 720,
      scale: 1,
      capturedAt: "2026-05-13T12:00:00.000Z",
    };

    const viewportFrame: GuiBrowserLiveViewportFrame = frame;
    expect(viewportFrame.transport).toBe("cdp-screencast");
    expect(viewportFrame.width).toBe(1280);
  });

  it("carries native embedded browser host transport evidence", () => {
    const frame: GuiInboundFrame = {
      type: "browser_session_updated",
      browserSession: {
        target: "browser",
        status: "running",
        updatedAt: "2026-05-14T12:00:00.000Z",
        kilnSessionId: "session-1",
        provider: "native-electron",
        sessionId: "native-browser-1",
        ownership: "agent",
        viewMode: "live",
        stream: {
          status: "live",
        },
        latestCapture: {
          uri: "kiln://browser-host/native-browser-1/current",
          relation: "embedded-browser-host",
          mimeType: "text/html",
          width: 1024,
          height: 640,
          transport: "electron-webcontents",
        },
      },
    };

    expect(frame.browserSession.latestCapture?.transport).toBe("electron-webcontents");
  });

  it("carries typed operator input intents and acknowledgements", () => {
    const outbound: GuiOutboundFrame = {
      type: "browser_operator_input",
      requestId: "browser-input-1",
      sessionId: "browser-1",
      input: {
        kind: "pointer",
        phase: "down",
        x: 120,
        y: 80,
        button: "left",
      },
    };
    const inbound: GuiInboundFrame = {
      type: "browser_operator_input_ack",
      requestId: "browser-input-1",
      sessionId: "browser-1",
      status: "accepted",
      handledAt: "2026-05-13T12:00:00.000Z",
    };

    const ack: GuiBrowserOperatorInputAckFrame = inbound;
    expect(outbound.input.kind).toBe("pointer");
    expect(ack.status).toBe("accepted");
  });

  it("carries sanitized browser operator evidence session events", () => {
    const frame: GuiInboundFrame = {
      type: "session_event",
      event: {
        eventId: "session-1:browser:1",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-05-13T12:00:00.000Z",
        kind: "browser_operator_evidence",
        source: {
          actor: "runtime",
          surface: "gui",
          component: "gui-gateway",
        },
        payload: {
          action: "operator_input",
          browserSessionId: "browser-1",
          input: {
            kind: "text",
            textLength: 12,
          },
          acknowledgement: {
            status: "accepted",
          },
        },
      },
    };

    expect(frame.event.kind).toBe("browser_operator_evidence");
    expect(JSON.stringify(frame.event.payload)).not.toContain("typed secret");
  });
});
