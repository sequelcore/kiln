import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "@kilnai/core";
import { textParts } from "@kilnai/core";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

vi.mock("hono/bun", () => ({
  createBunWebSocket: () => ({
    upgradeWebSocket: vi.fn(),
    websocket: {},
  }),
}));

function makeSession(): RuntimeSession {
  return new RuntimeSession({
    appName: "kiln-tui",
    tenantId: "_tui",
    userId: "operator-1",
    systemPrompt: "You are a helpful assistant.",
  });
}

function getReinjectedToolResultFromSecondCall(provider: ProviderAdapter): string {
  const calls = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls;
  const secondCall = calls[1]?.[0] as {
    messages?: Array<{ role?: string; parts?: Array<{ type?: string; content?: unknown }> }>;
  } | undefined;
  const messages = secondCall?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const parts = msg.parts ?? [];
    const toolResult = parts.find((part) => part?.type === "tool_result");
    if (toolResult && typeof toolResult.content === "string") {
      return toolResult.content;
    }
  }
  throw new Error("No reinjected tool_result content found in second provider call.");
}

describe("TUI authority forwarding", () => {
  it("builds explicit fail-closed per-call config when no executable provider is active", async () => {
    const { buildTuiPerCallToolConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiPerCallToolConfig();

    expect(cfg.tenantId).toBe("_tui");
    expect(cfg.toolAllowlist).toBeInstanceOf(Set);
    expect(cfg.toolAllowlist?.size).toBe(0);
    expect(cfg.toolAuthority).toBeInstanceOf(Map);
    expect(cfg.toolAuthority?.size).toBe(0);
  });

  it("derives TUI authority status from fail-closed config", async () => {
    const { buildTuiPerCallToolConfig, deriveTuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiPerCallToolConfig();

    expect(deriveTuiAuthorityStatusFromPerCallConfig(cfg)).toEqual({
      effective: "fail_closed",
      completeness: "authoritative",
    });
  });

  it("exposes the builtin tool surface for kiln-executable direct providers", async () => {
    const { buildTuiTurnPerCallConfig, deriveTuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini");

    expect(cfg.tenantId).toBe("_tui");
    expect(cfg.toolAllowlist).toBeInstanceOf(Set);
    expect(cfg.toolAllowlist?.has("grep")).toBe(true);
    expect(cfg.additionalTools?.some((tool) => tool.name === "glob")).toBe(true);
    expect(cfg.perCallCapabilities?.has("read")).toBe(true);
    expect(cfg.toolAuthority?.has("write")).toBe(true);
    expect(deriveTuiAuthorityStatusFromPerCallConfig(cfg)).toEqual({
      effective: "destructive",
      completeness: "authoritative",
    });
  });

  it("includes authorityStatus in welcome and done frame payload helpers", async () => {
    const {
      buildTuiTurnPerCallConfig,
      deriveTuiAuthorityStatusFromPerCallConfig,
      buildTuiWelcomeFramePayload,
      buildTuiDoneFramePayload,
    } = await import("../../src/gateway/tui-gateway.js");

    const authorityStatus = deriveTuiAuthorityStatusFromPerCallConfig(
      buildTuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini"),
    );
    const welcome = buildTuiWelcomeFramePayload({
      models: {},
      planMode: false,
      authorityStatus,
    });
    const done = buildTuiDoneFramePayload({
      content: "done",
      parts: [],
      inputTokens: 1,
      outputTokens: 1,
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.4-mini",
      runtimeContinuity: { strategy: "none" },
      authorityStatus,
    });

    expect(welcome.authorityStatus).toEqual({
      effective: "destructive",
      completeness: "authoritative",
    });
    expect(done.authorityStatus).toEqual({
      effective: "destructive",
      completeness: "authoritative",
    });
  });

  it("executes tools for kiln-executable TUI providers", async () => {
    const { buildTuiTurnPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const toolFn = vi.fn().mockResolvedValue("should not run");

    let callCount = 0;
    const provider: ProviderAdapter = {
      name: "tui-fake-provider",
      createMessage: vi.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return {
            parts: textParts("attempting tool"),
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [{ id: "tc-1", name: "glob", input: { pattern: "kiln-context.md" } }],
            stopReason: "tool_use",
          };
        }
        return {
          parts: textParts("done"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        };
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };

    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [{ name: "glob", description: "Match files by glob pattern.", inputSchema: {}, tags: new Set() }],
      builtinTools: new Map([["glob", toolFn]]),
    });

    await orchestrator.processMessage(
      makeSession(),
      textParts("run dangerous tool"),
      undefined,
      undefined,
      buildTuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini"),
    );

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getReinjectedToolResultFromSecondCall(provider)).toContain("should not run");
  });
});
