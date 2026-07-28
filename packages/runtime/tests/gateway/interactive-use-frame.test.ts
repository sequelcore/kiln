import { describe, expect, it } from "vitest";
import { projectInteractiveUseFrameFromToolResult } from "../../src/gateway/interactive-use-frame.js";

describe("interactive use GUI frame projection", () => {
  it("projects interactive browser metadata into a GUI snapshot frame", () => {
    expect(projectInteractiveUseFrameFromToolResult({
      kilnSessionId: "session-1",
      toolCallId: "tool-1",
      toolCallScopeId: "turn-1:response:1",
      toolName: "browser_observe",
      timestamp: "2026-05-08T12:00:00.000Z",
      status: "succeeded",
      metadata: {
        kind: "interactive",
        target: "browser",
        provider: "playwright",
        sessionId: "browser-1",
        operation: "observe",
        resourceLinks: [
          {
            uri: "kiln://artifacts/browser-1/screenshot",
            label: "Browser screenshot",
            relation: "snapshot",
            mimeType: "image/png",
          },
        ],
        observation: {
          url: "https://app.example.com",
          title: "Example App",
          screenshotDataUrl: "data:image/png;base64,abc",
          screenshotUri: "kiln://artifacts/browser-1/screenshot",
        },
      },
    })).toEqual({
      type: "interactive_use_updated",
      snapshot: {
        target: "browser",
        status: "succeeded",
        kilnSessionId: "session-1",
        toolCallId: "tool-1",
        toolCallScopeId: "turn-1:response:1",
        toolName: "browser_observe",
        provider: "playwright",
        sessionId: "browser-1",
        operation: "observe",
        url: "https://app.example.com",
        title: "Example App",
        screenshotDataUrl: "data:image/png;base64,abc",
        screenshotUri: "kiln://artifacts/browser-1/screenshot",
        updatedAt: "2026-05-08T12:00:00.000Z",
      },
      browserSession: {
        target: "browser",
        status: "succeeded",
      kilnSessionId: "session-1",
      toolCallId: "tool-1",
      toolCallScopeId: "turn-1:response:1",
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
          label: "Browser screenshot",
          relation: "snapshot",
          mimeType: "image/png",
        },
        updatedAt: "2026-05-08T12:00:00.000Z",
      },
    });
  });

  it("ignores non-interactive metadata", () => {
    expect(projectInteractiveUseFrameFromToolResult({
        kilnSessionId: "session-1",
        toolCallId: "tool-1",
        toolCallScopeId: "turn-1:response:1",
      toolName: "read",
      timestamp: "2026-05-08T12:00:00.000Z",
      status: "succeeded",
      metadata: { kind: "file", operation: "read" },
    })).toBeNull();
  });
});
