import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewaySession } from "../src/gateway-session.js";
import { setTuiOperatorThemeHandler } from "../src/operator-theme-handler.js";
import type { GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";

const EMPTY_PROVIDER_MODEL_DISCOVERY: GuiProviderModelDiscoveryProjection = {
  catalogEvidence: {
    status: "failed",
    source: {
      kind: "test",
      id: "tui-gateway-session",
    },
    observedAt: "2026-07-01T00:00:00.000Z",
    counts: {
      total: 0,
      returned: 0,
      omitted: 0,
    },
    failure: {
      classification: "catalog-unavailable",
      summary: "No provider model discovery fixture.",
    },
  },
  entries: [],
};

const COMPLETED_TURN_DISPOSITION = {
  outcome: "completed",
  dispositionReason: "completion_eligible",
  completion: {
    obligations: [],
    producerEvidence: [],
    eligibility: { status: "eligible" },
  },
  convergence: {
    policy: {
      policyId: "test.tui.turn-convergence",
      configurationHash: `sha256:${"0".repeat(64)}`,
      providerRequests: 10,
      toolRounds: 8,
      toolCalls: 24,
      cumulativeInputTokens: 256_000,
      elapsedMs: 600_000,
      activeMs: 600_000,
      recoveryAttempts: 3,
      consecutiveNoProgressSteps: 3,
    },
    progressEvidence: [],
  },
} as const;

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

function sentExecutionTargetFrame(ws: MockWebSocket): { targetId: string; accountOverrideId?: string; requestId: string } {
  const routeCall = ws.send.mock.calls.find(([payload]) => {
    if (typeof payload !== "string" || payload === "ping") return false;
    return (JSON.parse(payload) as { type?: string }).type === "execution_target";
  });
  expect(routeCall).toBeDefined();
  const frame = JSON.parse(routeCall?.[0] as string) as { type?: string; targetId?: string; accountOverrideId?: string; requestId?: string };
  expect(frame.type).toBe("execution_target");
  expect(typeof frame.targetId).toBe("string");
  expect(typeof frame.requestId).toBe("string");
  expect(frame.requestId?.trim()).not.toBe("");
  return frame as { targetId: string; accountOverrideId?: string; requestId: string };
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
  deliberationIntent?: { mode: "fixed"; preferredLevel: string; onUnsupported: "deny" };
  communicationIntent?: { responseDetail: "concise"; requiredContent: ["warning"] };
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
    deliberationIntent?: { mode: "fixed"; preferredLevel: string; onUnsupported: "deny" };
    communicationIntent?: { responseDetail: "concise"; requiredContent: ["warning"] };
  };
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}

