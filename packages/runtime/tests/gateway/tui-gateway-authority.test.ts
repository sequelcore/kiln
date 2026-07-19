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
    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "auto",
      admittedAuthority: "fail_closed",
      completeness: "authoritative",
      toolCount: 0,
    });
  });

  it("derives TUI authority status from fail-closed config", async () => {
    const { buildTuiPerCallToolConfig, deriveTuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiPerCallToolConfig();

    expect(deriveTuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "fail_closed",
      admittedAuthority: "fail_closed",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
      toolCount: 0,
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
    expect(cfg.toolAuthority?.has("write")).toBe(false);
    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      admittedAuthority: "audited",
      completeness: "authoritative",
      toolCount: cfg.toolAllowlist?.size,
    });
    expect(deriveTuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
  });

  it("carries canonical temporal context into TUI turns", async () => {
    const { buildTuiTurnPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      undefined,
      {
        observedAt: "2026-07-19T04:45:46.720Z",
        timeZone: "America/Tijuana",
        localDate: "2026-07-18",
      },
    );

    expect(cfg.temporalContext?.localDate).toBe("2026-07-18");
  });

  it("records explicit requested authority on execute-mode TUI turns", async () => {
    const { buildTuiTurnPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      "read_only",
    );

    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "read_only",
      admittedAuthority: "read_only",
    });
    expect(cfg.toolAllowlist?.has("read")).toBe(true);
    expect(cfg.toolAllowlist?.has("write")).toBe(false);
    expect(cfg.toolAllowlist?.has("shell_command")).toBe(false);
  });

  it("rejects malformed requested authority instead of falling back to auto", async () => {
    const { resolveTuiRequestedAuthority } = await import("../../src/gateway/tui-gateway.js");

    expect(resolveTuiRequestedAuthority(undefined)).toBeUndefined();
    expect(resolveTuiRequestedAuthority("destructive")).toBe("destructive");
    expect(() => resolveTuiRequestedAuthority("invalid")).toThrow("Unknown requested authority 'invalid'.");
    expect(() => resolveTuiRequestedAuthority(null)).toThrow("Unknown requested authority 'null'.");
  });

  it("fails closed for destructive TUI authority without goal and work-item envelopes", async () => {
    const { buildTuiTurnPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      "destructive",
    );

    expect(cfg.toolAllowlist?.size).toBe(0);
    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "destructive",
      admittedAuthority: "fail_closed",
      completeness: "authoritative",
    });
    expect(cfg.effectiveTurnAuthority?.policyInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "goal_envelope", status: "unresolved" }),
      expect.objectContaining({ source: "work_item_authority", status: "unresolved" }),
    ]));
  });

  it("keeps plan-mode authority semantics when audited authority is requested", async () => {
    const { buildTuiTurnPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "plan",
      "audited",
    );

    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "plan",
      requestedAuthority: "planning",
      admittedAuthority: "read_only",
      completeness: "authoritative",
    });
  });

  it("exposes the builtin tool surface for live-discovered Codex OAuth models", async () => {
    const { buildTuiTurnPerCallConfig, deriveTuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiTurnPerCallConfig("codex-oauth", "gpt-5.5", undefined, {
      supportsFunctionTools: true,
    });

    expect(cfg.modelOverride).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
    });
    expect(cfg.toolAllowlist?.has("write")).toBe(false);
    expect(cfg.additionalTools?.some((tool) => tool.name === "write")).toBe(false);
    expect(cfg.toolAuthority?.has("write")).toBe(false);
    expect(deriveTuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
  });
  it("rejects provider switches to cooling direct provider model routes", async () => {
    const { resolveTuiProviderSwitch } = await import("../../src/gateway/tui-gateway.js");

    const resolution = resolveTuiProviderSwitch({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      discovery: [{
        provider: "openrouter",
        available: true,
        models: ["openrouter/free", "qwen/qwen3-coder:free"],
        modelRouteHealth: {
          "qwen/qwen3-coder:free": {
            healthy: false,
            reason: "qwen route is temporarily rate-limited.",
          },
        },
        status: "available",
        reason: "OpenRouter models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-04-28T12:00:00.000Z",
      }],
    });

    expect(resolution).toEqual({
      ok: false,
      error: "qwen route is temporarily rate-limited.",
    });
  });

  it("rejects legacy-listed routes that canonical discovery marks ineligible", async () => {
    const { resolveTuiProviderSwitch } = await import("../../src/gateway/tui-gateway.js");
    const { projectGuiProviderModelDiscovery } = await import("../../src/gateway/gui-provider-models.js");
    const discovery = [{
      provider: "opencode",
      available: true,
      models: ["openai/gpt-5.4-mini"],
      status: "available" as const,
      reason: "OpenCode CLI models discovered.",
      authState: "authenticated" as const,
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }];
    const providerModelDiscovery = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    const resolution = resolveTuiProviderSwitch({
      provider: "opencode",
      model: "openai/gpt-5.4-mini",
      models: { opencode: ["openai/gpt-5.4-mini"] },
      discovery,
      providerModelDiscovery,
    });

    expect(resolution).toMatchObject({
      ok: false,
      error: expect.stringContaining("not eligible"),
    });
  });

  it("does not let legacy route health override canonical eligibility", async () => {
    const { resolveTuiProviderSwitch } = await import("../../src/gateway/tui-gateway.js");
    const { projectGuiProviderModelDiscovery } = await import("../../src/gateway/gui-provider-models.js");
    const discovery = [{
      provider: "openrouter",
      available: true,
      models: ["openrouter/free"],
      modelRouteHealth: {
        "openrouter/free": {
          healthy: false,
          reason: "legacy diagnostic says cooling down",
        },
      },
      status: "available" as const,
      reason: "OpenRouter models discovered.",
      authState: "authenticated" as const,
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }];
    const projected = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-07-01T12:00:00.000Z",
    });
    const providerModelDiscovery = {
      ...projected,
      entries: projected.entries.map((entry) => ({
        ...entry,
        routeHealth: { status: "healthy" as const },
        eligibility: { eligible: true, reasonCodes: [] },
      })),
    };

    expect(resolveTuiProviderSwitch({
      provider: "openrouter",
      model: "openrouter/free",
      discovery,
      providerModelDiscovery,
    })).toEqual({
      ok: true,
      provider: "openrouter",
      model: "openrouter/free",
    });
  });

  it("fails closed when live Codex OAuth discovery says the model has function tools disabled", async () => {
    const { buildTuiTurnPerCallConfig, deriveTuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/tui-gateway.js");
    const cfg = buildTuiTurnPerCallConfig("codex-oauth", "gpt-disabled", undefined, {
      supportsFunctionTools: false,
    });

    expect(cfg.modelOverride).toEqual({
      provider: "codex-oauth",
      model: "gpt-disabled",
    });
    expect(cfg.toolAllowlist?.size).toBe(0);
    expect(cfg.additionalTools).toEqual([]);
    expect(cfg.toolAuthority?.size).toBe(0);
    expect(deriveTuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "fail_closed",
      admittedAuthority: "fail_closed",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
  });

  it("prefers turn authority config for done-frame status over a destructive default config", async () => {
    const {
      buildTuiTurnPerCallConfig,
      deriveTuiDoneAuthorityStatus,
    } = await import("../../src/gateway/tui-gateway.js");

    const doneTurnConfig = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      "read_only",
    );
    const destructiveDefaultConfig = buildTuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini");

    expect(deriveTuiDoneAuthorityStatus(doneTurnConfig, destructiveDefaultConfig)).toMatchObject({
      effective: "read_only",
      admittedAuthority: "read_only",
      requestedAuthority: "read_only",
      executionMode: "execute",
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
      executionMode: "execute",
      authorityStatus,
    });
    const done = buildTuiDoneFramePayload({
      content: "done",
      parts: [],
      inputTokens: 1,
      outputTokens: 1,
      outcome: "paused",
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.4-mini",
      runtimeContinuity: { strategy: "none" },
      authorityStatus,
    });

    expect(welcome.authorityStatus).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
    expect(done.authorityStatus).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
    expect(done.outcome).toBe("paused");
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
            toolCalls: [{ id: "tc-1", name: "glob", input: { pattern: "docs/changelog.md" } }],
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
