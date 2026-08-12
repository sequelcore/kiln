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
    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "auto",
      admittedAuthority: "fail_closed",
      completeness: "authoritative",
      toolCount: 0,
    });
    expect(deriveGuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "fail_closed",
      admittedAuthority: "fail_closed",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
      toolCount: 0,
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
    expect(cfg.toolAuthority?.has("write")).toBe(false);
    expect(cfg.modelOverride).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.4-mini",
    });
    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      admittedAuthority: "audited",
      completeness: "authoritative",
      toolCount: cfg.toolAllowlist?.size,
    });
    expect(deriveGuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
  });

  it("restricts plan execution mode to read-only tools plus planning workflow tools", async () => {
    const { buildGuiTurnPerCallConfig, deriveGuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini", undefined, undefined, undefined, "plan");

    expect(cfg.toolAllowlist).toBeInstanceOf(Set);
    expect(cfg.toolAllowlist?.has("read")).toBe(true);
    expect(cfg.toolAllowlist?.has("tree")).toBe(true);
    expect(cfg.toolAllowlist?.has("submit_plan")).toBe(true);
    expect(cfg.toolAllowlist?.has("submit_specification")).toBe(true);
    expect(cfg.toolAllowlist?.has("record_clarification")).toBe(true);
    expect(cfg.toolAllowlist?.has("write")).toBe(false);
    expect(cfg.toolAllowlist?.has("edit")).toBe(false);
    expect(cfg.toolAllowlist?.has("patch")).toBe(false);
    expect(cfg.toolAuthority?.get("submit_plan")).toMatchObject({
      level: 1,
      allowed: true,
      requiresApproval: false,
    });
    expect(cfg.additionalTools?.some((tool) => tool.name === "submit_plan")).toBe(true);
    expect(cfg.additionalTools?.some((tool) => tool.name === "write")).toBe(false);
    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "plan",
      requestedAuthority: "planning",
      admittedAuthority: "read_only",
      completeness: "authoritative",
      toolCount: cfg.toolAllowlist?.size,
    });
    expect(deriveGuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "read_only",
      admittedAuthority: "read_only",
      requestedAuthority: "planning",
      executionMode: "plan",
      completeness: "authoritative",
    });
  });

  it("records explicit requested authority on execute-mode GUI turns", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      "audited",
    );

    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "audited",
      admittedAuthority: "audited",
    });
    expect(cfg.toolAllowlist?.has("read")).toBe(true);
    expect(cfg.toolAllowlist?.has("write")).toBe(false);
    expect(cfg.toolAllowlist?.has("shell_command")).toBe(false);
  });

  it("carries canonical temporal context into GUI turns", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      undefined,
      undefined,
      undefined,
      {
        observedAt: "2026-07-19T04:45:46.720Z",
        timeZone: "America/Tijuana",
        localDate: "2026-07-18",
      },
    );

    expect(cfg.temporalContext).toEqual({
      observedAt: "2026-07-19T04:45:46.720Z",
      timeZone: "America/Tijuana",
      localDate: "2026-07-18",
    });
  });

  it("carries the selected GUI workspace into the admitted turn config", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      "destructive",
      "C:\\workspace\\kiln",
    );

    expect(cfg.workingDirectory).toBe("C:\\workspace\\kiln");
  });

  it("validates and carries an operator governed-work requirement into the turn config", async () => {
    const {
      assertGuiTurnModeCompatibility,
      buildGuiTurnPerCallConfig,
      resolveGuiGovernedWorkRequirement,
    } = await import("../../src/gateway/gui-gateway.js");
    const requirement = resolveGuiGovernedWorkRequirement({
      kind: "goal_materialization",
      requiredWorkItemCount: 3,
    });
    const cfg = buildGuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      "destructive",
      "C:\\workspace\\kiln",
      requirement,
    );

    expect(cfg.governedWorkRequirement).toEqual({
      kind: "goal_materialization",
      requiredWorkItemCount: 3,
    });
    expect(() => resolveGuiGovernedWorkRequirement({
      kind: "goal_materialization",
      requiredWorkItemCount: 0,
    })).toThrow("must be a positive integer");
    expect(() => resolveGuiGovernedWorkRequirement({
      kind: "unknown",
      requiredWorkItemCount: 3,
    })).toThrow("Unknown governed work requirement 'unknown'.");
    expect(() => assertGuiTurnModeCompatibility("plan", requirement)).toThrow(
      "Plan mode cannot be combined with governed goal materialization.",
    );
    expect(() => assertGuiTurnModeCompatibility("execute", requirement)).not.toThrow();
  });

  it("rejects malformed requested authority instead of falling back to auto", async () => {
    const { resolveGuiRequestedAuthority } = await import("../../src/gateway/gui-gateway.js");

    expect(resolveGuiRequestedAuthority(undefined)).toBeUndefined();
    expect(resolveGuiRequestedAuthority("destructive")).toBe("destructive");
    expect(() => resolveGuiRequestedAuthority("invalid")).toThrow("Unknown requested authority 'invalid'.");
    expect(() => resolveGuiRequestedAuthority(null)).toThrow("Unknown requested authority 'null'.");
  });

  it("keeps plan-mode authority semantics when audited authority is requested", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig(
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

  it("adds the operator theme tool when a live operator theme controller is attached", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const { createAttachedRuntimeBuiltinToolSurface } = await import("../../src/gateway/attached-runtime-tool-surface.js");
    const setTheme = vi.fn().mockResolvedValue({ ok: true, appliedTheme: "vesper" });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      operatorSurface: { theme: { setTheme } },
    });
    const cfg = buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini", surface);

    expect(cfg.toolAllowlist?.has("operator_set_theme")).toBe(true);
    const themeTool = cfg.additionalTools?.find((tool) => tool.name === "operator_set_theme");
    expect(themeTool).toBeDefined();
    expect(themeTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        theme: { type: "string" },
        scope: { type: "string" },
      },
      required: ["theme"],
      additionalProperties: false,
    });

    const result = await surface.callBuiltinTools.get("operator_set_theme")?.({
      theme: "vesper",
      scope: "session",
      reason: "test",
    });

    expect(setTheme).toHaveBeenCalledWith({ theme: "vesper", scope: "session", reason: "test" });
    expect(result).toMatchObject({
      isError: false,
      metadata: { appliedTheme: "vesper" },
    });
  });

  it("exposes the builtin tool surface for live-discovered Codex OAuth models", async () => {
    const { buildGuiTurnPerCallConfig, deriveGuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.5", undefined, {
      supportsFunctionTools: true,
    });

    expect(cfg.modelOverride).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
    });
    expect(cfg.toolAllowlist?.has("write")).toBe(false);
    expect(cfg.additionalTools?.some((tool) => tool.name === "write")).toBe(false);
    expect(cfg.toolAuthority?.has("write")).toBe(false);
    expect(deriveGuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
  });

  it("fails closed when live Codex OAuth discovery says the model has function tools disabled", async () => {
    const { buildGuiTurnPerCallConfig, deriveGuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig("codex-oauth", "gpt-disabled", undefined, {
      supportsFunctionTools: false,
    });

    expect(cfg.modelOverride).toEqual({
      provider: "codex-oauth",
      model: "gpt-disabled",
    });
    expect(cfg.toolAllowlist?.size).toBe(0);
    expect(cfg.additionalTools).toEqual([]);
    expect(cfg.toolAuthority?.size).toBe(0);
    expect(deriveGuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "fail_closed",
      admittedAuthority: "fail_closed",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
  });

  it("keeps native Codex tool metadata separate from runtime tool execution", async () => {
    const { buildGuiTurnPerCallConfig, deriveGuiAuthorityStatusFromPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.5", undefined, {
      supportsNativeShellTools: false,
      supportsNativePatchTools: false,
    });

    expect(cfg.toolAllowlist?.has("write")).toBe(false);
    expect(cfg.additionalTools?.some((tool) => tool.name === "write")).toBe(false);
    expect(deriveGuiAuthorityStatusFromPerCallConfig(cfg)).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
  });

  it("fails closed for executable direct providers without an explicit active model", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig("openai", undefined);

    expect(cfg.modelOverride).toBeUndefined();
    expect(cfg.toolAllowlist?.size).toBe(0);
    expect(cfg.toolAuthority?.size).toBe(0);
  });

  it("uses the explicit active model for executable direct providers", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig("openai", "gpt-4o");

    expect(cfg.modelOverride).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
    expect(cfg.toolAllowlist?.has("read")).toBe(true);
  });

  it("prefers turn authority config for done-frame status over a default config", async () => {
    const {
      buildGuiTurnPerCallConfig,
      deriveGuiDoneAuthorityStatus,
    } = await import("../../src/gateway/gui-gateway.js");

    const doneTurnConfig = buildGuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      "audited",
    );
    const defaultConfig = buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini");

    expect(deriveGuiDoneAuthorityStatus(doneTurnConfig, defaultConfig)).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "audited",
      executionMode: "execute",
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
      executionMode: "execute",
      authorityStatus,
    };
    const doneFrame = {
      type: "done",
      content: "done",
      outcome: "completed",
      inputTokens: 1,
      outputTokens: 1,
      authorityStatus,
    };

    expect(welcomeFrame.authorityStatus).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
      completeness: "authoritative",
    });
    expect(doneFrame.authorityStatus).toMatchObject({
      effective: "audited",
      admittedAuthority: "audited",
      requestedAuthority: "auto",
      executionMode: "execute",
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
      buildGuiTurnPerCallConfig("codex-oauth", "gpt-5.4-mini"),
    );

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getReinjectedToolResultFromSecondCall(provider)).toContain("should not run");
  });

  it("keeps the provider-neutral deliberation intent in GUI per-call config", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");

    const cfg = buildGuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4",
      undefined,
      {
        supportsTools: true,
        deliberation: {
          provider: "codex-oauth",
          model: "gpt-5.4",
          levels: [{ id: "low" }, { id: "medium" }, { id: "high" }],
          defaultLevel: "medium",
          supportsAdaptive: false,
          evidence: { sourceIdentity: "codex/models", sourceRevision: "test-r1", observedAt: "2026-05-12T00:00:00.000Z" },
        },
      },
      { mode: "fixed", preferredLevel: "high", onUnsupported: "deny" },
    );

    expect(cfg.deliberationIntent).toEqual({ mode: "fixed", preferredLevel: "high", onUnsupported: "deny" });
  });

  it("treats GUI Full Access as attended Kiln runtime authority", async () => {
    const { buildGuiTurnPerCallConfig } = await import("../../src/gateway/gui-gateway.js");
    const cfg = buildGuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      undefined,
      undefined,
      undefined,
      "execute",
      "destructive",
    );

    expect(cfg.authorityContext).toMatchObject({ executionUse: "operator_interactive" });
    expect(cfg.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "destructive",
      admittedAuthority: "destructive",
      completeness: "authoritative",
      sandboxProjection: "workspace_write",
    });
    expect(cfg.toolAuthority?.get("write")).toMatchObject({
      level: 4,
      allowed: true,
      requiresApproval: false,
    });
  });
});