describe("GatewaySession execution-route switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects immediately when execution_target_changed does not match the pending request", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();

    const promise = session.switchExecutionTarget("openai-gpt-5", "work");
    await Promise.resolve();

    const frame = sentExecutionTargetFrame(ws);
    expect(frame).toMatchObject({
      targetId: "openai-gpt-5",
      accountOverrideId: "work",
    });

    ws.simulateMessage(JSON.stringify({
      type: "execution_target_changed",
      targetId: "openai-gpt-5",
      requestId: "stale-request",
    }));

    await expect(promise).rejects.toThrow("Execution target change acknowledgement did not match the pending request");
    await session.dispose();
  });

  it("sends a requestId and resolves the matching execution_target_changed acknowledgement", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();

    const promise = session.switchExecutionTarget("openai-gpt-5");
    await Promise.resolve();

    const frame = sentExecutionTargetFrame(ws);
    ws.simulateMessage(JSON.stringify({
      type: "execution_target_changed",
      targetId: "openai-gpt-5",
      requestId: frame.requestId,
    }));

    await expect(promise).resolves.toBe("openai-gpt-5");
    await session.dispose();
  });

  it("rejects a pending route switch from its correlated failure frame", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();

    const promise = session.switchExecutionTarget("openai-gpt-5");
    await Promise.resolve();

    const frame = sentExecutionTargetFrame(ws);

    const rejections: Error[] = [];
    promise.catch((error: Error) => {
      rejections.push(error);
      return "";
    });

    ws.simulateMessage(JSON.stringify({
      type: "execution_target_change_failed",
      targetId: "openai-gpt-5",
      requestId: frame.requestId,
      reason: "Provider switch failed",
      reasonCode: "provider-unavailable",
      repairActions: ["retry-route"],
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(rejections).toHaveLength(1);
    expect(rejections[0]!).toBeInstanceOf(Error);
    expect(rejections[0]!.message).toBe("Provider switch failed");
    await expect(promise).rejects.toThrow("Provider switch failed");
    await session.dispose();
  });

  it("requires an active connection before sending route selection intent", async () => {
    const disconnectedSession = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const disconnectedWs = wsInstances[0]!;

    await expect(disconnectedSession.switchExecutionTarget("openai-gpt-5")).rejects.toThrow("active TUI gateway connection");
    expect(disconnectedWs.send).not.toHaveBeenCalled();

    disconnectedWs.simulateOpen();

    const modelessSwitch = disconnectedSession.switchExecutionTarget("claude-default");
    await Promise.resolve();

    const modelessFrame = sentExecutionTargetFrame(disconnectedWs);
    expect(modelessFrame).toMatchObject({
      targetId: "claude-default",
    });

    disconnectedWs.simulateMessage(JSON.stringify({
      type: "execution_target_changed",
      targetId: "claude-default",
      requestId: modelessFrame.requestId,
    }));

    await expect(modelessSwitch).resolves.toBe("claude-default");
    await disconnectedSession.dispose();
  });

  it("refreshes and exposes the canonical execution-route catalog", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();

    const promise = session.refreshModelCatalog();
    await Promise.resolve();

    const refreshFrame = ws.send.mock.calls.find(([payload]) => (
      typeof payload === "string"
      && payload !== "ping"
      && (JSON.parse(payload) as { type?: string }).type === "refresh_model_catalog"
    ));
    expect(refreshFrame).toBeDefined();
    const refreshRequest = JSON.parse(refreshFrame?.[0] as string) as { readonly requestId: string };

    const modelCatalog = {
      observedAt: "2026-08-25T00:00:00.000Z",
      models: [{
        providerId: "claude",
        providerRouteId: "claude:direct",
        providerModelId: "claude-sonnet-4-6",
        access: "subscription",
        family: "claude",
        discovery: "observed",
        eligibility: "eligible",
        availability: "available",
        provenance: [],
        targets: [{
          targetId: "claude-default",
          label: "Claude",
          access: "subscription",
          availability: "available",
          reasonCodes: ["configured"],
          repairActions: [],
          eligibleAccountCount: 1,
          accountOverrideIds: [],
          cost: { kind: "subscription" },
        }],
      }],
    } as const;
    ws.simulateMessage(JSON.stringify({
      type: "model_catalog_refreshed",
      requestId: refreshRequest.requestId,
      modelCatalog,
    }));

    await expect(promise).resolves.toBeUndefined();
    expect(session.modelCatalog).toEqual(modelCatalog);
    await session.dispose();
  });

  it("rejects only the correlated execution-route refresh failure", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    const ws = wsInstances[0]!;
    ws.simulateOpen();

    const promise = session.refreshModelCatalog();
    await Promise.resolve();
    const payload = ws.send.mock.calls.find(([candidate]) => (
      typeof candidate === "string"
      && candidate !== "ping"
      && (JSON.parse(candidate) as { type?: string }).type === "refresh_model_catalog"
    ))?.[0] as string;
    const request = JSON.parse(payload) as { readonly requestId: string };

    ws.simulateMessage(JSON.stringify({
      type: "model_catalog_refresh_failed",
      requestId: "stale-refresh",
      message: "stale failure",
    }));
    ws.simulateMessage(JSON.stringify({
      type: "model_catalog_refresh_failed",
      requestId: request.requestId,
      message: "Provider discovery timed out.",
    }));

    await expect(promise).rejects.toThrow("Provider discovery timed out.");
    await session.dispose();
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
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
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
      kilnSessionId: "session-1",
      content: "spoken answer",
      parts: [
        { type: "text", text: "spoken answer" },
        { type: "audio", mimeType: "audio/mpeg", data: "AQID", artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content" },
      ],
      inputTokens: 3,
      outputTokens: 4,
      ...COMPLETED_TURN_DISPOSITION,
    }));

    await collect;
    expect(events).toContainEqual({ type: "text_delta", content: "spoken answer" });
    expect(events).toContainEqual({
      type: "text_delta",
      content: "\n[Voice audio: Audio output | audio/mpeg | kiln://artifacts/voice-synthesis/artifact_1/content]",
    });
    await session.dispose();
  });

  it("preserves restored context evidence as historical TUI activity metadata", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();
    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of session.run({ prompt: "resume" })) {
        events.push(event);
      }
    })();

    await Promise.resolve();
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-context-restored",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-07-13T00:00:00.000Z",
        kind: "context_usage_observed",
        turnId: "session-1:turn:1",
        payload: {
          contextUsage: {
            state: "partial",
            usedTokens: 2400,
            providerId: "openai",
            modelId: "gpt-5",
            turnId: "session-1:turn:1",
            observedAt: "2026-07-12T23:59:00.000Z",
            measurement: "runtime_estimate",
            lifecycle: "restored",
            contextWindowAuthority: "unknown",
            freshness: "historical",
            reason: "No compatible context window was persisted.",
          },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({ type: "done", kilnSessionId: "session-1", content: "resumed",
                                                                          inputTokens: 1, outputTokens: 1,
                                                                          ...COMPLETED_TURN_DISPOSITION }));

    await collect;
    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      activity: "context_usage",
      metadata: {
        contextUsage: expect.objectContaining({ lifecycle: "restored", freshness: "historical" }),
      },
    }));
    await session.dispose();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("projects canonical tool and file events with session identity", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
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
        eventId: "evt-output",
        kilnSessionId: "session-1",
        sequence: 2,
        timestamp: "2026-04-28T20:00:00.500Z",
        kind: "tool_call_output_delta",
        turnId: "session-1:turn:live",
        payload: {
          toolCallId: "tool-1",
          toolName: "write",
          stream: "stdout",
          delta: "writing demo.txt\n",
          chunkIndex: 0,
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
      kilnSessionId: "session-1",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
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
        toolCallId: "tool-1",
        input: { path: "demo.txt" },
        surfaces: ["conversation_inline", "activity_panel", "inspector"],
      }),
      expect.objectContaining({
        type: "activity",
        activity: "tool_output",
        toolCallId: "tool-1",
        toolName: "write",
        stream: "stdout",
        output: "writing demo.txt\n",
        chunkIndex: 0,
        surfaces: ["activity_panel"],
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
        sessionEvent: expect.objectContaining({
          eventId: "evt-agent",
          kind: "agent_invocation_completed",
          kilnSessionId: "session-1",
        }),
      }),
    ]));

    await session.dispose();
  });

  it("projects canonical work item execution events with attempt state", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
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
      kilnSessionId: "session-1",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
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
        sessionEvent: expect.objectContaining({
          eventId: "evt-work-start",
          kind: "work_item_execution_started",
          kilnSessionId: "session-1",
        }),
      }),
    ]));

    await session.dispose();
  });

  it("projects lifecycle attribution as canonical activity evidence", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();

    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of session.run({ prompt: "measure lifecycle use" })) {
        events.push(event);
      }
    })();

    await Promise.resolve();
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-attribution",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-06-30T18:00:00.000Z",
        kind: "lifecycle_attribution_recorded",
        turnId: "session-1:turn:live",
        payload: {
          ledger: {
            sourceEventId: "evt-cost",
            context: { route: "codex-oauth/gpt-5.5" },
            records: [
              { source: "unknown", tokenClass: "raw", tokens: 100 },
              { source: "unknown", tokenClass: "generated", tokens: 20 },
            ],
          },
          summary: {
            totalTokens: 120,
            totalCostUsd: 0.0123,
            bySource: { unknown: 120 },
          },
          efficiencyEvidence: {
            schemaVersion: "verified-efficiency-evidence-v1",
            sessionId: "session-1",
            turnId: "session-1:turn:live",
            observedAt: "2026-06-30T18:00:00.000Z",
            provider: { providerId: "codex-oauth", modelId: "gpt-5.5", billingMode: "metered" },
            policy: {
              owner: "ContextGovernor",
              policyId: "context-whole-block-static-v1",
              configurationHash: `sha256:${"a".repeat(64)}`,
            },
            totals: {
              providerTotalTokens: 120,
              providerTotalCostUsd: 0.0123,
              measured: { tokens: 20, costUsd: 0.0023 },
              estimated: { tokens: 0, costUsd: 0 },
              cached: { tokens: 0, costUsd: 0 },
              unknown: { tokens: 100, costUsd: 0.01 },
              cacheWritten: { tokens: 0, costUsd: 0 },
              avoided: { tokens: 0, costUsd: 0 },
            },
            outcome: "succeeded",
            verification: { status: "not_run", results: [] },
            actions: [],
            savings: [],
            evidenceUris: [],
          },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "done",
      kilnSessionId: "session-1",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
    }));

    await collect;

    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      activity: "lifecycle_attribution_recorded",
      sessionId: "session-1",
      turnId: "session-1:turn:live",
      details: "Efficiency: 20 measured · 0 estimated · 0 cached · 0 avoided · verification not_run · context-whole-block-static-v1",
      surfaces: ["activity_panel", "inspector"],
      sessionEvent: expect.objectContaining({
        eventId: "evt-attribution",
        kind: "lifecycle_attribution_recorded",
        kilnSessionId: "session-1",
      }),
    }));

    await session.dispose();
  });

  it("projects read and tree tool results from full payload envelopes", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
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
          metadata: {
            toolName: "tree",
            kind: "inspection",
            operation: "tree",
            path: "C:\\workspace\\kiln",
            depth: 2,
            entryCount: 55,
          },
          resourceLinks: [
            {
              uri: "kiln://artifacts/tool-results/artifact_tree/content",
              title: "tree full output",
              mimeType: "text/plain",
              size: 9000,
              relation: "full_output",
            },
          ],
          toolUsage: {
            scope: "turn",
            toolName: "tree",
            calls: 1,
          },
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
      kilnSessionId: "session-1",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
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
        metadata: expect.objectContaining({
          operation: "tree",
          entryCount: 55,
        }),
        resourceLinks: [expect.objectContaining({
          uri: "kiln://artifacts/tool-results/artifact_tree/content",
          relation: "full_output",
        })],
        toolUsage: {
          scope: "turn",
          toolName: "tree",
          calls: 1,
        },
        toolPresentation: expect.objectContaining({
          outputKind: "tree",
          title: "C:\\workspace\\kiln",
        }),
      }),
    ]));
    expect(JSON.stringify(events)).not.toContain("{\\\"output\\\"");

    await session.dispose();
  });

  it("uses presentation intent text fallback for terminal tool results", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
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
      kilnSessionId: "session-1",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
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

  it("uses presentation intent text fallback for denied-skills terminal tool results", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();

    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of session.run({ prompt: "delegate write review" })) {
        events.push(event);
      }
    })();

    await Promise.resolve();
    ws.simulateMessage(JSON.stringify({
      type: "session_event",
      event: {
        eventId: "evt-managed-denied-skills",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-05-07T20:00:00.000Z",
        kind: "tool_call_completed",
        turnId: "session-1:turn:live",
        payload: {
          toolCallId: "tool-managed-denied",
          toolName: "managed_agent.invoke",
          outputSummary: JSON.stringify({
            output: "Managed invocation denied: Managed invocation denied skill(s): workspace-write",
            isError: true,
            metadata: {
              toolName: "managed_agent.invoke",
              kind: "managed-invocation",
              status: "denied",
              context: {
                mode: "isolated",
                agentProfile: "architecture-reviewer",
                skills: ["workspace-write"],
                deniedSkills: ["workspace-write"],
              },
              presentationIntent: {
                kind: "comparison_table",
                title: "Managed child invocation",
                summary: "opencode-readonly denied",
                source: "managed_agent.invoke",
                columns: [
                  { key: "routeId", label: "Route" },
                  { key: "provider", label: "Provider" },
                  { key: "status", label: "Status", valueKind: "status" },
                  { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
                  { key: "failureReason", label: "Failure" },
                ],
                rows: [
                  {
                    routeId: "opencode-readonly",
                    provider: "opencode",
                    status: "denied",
                    substantiveEvidence: false,
                    failureReason: "Managed invocation denied skill(s): workspace-write",
                  },
                ],
              },
            },
          }),
          status: { state: "failed" },
        },
      },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "done",
      kilnSessionId: "session-1",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
    }));

    await collect;

    const toolResult = events.find((event): event is { readonly output: string; readonly toolName: string } => {
      if (typeof event !== "object" || event === null) return false;
      const record = event as { readonly activity?: unknown; readonly toolName?: unknown; readonly output?: unknown };
      return record.activity === "tool_result"
        && record.toolName === "managed_agent.invoke"
        && typeof record.output === "string";
    });
    expect(toolResult?.output).toContain("| Route");
    expect(toolResult?.output).toContain("workspace-write");
    expect(toolResult?.output).not.toContain("\"metadata\"");
    expect(toolResult?.output).not.toContain("\"presentationIntent\"");

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
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();
    ws.simulateMessage(JSON.stringify({
      type: "welcome",
      modelCatalog: { observedAt: "2026-08-25T00:00:00.000Z", models: [] },
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
      kilnSessionId: "session-1",
      content: "",
      inputTokens: 1,
      outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
    }));
    await collect;
    await session.dispose();
  });

  it("sends requestedAuthority when provided on run options", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
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
      kilnSessionId: "session-1",
      content: "",
      inputTokens: 1,
      outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
    }));
    await collect;
    await session.dispose();
  });

  it("sends provider-neutral communication intent on the message frame", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();
    const collect = (async () => {
      for await (const _event of session.run({
        prompt: "summarize",
        communicationIntent: { responseDetail: "concise", requiredContent: ["warning"] },
      })) { /* drain */ }
    })();
    await Promise.resolve();
    expect(sentMessageFrame(ws)).toMatchObject({
      communicationIntent: { responseDetail: "concise", requiredContent: ["warning"] },
    });
    ws.simulateMessage(JSON.stringify({
      type: "done", kilnSessionId: "session-1", content: "", inputTokens: 1, outputTokens: 1,
      ...COMPLETED_TURN_DISPOSITION,
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

  it("adopts provider catalog evidence published after the welcome frame", async () => {
    const onWelcome = vi.fn();
    const session = new GatewaySession("ws://localhost:4801/tui/ws", onWelcome);
    const ws = wsInstances[0]!;
    ws.simulateOpen();
    ws.simulateMessage(JSON.stringify({
      type: "welcome",
      modelCatalog: { observedAt: "2026-08-25T00:00:00.000Z", models: [] },
    }));
    ws.simulateMessage(JSON.stringify({
      type: "provider_catalog_state",
      status: "ready",
      models: { "codex-oauth": ["gpt"] },
      providerDiscovery: [],
      providerModelDiscovery: EMPTY_PROVIDER_MODEL_DISCOVERY,
      modelCatalog: { observedAt: "2026-08-25T00:00:01.000Z", models: [] },
    }));

    expect(onWelcome).toHaveBeenLastCalledWith(
      { observedAt: "2026-08-25T00:00:01.000Z", models: [] },
      { "codex-oauth": ["gpt"] },
      [],
      EMPTY_PROVIDER_MODEL_DISCOVERY,
      { status: "ready" },
    );
    await session.dispose();
  });

  it("sends provider_auth and resolves matching completion", async () => {
    const onWelcome = vi.fn();
    const session = new GatewaySession("ws://localhost:4801/tui/ws", onWelcome);
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
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
      modelCatalog: { observedAt: "2026-08-25T00:00:00.000Z", models: [] },
      models: { "opencode-go": ["minimax-m2.5"] },
      providerDiscovery: [],
      providerModelDiscovery: EMPTY_PROVIDER_MODEL_DISCOVERY,
    }));

    await expect(promise).resolves.toBeUndefined();
    expect(onWelcome).toHaveBeenCalledWith(
      { observedAt: "2026-08-25T00:00:00.000Z", models: [] },
      { "opencode-go": ["minimax-m2.5"] },
      [],
      EMPTY_PROVIDER_MODEL_DISCOVERY,
    );
    await session.dispose();
  });

  it("forwards device code auth start details before completion", async () => {
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
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
      modelCatalog: { observedAt: "2026-08-25T00:00:00.000Z", models: [] },
      models: { "codex-oauth": ["gpt-5.4"] },
      providerDiscovery: [],
      providerModelDiscovery: EMPTY_PROVIDER_MODEL_DISCOVERY,
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
    const applyTheme = vi.fn().mockResolvedValue({ ok: true, appliedTheme: "vesper" });
    const clearHandler = setTuiOperatorThemeHandler(applyTheme);
    const session = new GatewaySession("ws://localhost:4801/tui/ws");
    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0]!;
    ws.simulateOpen();

    ws.simulateMessage(JSON.stringify({
      type: "operator_theme_set",
      requestId: "theme-1",
      theme: "vesper",
      reason: "test",
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(applyTheme).toHaveBeenCalledWith({
      theme: "vesper",
      reason: "test",
    });
    await waitForAssertion(() => {
      expect(ws.send.mock.calls.some(([payload]) => (
        typeof payload === "string"
        && payload !== "ping"
        && (JSON.parse(payload) as { type?: string }).type === "operator_theme_set_result"
      ))).toBe(true);
    });
    expect(sentOperatorThemeResultFrame(ws)).toMatchObject({
      requestId: "theme-1",
      ok: true,
      appliedTheme: "vesper",
    });

    clearHandler();
    await session.dispose();
  });
});
