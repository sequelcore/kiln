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
    appName: "kiln-gui",
    tenantId: "_gui",
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

describe("GUI authority forwarding", () => {
  it("builds explicit fail-closed per-call config when no executable provider is active", async () => {
    const { buildGuiPerCallToolConfig, deriveGuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiPerCallToolConfig();

    expect(cfg.tenantId).toBe("_gui");
    expect(cfg.toolAllowlist).toBeInstanceOf(Set);
    expect(cfg.toolAllowlist?.size).toBe(0);
    expect(cfg.toolAuthority).toBeInstanceOf(Map);
    expect(cfg.toolAuthority?.size).toBe(0);
    expect(deriveGuiAuthorityStatusFromPerCallConfig(cfg)).toEqual({
      effective: "fail_closed",
      completeness: "authoritative",
    });
  });

  it("exposes the builtin tool surface for kiln-executable direct providers", async () => {
    const { buildGuiTurnPerCallConfig, deriveGuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini");

    expect(cfg.tenantId).toBe("_gui");
    expect(cfg.toolAllowlist).toBeInstanceOf(Set);
    expect(cfg.toolAllowlist?.has("grep")).toBe(true);
    expect(cfg.additionalTools?.some((tool) => tool.name === "glob")).toBe(true);
    expect(cfg.perCallCapabilities?.has("read")).toBe(true);
    expect(cfg.toolAuthority?.has("write")).toBe(true);
    expect(deriveGuiAuthorityStatusFromPerCallConfig(cfg)).toEqual({
      effective: "destructive",
      completeness: "authoritative",
    });
  });

  it("includes authorityStatus in both welcome and done frame payload shapes", async () => {
    const { buildGuiTurnPerCallConfig, deriveGuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const authorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(
      buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini"),
    );

    const welcomeFrame = {
      type: "welcome",
      models: {},
      providers: [],
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      planMode: false,
      authorityStatus,
    };
    const doneFrame = {
      type: "done",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      authorityStatus,
    };

    expect(welcomeFrame.authorityStatus).toEqual({
      effective: "destructive",
      completeness: "authoritative",
    });
    expect(doneFrame.authorityStatus).toEqual({
      effective: "destructive",
      completeness: "authoritative",
    });
  });

  it("executes tools for kiln-executable GUI providers", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const toolFn = vi.fn().mockResolvedValue("should not run");

    let callCount = 0;
    const provider: ProviderAdapter = {
      name: "gui-fake-provider",
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
      buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini"),
    );

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getReinjectedToolResultFromSecondCall(provider)).toContain("should not run");
  });
});
