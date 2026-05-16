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

function sentMessageFrame(ws: MockWebSocket): {
  type: "message";
  content: string;
  executionMode?: "execute" | "plan";
  requestedAuthority?: "auto" | "read_only" | "audited";
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
} {
  const messageCall = ws.send.mock.calls.find(([payload]) => {
    if (typeof payload !== "string" || payload === "ping") return false;
    return (JSON.parse(payload) as { type?: string }).type === "message";
  });
  expect(messageCall).toBeDefined();
  return JSON.parse(messageCall?.[0] as string) as {
    type: "message";
    content: string;
    executionMode?: "execute" | "plan";
    requestedAuthority?: "auto" | "read_only" | "audited";
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  };
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

describe("GatewaySession canonical session events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  it("projects voice audio parts from done frames as terminal artifact text", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of session.run({ prompt: "speak" })) {
        events.push(event);
      }
    })();

    await Promise.resolve();
    ws.simulateMessage(JSON.stringify({
      type: "done",
      content: "spoken answer",
      parts: [
        { type: "text", text: "spoken answer" },
        { type: "audio", mimeType: "audio/mpeg", data: "AQID", artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content" },
      ],
      inputTokens: 3,
      outputTokens: 4,
    }));

    await collect;
    expect(events).toContainEqual({ type: "text_delta", content: "spoken answer" });
    expect(events).toContainEqual({
      type: "text_delta",
      content: "\n[Voice audio: Audio output | audio/mpeg | kiln://artifacts/voice-synthesis/artifact_1/content]",
    });
    await session.dispose();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("projects canonical tool and file events with session identity", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of session.run({ prompt: "edit file" })) {
        events.push(event);
      }
    })();

    await Promise.resolve();
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-tool",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-04-28T20:00:00.000Z",
        kind: "tool_call_started",
        turnId: "session-1:turn:live",
        payload: {
          toolCallId: "tool-1",
          toolName: "write",
          input: { path: "demo.txt" },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-result",
        kilnSessionId: "session-1",
        sequence: 2,
        timestamp: "2026-04-28T20:00:01.000Z",
        kind: "tool_call_completed",
        turnId: "session-1:turn:live",
        payload: {
          toolCallId: "tool-1",
          toolName: "patch",
          outputSummary: JSON.stringify({
            output: "1 file changed, 2 additions, 1 removal",
            isError: false,
            metadata: {
              toolName: "patch",
              kind: "file",
              operation: "patch",
              filePath: "demo.txt",
              linesAdded: 2,
              linesRemoved: 1,
              diffPreview: "- old\n+ new",
            },
          }),
          status: { state: "succeeded" },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-file",
        kilnSessionId: "session-1",
        sequence: 3,
        timestamp: "2026-04-28T20:00:02.000Z",
        kind: "file_changed",
        turnId: "session-1:turn:live",
        payload: {
          change: {
            path: "demo.txt",
            changeType: "updated",
            linesAdded: 2,
            linesRemoved: 1,
          },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-agent",
        kilnSessionId: "session-1",
        sequence: 4,
        timestamp: "2026-04-28T20:00:03.000Z",
        kind: "agent_invocation_completed",
        turnId: "session-1:turn:live",
        payload: {
          invocationId: "inv-1",
          agentId: "codex-oauth:foundation-readonly-plan",
          profile: "foundation-readonly-plan",
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-5.4-mini",
            surface: "direct-provider",
          },
          resultSummary: "Inspection completed.",
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "done",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.5",
    }));

    await collect;

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "activity",
        activity: "tool_use",
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        toolName: "write",
        input: { path: "demo.txt" },
        surfaces: ["conversation_inline", "activity_panel", "inspector"],
      }),
      expect.objectContaining({
        type: "activity",
        activity: "tool_result",
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        toolName: "patch",
        output: "1 file changed, 2 additions, 1 removal",
        toolPresentation: expect.objectContaining({
          outputKind: "diff",
          title: "demo.txt",
        }),
        surfaces: ["conversation_inline", "activity_panel", "inspector"],
      }),
      expect.objectContaining({
        type: "activity",
        activity: "file_changed",
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        path: "demo.txt",
        changeType: "modified",
        linesAdded: 2,
        linesRemoved: 1,
        surfaces: ["activity_panel", "inspector"],
      }),
      expect.objectContaining({
        type: "activity",
        activity: "agent_invocation_completed",
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        details: "foundation-readonly-plan via codex-oauth/gpt-5.4-mini (direct-provider) · Inspection completed.",
        input: expect.objectContaining({
          agentId: "codex-oauth:foundation-readonly-plan",
          profile: "foundation-readonly-plan",
        }),
        surfaces: ["conversation_inline", "activity_panel", "inspector"],
      }),
    ]));

    await session.dispose();
  });

  it("projects canonical work item execution events with attempt state", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of session.run({ prompt: "execute governed work" })) {
        events.push(event);
      }
    })();

    await Promise.resolve();
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-work-start",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-05-12T20:00:00.000Z",
        kind: "work_item_execution_started",
        turnId: "session-1:turn:live",
        payload: {
          workItem: {
            id: "work-1",
            summary: "Run Slice 9 verification",
            status: "in_progress",
            workflowProfile: "verification-heavy",
            expectedEvidence: ["tests"],
            providedEvidence: [],
            executionAttempts: [
              {
                id: "goal-1:work-1:attempt:1",
                status: "started",
                executionMode: "managed_delegation",
                managedInvocationId: "invocation-1",
                startedAt: "2026-05-12T20:00:00.000Z",
              },
            ],
            pauseRequirements: [
              {
                id: "operator-input-1",
                kind: "operator_input",
                summary: "Confirm execution",
                status: "resolved",
              },
            ],
            updatedAt: "2026-05-12T20:00:00.000Z",
          },
          attempt: {
            id: "goal-1:work-1:attempt:1",
            status: "started",
            executionMode: "managed_delegation",
            managedInvocationId: "invocation-1",
            startedAt: "2026-05-12T20:00:00.000Z",
          },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "done",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
    }));

    await collect;

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "activity",
        activity: "work_item_execution_started",
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        details: "started · managed_delegation · Run Slice 9 verification",
        input: expect.objectContaining({
          id: "work-1",
          latestAttemptStatus: "started",
          latestAttemptMode: "managed_delegation",
          latestManagedInvocationId: "invocation-1",
        }),
        surfaces: ["conversation_inline", "activity_panel", "inspector"],
      }),
    ]));

    await session.dispose();
  });

  it("projects read and tree tool results from full payload envelopes", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of session.run({ prompt: "inspect docs" })) {
        events.push(event);
      }
    })();

    await Promise.resolve();
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-read-result",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-04-30T20:00:00.000Z",
        kind: "tool_call_completed",
        turnId: "session-1:turn:live",
        payload: {
          toolCallId: "tool-read",
          toolName: "read",
          output: JSON.stringify({
            output: "# Session Model\n\nKiln session identity is provider-agnostic.",
            isError: false,
            metadata: {
              toolName: "read",
              kind: "file",
              operation: "read",
              filePath: "docs/architecture/session-model.md",
            },
          }),
          outputSummary: "{\"output\":\"# Session Model\\n\\nKiln session identity is provider-agnostic.\",\"isError\":false,\"metadata\":{\"toolName\":\"read\"",
          status: { state: "succeeded" },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-tree-result",
        kilnSessionId: "session-1",
        sequence: 2,
        timestamp: "2026-04-30T20:00:01.000Z",
        kind: "tool_call_completed",
        turnId: "session-1:turn:live",
        payload: {
          toolCallId: "tool-tree",
          toolName: "tree",
          output: JSON.stringify({
            output: ".\npackages/\n  tui/",
            isError: false,
            metadata: {
              toolName: "tree",
              kind: "inspection",
              operation: "tree",
              path: "C:\\workspace\\kiln",
              depth: 2,
              entryCount: 55,
              resourceLinks: [
                {
                  uri: "kiln://artifacts/tool-results/artifact_tree/content",
                  title: "tree full output",
                  mimeType: "text/plain",
                  size: 9000,
                  relation: "full_output",
                },
              ],
            },
          }),
          outputSummary: "{\"output\":\".\\npackages/\",\"isError\":false,\"metadata\":{\"toolName\":\"tree\"",
          status: { state: "succeeded" },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "done",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.5",
    }));

    await collect;

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "activity",
        activity: "tool_result",
        toolName: "read",
        output: "# Session Model",
        toolPresentation: expect.objectContaining({
          outputKind: "markdown",
          title: "docs/architecture/session-model.md",
        }),
      }),
      expect.objectContaining({
        type: "activity",
        activity: "tool_result",
        toolName: "tree",
        output: "55 entries under C:\\workspace\\kiln",
        toolPresentation: expect.objectContaining({
          outputKind: "tree",
          title: "C:\\workspace\\kiln",
        }),
      }),
    ]));
    expect(JSON.stringify(events)).not.toContain("{\\\"output\\\"");
    expect(JSON.stringify(events)).not.toContain("\\\"metadata\\\"");

    await session.dispose();
  });

  it("uses presentation intent text fallback for terminal tool results", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of session.run({ prompt: "compare child routes" })) {
        events.push(event);
      }
    })();

    await Promise.resolve();
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-managed-comparison",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-05-07T20:00:00.000Z",
        kind: "tool_call_completed",
        turnId: "session-1:turn:live",
        payload: {
          toolCallId: "tool-managed",
          toolName: "managed_agent.invoke",
          outputSummary: JSON.stringify({
            output: "Child invocation completed.",
            isError: false,
            metadata: {
              toolName: "managed_agent.invoke",
              kind: "managed-invocation",
              presentationIntent: {
                kind: "comparison_table",
                title: "Managed child comparison",
                columns: [
                  { key: "routeId", label: "Route" },
                  { key: "provider", label: "Provider" },
                  { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
                ],
                rows: [
                  { routeId: "codex-oauth-readonly", provider: "codex-oauth", substantiveEvidence: true },
                ],
              },
            },
          }),
          status: { state: "succeeded" },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "done",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
    }));

    await collect;

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "activity",
        activity: "tool_result",
        toolName: "managed_agent.invoke",
        output: expect.stringContaining("| Route"),
        toolPresentation: expect.objectContaining({
          outputKind: "table",
          presentationIntent: expect.objectContaining({
            kind: "comparison_table",
          }),
        }),
      }),
    ]));

    await session.dispose();
  });
});

