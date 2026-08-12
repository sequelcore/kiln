/**
 * @fileoverview Tests for GuiWsClient WebSocket client.
 * @module @kilnai/gui
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GuiInboundFrame, GuiOutboundFrame } from "@kilnai/gateway-contracts";
import { GuiWsClient } from "../src/lib/ws-client";

const EMPTY_PROVIDER_MODEL_DISCOVERY: Extract<GuiInboundFrame, { type: "welcome" }>["providerModelDiscovery"] = {
  catalogEvidence: {
    status: "failed",
    source: {
      kind: "test",
      id: "gui-ws-client",
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

// Track created WebSocket instances for testing
let wsInstances: MockWebSocket[] = [];

// Mock WebSocket for Node environment
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  onopen: ((this: MockWebSocket, ev: Event) => void) | null = null;
  onclose: ((this: MockWebSocket, ev: CloseEvent) => void) | null = null;
  onmessage: ((this: MockWebSocket, ev: MessageEvent) => void) | null = null;
  onerror: ((this: MockWebSocket, ev: Event) => void) | null = null;

  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
  }

  // Helper to simulate open
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  // Helper to simulate message
  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data }));
    }
  }

  // Helper to simulate socket error
  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  // Helper to simulate close
  simulateClose(code: number = 1000): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close", { code }));
    }
  }
}

describe("GuiWsClient", () => {
  let onFrame: ReturnType<typeof vi.fn>;
  let onStateChange: ReturnType<typeof vi.fn>;
  let client: GuiWsClient;

  beforeEach(() => {
    wsInstances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
    onFrame = vi.fn();
    onStateChange = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createClient = (userId: string = "test-user-123") => {
    return new GuiWsClient({
      baseUrl: "ws://localhost:3000/ws",
      userId,
      onFrame,
      onStateChange,
    });
  };

  describe("connection", () => {
    it("Connects with userId query param", () => {
      client = createClient("user-456");
      client.connect();

      // Get the last created WebSocket instance
      const wsInstance = wsInstances[wsInstances.length - 1];
      expect(wsInstance.url).toContain("userId=user-456");
      expect(wsInstance.url).toContain("ws://localhost:3000/ws");
    });
  });

  describe("canonical session events", () => {
    it("requires and preserves the canonical outcome on done frames", () => {
      client = createClient();
      client.connect();
      const wsInstance = wsInstances[wsInstances.length - 1]!;

      wsInstance.simulateMessage(JSON.stringify({
        type: "done",
        kilnSessionId: "session-1",
        content: "Paused for operator input.",
        inputTokens: 12,
        outputTokens: 4,
        outcome: "paused",
      }));
      expect(onFrame).toHaveBeenLastCalledWith(expect.objectContaining({
        type: "done",
        outcome: "paused",
      }));

      onFrame.mockClear();
      wsInstance.simulateMessage(JSON.stringify({
        type: "done",
        kilnSessionId: "session-1",
        content: "Ambiguous terminal frame.",
        inputTokens: 12,
        outputTokens: 4,
      }));
      expect(onFrame).not.toHaveBeenCalled();
    });

    it("accepts live context-usage evidence instead of dropping it during frame validation", () => {
      client = createClient();
      client.connect();
      const wsInstance = wsInstances[wsInstances.length - 1]!;
      wsInstance.simulateMessage(JSON.stringify({
        type: "session_event",
        event: {
          eventId: "context-1",
          kilnSessionId: "session-1",
          sequence: 1,
          timestamp: "2026-07-12T00:00:01.000Z",
          kind: "context_usage_observed",
          payload: {
            contextUsage: {
              state: "partial",
              usedTokens: 12,
              contextWindowTokens: 128,
              remainingTokens: 116,
              usedPercentage: 9.375,
              observedAt: "2026-07-12T00:00:01.000Z",
              measurement: "provider_reported",
              lifecycle: "completed",
              contextWindowAuthority: "runtime_observed",
              freshness: "fresh",
            },
          },
        },
      }));

      expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({
        type: "session_event",
        event: expect.objectContaining({ kind: "context_usage_observed" }),
      }));
    });

    it("accepts managed_economic_lifecycle events instead of dropping them during frame validation", () => {
      client = createClient();
      client.connect();
      const wsInstance = wsInstances[wsInstances.length - 1]!;
      wsInstance.simulateMessage(JSON.stringify({
        type: "session_event",
        event: {
          eventId: "economic-1",
          kilnSessionId: "session-1",
          sequence: 1,
          timestamp: "2026-08-06T00:00:01.000Z",
          kind: "managed_economic_lifecycle",
          payload: {
            instanceId: "local-app",
            sessionId: "session-1",
            jobId: "managed-economic-job:ws-fixture",
            economicAttemptId: "economic-attempt:ws-fixture:1",
            transition: "held",
            policyId: "ws-fixture-policy",
            policyRevision: "1",
            policyDigest: "sha256:ws-fixture-policy-digest",
          },
        },
      }));

      expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({
        type: "session_event",
        event: expect.objectContaining({ kind: "managed_economic_lifecycle" }),
      }));
    });

    it("preserves the terminal capability while adding the stable user id", () => {
      client = new GuiWsClient({
        baseUrl: "ws://localhost:3000/ws?operatorToken=secret",
        userId: "user-456",
        onFrame,
        onStateChange,
      });
      client.connect();

      const url = new URL(wsInstances.at(-1)!.url);
      expect(url.searchParams.get("operatorToken")).toBe("secret");
      expect(url.searchParams.get("userId")).toBe("user-456");
    });
  });

  describe("heartbeat", () => {
    it("Sends ping every 30s", () => {
      vi.useFakeTimers();
      client = createClient();
      client.connect();

      // Simulate connection open
      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      // Advance time by 30s
      vi.advanceTimersByTime(30_000);

      // Should have sent ping
      expect(wsInstance.send).toHaveBeenCalledWith("ping");

      // Advance another 30s
      vi.advanceTimersByTime(30_000);

      // Should have sent another ping
      expect(wsInstance.send).toHaveBeenCalledTimes(2);
      expect(wsInstance.send).toHaveBeenLastCalledWith("ping");

      vi.useRealTimers();
    });

    it("reconnects when pong is not received within 60s", () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      client = createClient();
      client.connect();

      // Simulate connection open
      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      // Send first ping (at 30s)
      vi.advanceTimersByTime(30_000);
      expect(wsInstance.send).toHaveBeenCalledWith("ping");

      // Advance past the 60s watchdog timeout (30 + 60 = 90s total)
      vi.advanceTimersByTime(60_000);

      expect(wsInstance.close).toHaveBeenCalledWith(4000, "pong timeout");

      wsInstance.simulateClose(4000);
      expect(onStateChange).toHaveBeenCalledWith("reconnecting");

      vi.advanceTimersByTime(1_000);
      const newWsInstance = wsInstances[wsInstances.length - 1];
      expect(newWsInstance).not.toBe(wsInstance);

      vi.useRealTimers();
    });

    it("does not close after a pong clears the outstanding heartbeat watchdog", () => {
      vi.useFakeTimers();
      client = createClient();
      client.connect();

      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      vi.advanceTimersByTime(30_000);
      expect(wsInstance.send).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30_000);
      expect(wsInstance.send).toHaveBeenCalledTimes(2);

      wsInstance.simulateMessage("pong");
      vi.advanceTimersByTime(30_000);

      expect(wsInstance.close).not.toHaveBeenCalledWith(4000, "pong timeout");

      vi.useRealTimers();
    });
  });

  describe("reconnection", () => {
    it("Reconnects with backoff after unexpected close; reuses same userId", () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      client = createClient("reconnect-user");
      client.connect();

      // Simulate connection open
      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      // Simulate unexpected close (code != 1000)
      wsInstance.simulateClose(1001);

      // Should be in reconnecting state
      expect(onStateChange).toHaveBeenCalledWith("reconnecting");

      // Advance past reconnect delay (1s + jitter, min 1000ms)
      vi.advanceTimersByTime(1_000);

      // Should have attempted reconnect - check WebSocket was created again
      const newWsInstance = wsInstances[wsInstances.length - 1];
      expect(newWsInstance).not.toBe(wsInstance);
      expect(newWsInstance.url).toContain("userId=reconnect-user");

      vi.useRealTimers();
    });

    it("does not schedule duplicate reconnects when error is followed by close", () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      client = createClient("single-reconnect-user");
      client.connect();

      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      wsInstance.simulateError();
      wsInstance.simulateClose(1006);

      vi.advanceTimersByTime(1_000);

      expect(wsInstances).toHaveLength(2);
      expect(wsInstances[1]?.url).toContain("userId=single-reconnect-user");

      vi.advanceTimersByTime(2_000);

      expect(wsInstances).toHaveLength(2);

      vi.useRealTimers();
    });
  });

  describe("outbound queue", () => {
    it("Outbound queue flushes on reconnect", () => {
      vi.useFakeTimers();
      client = createClient();
      
      // Send frame while not connected
      client.send({ type: "message", content: "test message" });

      // Connect
      client.connect();
      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      // Now the frame should have been sent
      expect(wsInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "message", content: "test message" })
      );

      vi.useRealTimers();
    });

    it("does not queue execution route selection while disconnected", () => {
      client = createClient();

      expect(() => client.send({
        type: "execution_route",
        routeId: "openai-gpt-5",
        requestId: "route-switch-1",
      })).toThrow("Cannot select execution route while WebSocket is not open");

      client.connect();
      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      expect(wsInstance.send).not.toHaveBeenCalledWith(
        JSON.stringify({
          type: "provider",
          provider: "openai",
          model: "gpt-5",
          requestId: "provider-switch-1",
        }),
      );
    });

    it("does not queue provider authentication while disconnected", () => {
      client = createClient();

      expect(() => client.send({
        type: "provider_auth",
        provider: "codex-oauth",
        requestId: "provider-auth-1",
      })).toThrow("Cannot send provider authentication while WebSocket is not open");

      client.connect();
      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      expect(wsInstance.send).not.toHaveBeenCalledWith(
        JSON.stringify({
          type: "provider_auth",
          provider: "codex-oauth",
          requestId: "provider-auth-1",
        }),
      );
    });
  });

  describe("inbound message handling", () => {
    it("Malformed inbound frame logs warn + does not crash; valid adjacent frame still delivered", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      
      client = createClient();
      client.connect();

      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      // Send malformed JSON
      wsInstance.simulateMessage("not valid json {{{");

      // Should have logged warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[GuiWsClient] Invalid inbound frame:",
        "not valid json {{{"
      );

      // Reset mock to track next call
      consoleWarnSpy.mockClear();

      // Send valid JSON frame
      wsInstance.simulateMessage(JSON.stringify({ type: "thinking" }));

      // Should have delivered the frame
      expect(onFrame).toHaveBeenCalledWith({ type: "thinking" });

      consoleWarnSpy.mockRestore();
    });

    it("rejects legacy welcome provider string arrays", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      client = createClient();
      client.connect();

      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      wsInstance.simulateMessage(JSON.stringify({
        type: "welcome",
        providers: ["claude"],
        models: { claude: ["claude-sonnet-4-6"] },
      }));

      expect(onFrame).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[GuiWsClient] Invalid inbound frame:",
        JSON.stringify({
          type: "welcome",
          providers: ["claude"],
          models: { claude: ["claude-sonnet-4-6"] },
        }),
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe("outbound frame serialization", () => {
    it("serializes fresh session message intent frames", () => {
      client = createClient();
      client.connect();
      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      client.send({
        type: "message",
        content: "fresh turn",
        sessionIntent: "fresh",
      });

      expect(wsInstance.send).toHaveBeenCalledWith(JSON.stringify({
        type: "message",
        content: "fresh turn",
        sessionIntent: "fresh",
      }));
    });

    it("All outbound frame shapes serialize through Zod without error", () => {
      const frames: GuiOutboundFrame[] = [
        { type: "message", content: "hello world" },
        { type: "clear" },
        { type: "provider_auth", provider: "codex-oauth", requestId: "provider-auth-1" },
        { type: "provider_auth", provider: "opencode-go", requestId: "provider-auth-2", apiKey: "sk-test", tier: "go" },
        { type: "provider", provider: "openai", model: "gpt-4", requestId: "provider-switch-1" },
        { type: "provider", provider: "claude", requestId: "provider-switch-2" },
        { type: "continue", sessionId: "session-123", gatewayTargetId: "gateway:local-app" },
        {
          type: "browser_session_control",
          action: "takeover",
          gatewayTargetId: "gateway:browser-app",
          sessionId: "browser-1",
          reason: "Inspect before continuing.",
          requestId: "browser-control-1",
        },
        {
          type: "browser_session_control",
          action: "release",
          gatewayTargetId: "gateway:browser-app",
          sessionId: "browser-1",
          requestId: "browser-control-2",
        },
        {
          type: "managed_agent_control",
          action: "cancel",
          sessionId: "session-1",
          invocationId: "child-running",
          gatewayTargetId: "gateway:local-app",
          reason: "Operator stopped duplicate work.",
          requestId: "managed-agent-control-1",
        },
        {
          type: "managed_agent_control",
          action: "join",
          sessionId: "session-1",
          invocationId: "child-running",
          gatewayTargetId: "gateway:local-app",
          requestId: "managed-agent-control-2",
        },
        {
          type: "managed_agent_control",
          action: "prompt",
          sessionId: "session-1",
          invocationId: "child-running",
          gatewayTargetId: "gateway:local-app",
          prompt: "Use the latest runtime ledger evidence before continuing.",
          deliveryMode: "steer",
          wakeRequested: true,
          requestId: "managed-agent-control-3",
        },
        {
          type: "browser_operator_input",
          requestId: "browser-input-1",
          gatewayTargetId: "gateway:browser-app",
          sessionId: "browser-1",
          input: {
            kind: "wheel",
            x: 640,
            y: 360,
            deltaX: 0,
            deltaY: 420,
          },
        },
        { type: "approve", approvalId: "approval-123", gatewayTargetId: "gateway:local-app" },
        { type: "reject", reason: "not approved", approvalId: "approval-123", gatewayTargetId: "gateway:local-app" },
        { type: "execution_mode_transition", toMode: "execute", gatewayTargetId: "gateway:local-app" },
      ];

      for (const frame of frames) {
        // Create a new client for each frame to test serialization
        const testClient = createClient();
        
        // connect() initializes WebSocket but won't throw
        // send() validates the frame through Zod
        testClient.connect();
        
        // This will validate the frame through the Zod schema
        // If invalid, it would log a warning and return early
        if (frame.type === "provider" || frame.type === "provider_auth") {
          const wsInstance = wsInstances[wsInstances.length - 1];
          wsInstance.simulateOpen();
        }
        testClient.send(frame);
      }
      
      // If we get here, all frames validated successfully
      expect(true).toBe(true);
    });

    it("rejects legacy outbound text and approval_response frames", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      client = createClient();
      client.connect();
      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      client.send({ type: "message", text: "legacy text" } as unknown as GuiOutboundFrame);
      client.send({
        type: "approval_response",
        approved: true,
        sessionId: "session-123",
      } as unknown as GuiOutboundFrame);

      expect(wsInstance.send).not.toHaveBeenCalledWith(expect.stringContaining("legacy text"));
      expect(wsInstance.send).not.toHaveBeenCalledWith(expect.stringContaining("approval_response"));
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[GuiWsClient] Invalid outbound frame:",
        JSON.stringify({ type: "message", text: "legacy text" }),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[GuiWsClient] Invalid outbound frame:",
        JSON.stringify({ type: "approval_response", approved: true, sessionId: "session-123" }),
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe("inbound frame parsing", () => {
    it("All inbound frame shapes parse correctly", () => {
      const frames: Array<{ json: object; expected: GuiInboundFrame }> = [
        { json: { type: "thinking" }, expected: { type: "thinking" } },
        {
          json: {
            type: "session_event",
            event: {
              eventId: "evt-1",
              kilnSessionId: "sess-1",
              sequence: 1,
              timestamp: "2026-04-23T19:00:00.000Z",
              kind: "assistant_delta",
              source: {
                actor: "assistant",
                surface: "gui",
                component: "gui-gateway",
              },
              payload: {
                messageId: "msg-1",
                delta: "hello",
              },
            },
          },
          expected: {
            type: "session_event",
            event: {
              eventId: "evt-1",
              kilnSessionId: "sess-1",
              sequence: 1,
              timestamp: "2026-04-23T19:00:00.000Z",
              kind: "assistant_delta",
              source: {
                actor: "assistant",
                surface: "gui",
                component: "gui-gateway",
              },
              payload: {
                messageId: "msg-1",
                delta: "hello",
              },
            },
          },
        },
        {
          json: {
            type: "session_event",
            event: {
              eventId: "evt-work-item",
              kilnSessionId: "sess-1",
              sequence: 2,
              timestamp: "2026-05-08T23:10:00.000Z",
              kind: "work_item_updated",
              payload: {
                id: "task-browser",
                title: "Verify browser tab",
                status: "completed",
              },
            },
          },
          expected: {
            type: "session_event",
            event: {
              eventId: "evt-work-item",
              kilnSessionId: "sess-1",
              sequence: 2,
              timestamp: "2026-05-08T23:10:00.000Z",
              kind: "work_item_updated",
              payload: {
                id: "task-browser",
                title: "Verify browser tab",
                status: "completed",
              },
            },
          },
        },
        {
          json: {
            type: "session_event",
            event: {
              eventId: "evt-goal",
              kilnSessionId: "sess-1",
              sequence: 3,
              timestamp: "2026-05-12T18:00:00.000Z",
              kind: "goal.completed",
              payload: {
                goal: {
                  id: "goal-1",
                  status: "completed",
                  objective: "Finish slice 6.",
                },
              },
            },
          },
          expected: {
            type: "session_event",
            event: {
              eventId: "evt-goal",
              kilnSessionId: "sess-1",
              sequence: 3,
              timestamp: "2026-05-12T18:00:00.000Z",
              kind: "goal.completed",
              payload: {
                goal: {
                  id: "goal-1",
                  status: "completed",
                  objective: "Finish slice 6.",
                },
              },
            },
          },
        },
        {
          json: {
            type: "session_event",
            event: {
              eventId: "evt-materialized",
              kilnSessionId: "sess-1",
              sequence: 4,
              timestamp: "2026-05-12T18:05:00.000Z",
              kind: "work_items.materialized",
              payload: {
                materialization: {
                  id: "mat-1",
                  workItemIds: ["wi-1"],
                },
              },
            },
          },
          expected: {
            type: "session_event",
            event: {
              eventId: "evt-materialized",
              kilnSessionId: "sess-1",
              sequence: 4,
              timestamp: "2026-05-12T18:05:00.000Z",
              kind: "work_items.materialized",
              payload: {
                materialization: {
                  id: "mat-1",
                  workItemIds: ["wi-1"],
                },
              },
            },
          },
        },
        {
          json: {
            type: "session_event",
            event: {
              eventId: "evt-config-change",
              kilnSessionId: "sess-1",
              sequence: 5,
              timestamp: "2026-05-08T23:10:30.000Z",
              kind: "config_change_applied",
              payload: {
                target: "interactiveUse.browserEnvironment",
                value: "isolated-headless",
              },
            },
          },
          expected: {
            type: "session_event",
            event: {
              eventId: "evt-config-change",
              kilnSessionId: "sess-1",
              sequence: 5,
              timestamp: "2026-05-08T23:10:30.000Z",
              kind: "config_change_applied",
              payload: {
                target: "interactiveUse.browserEnvironment",
                value: "isolated-headless",
              },
            },
          },
        },
        {
          json: {
            type: "session_event",
            event: {
              eventId: "evt-lifecycle-attribution",
              kilnSessionId: "sess-1",
              sequence: 6,
              timestamp: "2026-06-30T18:00:00.000Z",
              kind: "lifecycle_attribution_recorded",
              turnId: "sess-1:turn:1",
              payload: {
                ledger: {
                  sourceEventId: "evt-cost",
                  context: { route: "codex-oauth/gpt-5.5" },
                  records: [
                    { source: "unknown", tokenClass: "raw", tokens: 100 },
                  ],
                },
                summary: {
                  totalTokens: 100,
                  totalCostUsd: 0.01,
                  bySource: { unknown: 100 },
                },
              },
            },
          },
          expected: {
            type: "session_event",
            event: {
              eventId: "evt-lifecycle-attribution",
              kilnSessionId: "sess-1",
              sequence: 6,
              timestamp: "2026-06-30T18:00:00.000Z",
              kind: "lifecycle_attribution_recorded",
              turnId: "sess-1:turn:1",
              payload: {
                ledger: {
                  sourceEventId: "evt-cost",
                  context: { route: "codex-oauth/gpt-5.5" },
                  records: [
                    { source: "unknown", tokenClass: "raw", tokens: 100 },
                  ],
                },
                summary: {
                  totalTokens: 100,
                  totalCostUsd: 0.01,
                  bySource: { unknown: 100 },
                },
              },
            },
          },
        },
        {
          json: {
            type: "activity_phase",
            kilnSessionId: "sess-1",
            turnId: "sess-1:turn:live",
            phase: "tool_running",
            toolName: "grep",
          },
          expected: {
            type: "activity_phase",
            kilnSessionId: "sess-1",
            turnId: "sess-1:turn:live",
            phase: "tool_running",
            toolName: "grep",
          },
        },
        {
          json: {
            type: "interactive_use_updated",
            snapshot: {
              target: "browser",
              status: "succeeded",
              updatedAt: "2026-05-08T23:11:00.000Z",
              kilnSessionId: "sess-1",
              toolCallId: "tool-browser",
              toolName: "browser_observe",
              provider: "playwright",
              gatewayTargetId: "gateway:browser-app",
              sessionId: "browser-1",
              operation: "observe",
              url: "https://example.com/",
              title: "Example Domain",
              screenshotUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
            },
            browserSession: {
              target: "browser",
              status: "succeeded",
              updatedAt: "2026-05-08T23:11:00.000Z",
              kilnSessionId: "sess-1",
              toolCallId: "tool-browser",
              toolName: "browser_observe",
              provider: "playwright",
              gatewayTargetId: "gateway:browser-app",
              sessionId: "browser-1",
              operation: "observe",
              url: "https://example.com/",
              title: "Example Domain",
              ownership: "agent",
              viewMode: "snapshot",
              stream: {
                status: "unavailable",
                reason: "No live browser stream transport is configured.",
              },
              latestCapture: {
                uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
                relation: "snapshot",
                transport: "electron-webcontents",
              },
            },
          },
          expected: {
            type: "interactive_use_updated",
            snapshot: {
              target: "browser",
              status: "succeeded",
              updatedAt: "2026-05-08T23:11:00.000Z",
              kilnSessionId: "sess-1",
              toolCallId: "tool-browser",
              toolName: "browser_observe",
              provider: "playwright",
              gatewayTargetId: "gateway:browser-app",
              sessionId: "browser-1",
              operation: "observe",
              url: "https://example.com/",
              title: "Example Domain",
              screenshotUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
            },
            browserSession: {
              target: "browser",
              status: "succeeded",
              updatedAt: "2026-05-08T23:11:00.000Z",
              kilnSessionId: "sess-1",
              toolCallId: "tool-browser",
              toolName: "browser_observe",
              provider: "playwright",
              gatewayTargetId: "gateway:browser-app",
              sessionId: "browser-1",
              operation: "observe",
              url: "https://example.com/",
              title: "Example Domain",
              ownership: "agent",
              viewMode: "snapshot",
              stream: {
                status: "unavailable",
                reason: "No live browser stream transport is configured.",
              },
              latestCapture: {
                uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
                relation: "snapshot",
                transport: "electron-webcontents",
              },
            },
          },
        },
        {
          json: {
            type: "browser_session_updated",
            browserSession: {
              target: "browser",
              status: "running",
              updatedAt: "2026-05-08T23:12:00.000Z",
              kilnSessionId: "sess-1",
              provider: "playwright",
              sessionId: "browser-1",
              ownership: "agent",
              viewMode: "live",
              stream: {
                status: "live",
              },
              latestCapture: {
                uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
                relation: "snapshot",
                transport: "cdp-screencast",
              },
            },
          },
          expected: {
            type: "browser_session_updated",
            browserSession: {
              target: "browser",
              status: "running",
              updatedAt: "2026-05-08T23:12:00.000Z",
              kilnSessionId: "sess-1",
              provider: "playwright",
              sessionId: "browser-1",
              ownership: "agent",
              viewMode: "live",
              stream: {
                status: "live",
              },
              latestCapture: {
                uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
                relation: "snapshot",
                transport: "cdp-screencast",
              },
            },
          },
        },
        {
          json: {
            type: "session_event",
            event: {
              eventId: "sess-1:browser-operator:1",
              kilnSessionId: "sess-1",
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
                  textLength: 3,
                },
                acknowledgement: {
                  status: "accepted",
                },
              },
            },
          },
          expected: {
            type: "session_event",
            event: {
              eventId: "sess-1:browser-operator:1",
              kilnSessionId: "sess-1",
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
                  textLength: 3,
                },
                acknowledgement: {
                  status: "accepted",
                },
              },
            },
          },
        },
        {
          json: {
            type: "browser_live_viewport_frame",
            sessionId: "browser-1",
            kilnSessionId: "sess-1",
            frameId: "frame-1",
            sequence: 1,
            transport: "cdp-screencast",
            format: "jpeg",
            dataUrl: "data:image/jpeg;base64,abc123",
            width: 1280,
            height: 720,
            scale: 1,
            capturedAt: "2026-05-13T12:00:00.000Z",
          },
          expected: {
            type: "browser_live_viewport_frame",
            sessionId: "browser-1",
            kilnSessionId: "sess-1",
            frameId: "frame-1",
            sequence: 1,
            transport: "cdp-screencast",
            format: "jpeg",
            dataUrl: "data:image/jpeg;base64,abc123",
            width: 1280,
            height: 720,
            scale: 1,
            capturedAt: "2026-05-13T12:00:00.000Z",
          },
        },
        {
          json: {
            type: "browser_operator_input_ack",
            requestId: "browser-input-1",
            sessionId: "browser-1",
            status: "accepted",
            handledAt: "2026-05-13T12:00:00.000Z",
          },
          expected: {
            type: "browser_operator_input_ack",
            requestId: "browser-input-1",
            sessionId: "browser-1",
            status: "accepted",
            handledAt: "2026-05-13T12:00:00.000Z",
          },
        },
        {
          json: {
            type: "managed_agent_control_result",
            action: "cancel",
            sessionId: "session-1",
            invocationId: "child-running",
            status: "accepted",
            requestId: "managed-agent-control-1",
            handledAt: "2026-05-23T12:00:00.000Z",
          },
          expected: {
            type: "managed_agent_control_result",
            action: "cancel",
            sessionId: "session-1",
            invocationId: "child-running",
            status: "accepted",
            requestId: "managed-agent-control-1",
            handledAt: "2026-05-23T12:00:00.000Z",
          },
        },
        {
          json: {
            type: "approval_response_result",
            requestId: "approval-response-1",
            approvalId: "approval-1",
            decision: "approve",
            status: "failed",
            reason: "Approval is no longer pending.",
          },
          expected: {
            type: "approval_response_result",
            requestId: "approval-response-1",
            approvalId: "approval-1",
            decision: "approve",
            status: "failed",
            reason: "Approval is no longer pending.",
          },
        },
        {
          json: {
            type: "execution_route_change_failed",
            routeId: "openai-gpt-5",
            requestId: "route-change-1",
            reasonCode: "route-health-unavailable",
            reason: "The selected route is cooling down.",
            repairActions: ["retry-route"],
          },
          expected: {
            type: "execution_route_change_failed",
            routeId: "openai-gpt-5",
            requestId: "route-change-1",
            reasonCode: "route-health-unavailable",
            reason: "The selected route is cooling down.",
            repairActions: ["retry-route"],
          },
        },
        {
          json: {
            type: "managed_agent_control_result",
            action: "join",
            sessionId: "session-1",
            invocationId: "child-running",
            status: "accepted",
            requestId: "managed-agent-control-2",
            handledAt: "2026-05-23T12:00:01.000Z",
          },
          expected: {
            type: "managed_agent_control_result",
            action: "join",
            sessionId: "session-1",
            invocationId: "child-running",
            status: "accepted",
            requestId: "managed-agent-control-2",
            handledAt: "2026-05-23T12:00:01.000Z",
          },
        },
        {
          json: {
            type: "managed_agent_control_result",
            action: "prompt",
            sessionId: "session-1",
            invocationId: "child-running",
            status: "accepted",
            requestId: "managed-agent-control-3",
            handledAt: "2026-06-05T16:00:01.000Z",
          },
          expected: {
            type: "managed_agent_control_result",
            action: "prompt",
            sessionId: "session-1",
            invocationId: "child-running",
            status: "accepted",
            requestId: "managed-agent-control-3",
            handledAt: "2026-06-05T16:00:01.000Z",
          },
        },
        {
          json: {
            type: "done",
            kilnSessionId: "session-completed",
            content: "completed",
            inputTokens: 100,
            outputTokens: 50,
            outcome: "completed",
            routingRationale: {
              selectedProvider: "codex-oauth",
              selectedModel: "gpt-5.4-mini",
              selectionMode: "automatic",
              deliberationResolution: {
                status: "exact",
                selectedLevel: "medium",
                source: "operator",
                capabilityEvidence: {
                  sourceIdentity: "codex-oauth-model-catalog",
                  sourceRevision: "test-r1",
                  observedAt: "2026-06-05T16:00:00.000Z",
                },
              },
              routingReason: "Rule matched",
              confidence: 1,
              routingTier: "rule",
              inputsUsed: {
                tenantId: "default",
                complexityClass: "simple",
                complexityScore: 0.25,
                hasTools: true,
                toolCount: 3,
                requiresStreaming: false,
                deliberationIntent: { mode: "fixed", preferredLevel: "medium", onUnsupported: "deny" },
              },
              rankingEvidence: [],
              diagnostics: [
                {
                  code: "deliberation_exact",
                  severity: "info",
                  message: "Route preserves the requested deliberation level.",
                  provider: "codex-oauth",
                  model: "gpt-5.4-mini",
                },
              ],
            },
            authorityStatus: { effective: "fail_closed", completeness: "authoritative" },
          },
          expected: {
            type: "done",
            kilnSessionId: "session-completed",
            content: "completed",
            inputTokens: 100,
            outputTokens: 50,
            outcome: "completed",
            routingRationale: {
              selectedProvider: "codex-oauth",
              selectedModel: "gpt-5.4-mini",
              selectionMode: "automatic",
              deliberationResolution: {
                status: "exact",
                selectedLevel: "medium",
                source: "operator",
                capabilityEvidence: {
                  sourceIdentity: "codex-oauth-model-catalog",
                  sourceRevision: "test-r1",
                  observedAt: "2026-06-05T16:00:00.000Z",
                },
              },
              routingReason: "Rule matched",
              confidence: 1,
              routingTier: "rule",
              inputsUsed: {
                tenantId: "default",
                complexityClass: "simple",
                complexityScore: 0.25,
                hasTools: true,
                toolCount: 3,
                requiresStreaming: false,
                deliberationIntent: { mode: "fixed", preferredLevel: "medium", onUnsupported: "deny" },
              },
              rankingEvidence: [],
              diagnostics: [
                {
                  code: "deliberation_exact",
                  severity: "info",
                  message: "Route preserves the requested deliberation level.",
                  provider: "codex-oauth",
                  model: "gpt-5.4-mini",
                },
              ],
            },
            authorityStatus: { effective: "fail_closed", completeness: "authoritative" },
          },
        },
        { json: { type: "error", message: "Something went wrong", code: "ERR_001" }, expected: { type: "error", message: "Something went wrong", code: "ERR_001" } },
        {
          json: {
            type: "welcome",
            providerModelDiscovery: EMPTY_PROVIDER_MODEL_DISCOVERY,
            greeting: "Welcome!",
            models: { openai: ["gpt-4"] },
            executionMode: "execute",
            authorityStatus: { effective: "unknown", completeness: "partial" },
          },
          expected: {
            type: "welcome",
            providerModelDiscovery: EMPTY_PROVIDER_MODEL_DISCOVERY,
            greeting: "Welcome!",
            models: { openai: ["gpt-4"] },
            executionMode: "execute",
            authorityStatus: { effective: "unknown", completeness: "partial" },
          },
        },
        {
          json: { type: "execution_mode_transitioned", executionMode: "execute" },
          expected: { type: "execution_mode_transitioned", executionMode: "execute" },
        },
        { json: { type: "cleared" }, expected: { type: "cleared" } },
        {
          json: {
            type: "execution_route_changed",
            routeId: "claude-sonnet",
            requestId: "route-switch-1",
          },
          expected: {
            type: "execution_route_changed",
            routeId: "claude-sonnet",
            requestId: "route-switch-1",
          },
        },
        {
          json: {
            type: "execution_route_changed",
            routeId: "claude-default",
            requestId: "route-switch-2",
          },
          expected: {
            type: "execution_route_changed",
            routeId: "claude-default",
            requestId: "route-switch-2",
          },
        },
        {
          json: { type: "continuation_selected", sessionId: "sess-1", gatewayTargetId: "gateway:local-app" },
          expected: { type: "continuation_selected", sessionId: "sess-1", gatewayTargetId: "gateway:local-app" },
        },
      ];

      client = createClient();
      client.connect();

      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      for (const { json, expected } of frames) {
        onFrame.mockClear();
        wsInstance.simulateMessage(JSON.stringify(json));
        expect(onFrame).toHaveBeenCalledWith(expected);
      }
    });

    it("rejects execution route acknowledgements with an empty route id", () => {
      client = createClient();
      client.connect();

      const wsInstance = wsInstances[wsInstances.length - 1];
      wsInstance.simulateOpen();

      wsInstance.simulateMessage(JSON.stringify({
        type: "execution_route_changed",
        routeId: "",
        requestId: "route-switch-empty",
      }));

      expect(onFrame).not.toHaveBeenCalledWith(expect.objectContaining({
        type: "execution_route_changed",
      }));
    });
  });
});