describe("GatewaySession execution modes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends shared executionMode instead of a local plan flag", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();
    ws.simulateMessage(JSON.stringify({
      type: "welcome",
      models: {},
      executionMode: "plan",
    }));

    const collect = (async () => {
      for await (const _event of session.run({ prompt: "make a plan" })) {
        // drain until done
      }
    })();
    await Promise.resolve();

    expect(sentMessageFrame(ws)).toMatchObject({
      type: "message",
      content: "make a plan",
      executionMode: "plan",
    });

    ws.simulateMessage(JSON.stringify({
      type: "done",
      content: "",
      inputTokens: 1,
      outputTokens: 1,
    }));
    await collect;
    await session.dispose();
  });

  it("sends requestedAuthority when provided on run options", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    const collect = (async () => {
      for await (const _event of session.run({
        prompt: "review this patch",
        requestedAuthority: "audited",
      })) {
        // drain until done
      }
    })();
    await Promise.resolve();

    expect(sentMessageFrame(ws)).toMatchObject({
      type: "message",
      content: "review this patch",
      requestedAuthority: "audited",
    });

    ws.simulateMessage(JSON.stringify({
      type: "done",
      content: "",
      inputTokens: 1,
      outputTokens: 1,
    }));
    await collect;
    await session.dispose();
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
    const applyTheme = vi.fn().mockResolvedValue({ ok: true, appliedTheme: "kiln-graphite" });
    const clearHandler = setTuiOperatorThemeHandler(applyTheme);
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage(JSON.stringify({
      type: "operator_theme_set",
      requestId: "theme-1",
      theme: "kiln-graphite",
      scope: "session",
      reason: "test",
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(applyTheme).toHaveBeenCalledWith({
      theme: "kiln-graphite",
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
      appliedTheme: "kiln-graphite",
    });

    clearHandler();
    await session.dispose();
  });
});
