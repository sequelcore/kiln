import { describe, expect, it, vi } from "vitest";
import { runSession, type RunSessionRouteCandidate } from "./run-session.js";
import type { SessionRegistry } from "../wrapper/session-registry.js";
import type { SessionContext } from "../wrapper/index.js";
import type { SessionHooks } from "./session-hooks.js";
import { defineDeliberationLevelId, type DeliberationResolution } from "@kilnai/core/agents";

const XHIGH_RESOLUTION: DeliberationResolution = {
  status: "exact",
  source: "operator",
  selectedLevel: defineDeliberationLevelId("xhigh"),
};

describe("runSession", () => {
  it("records a failed terminal outcome on the provider attempt", async () => {
    const run = vi.fn(async function* () {
      yield { type: "completed", totalUsd: 0, durationMs: 1, outcome: "failed", isPreflightCrash: false };
    });
    const result = await runSession({
      registry: {
        createSession: vi.fn(() => ({ run, dispose: vi.fn(async () => undefined) })),
        selectBest: vi.fn(),
        reportSuccess: vi.fn(),
        reportFailure: vi.fn(),
      } as unknown as SessionRegistry,
      cleanupRegistry: { register: vi.fn() } as never,
      manager: {} as never,
      context: {
        mode: "cli-wrapper",
        domain: { name: "test", displayName: "Test", toolTags: new Set(), qualityGates: [], detectPatterns: [], multishotExamples: "", phaseExamples: "" },
        systemPrompt: "system",
        projectedContext: { blocks: [], totalTokens: 0, omitted: [] },
        mcpServerEntryPath: "",
        workingDirectory: "/repo",
        task: "Run bounded work",
        resumeStrategy: "none",
      } as unknown as SessionContext,
      requirements: {},
      routeCandidates: [{ provider: "codex-oauth", model: "gpt-5.5" }],
      sessionConfig: { task: "Run bounded work", permissionPolicy: { approval: "never", sandbox: "read-only" } },
      permissionPolicy: { approval: "never", sandbox: "read-only" },
      env: {},
      sessionHooks: { userPromptSubmit: vi.fn() } as unknown as SessionHooks,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toBe("Provider codex-oauth ended with terminal outcome 'failed'");
    expect(result.attempts).toEqual([expect.objectContaining({
      providerId: "codex-oauth",
      succeeded: false,
      error: "Provider codex-oauth ended with terminal outcome 'failed'",
    })]);
  });

  it("passes per-route deliberation resolution to the selected session attempt", async () => {
    const run = vi.fn(async function* () {
      yield {
        type: "cost_update",
        usd: 0,
        provider: "codex-oauth",
        model: "gpt-5.5",
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
      };
      yield { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false };
    });
    const createSession = vi.fn(() => ({
      run,
      dispose: vi.fn(async () => undefined),
    }));
    const routeCandidates: readonly RunSessionRouteCandidate[] = [{
      provider: "codex-oauth",
      model: "gpt-5.5",
      deliberationResolution: XHIGH_RESOLUTION,
    }];

    const trackCostUpdate = vi.fn();
    const result = await runSession({
      registry: {
        createSession,
        selectBest: vi.fn(),
        reportSuccess: vi.fn(),
        reportFailure: vi.fn(),
      } as unknown as SessionRegistry,
      cleanupRegistry: {
        register: vi.fn(),
      } as never,
      manager: { trackCostUpdate } as never,
      context: {
        mode: "cli-wrapper",
        domain: {
          name: "test",
          displayName: "Test",
          toolTags: new Set(),
          qualityGates: [],
          detectPatterns: [],
          multishotExamples: "",
          phaseExamples: "",
        },
        systemPrompt: "system",
        projectedContext: {
          blocks: [],
          totalTokens: 0,
          omitted: [],
        },
        mcpServerEntryPath: "",
        workingDirectory: "/repo",
        task: "Review architecture",
        resumeStrategy: "none",
      } as unknown as SessionContext,
      requirements: {},
      routeCandidates,
      sessionConfig: {
        task: "Review architecture",
        permissionPolicy: {
          approval: "never",
          sandbox: "read-only",
        },
      },
      permissionPolicy: {
        approval: "never",
        sandbox: "read-only",
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: vi.fn(),
      } as unknown as SessionHooks,
    });

    expect(createSession).toHaveBeenCalledWith("codex-oauth", expect.objectContaining({
      model: "gpt-5.5",
      deliberationResolution: XHIGH_RESOLUTION,
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo",
      deliberationResolution: XHIGH_RESOLUTION,
    }));
    expect(result.providerTokenUsage).toEqual([expect.objectContaining({
      provider: "codex-oauth",
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    })]);
  });

  it("dispatches one exact post-fence credential-bound candidate without fallback", async () => {
    const run = vi.fn(async function* () {
      yield { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false };
    });
    const createSession = vi.fn(() => ({
      run,
      dispose: vi.fn(async () => undefined),
    }));
    const executionCredential = {
      credentialId: "credential-terra",
      accessToken: "synthetic-access-token",
      chatgptAccountId: "synthetic-account",
    };
    const credentialBinding = {
      routeId: "terra",
      accountId: "account-terra",
      credentialId: "credential-terra",
      credentialRevision: "post-fence-revision",
    };

    await runSession({
      registry: {
        createSession,
        selectBest: vi.fn(),
        reportSuccess: vi.fn(),
        reportFailure: vi.fn(),
      } as unknown as SessionRegistry,
      cleanupRegistry: { register: vi.fn() } as never,
      manager: {} as never,
      context: {
        mode: "cli-wrapper",
        domain: { name: "test", displayName: "Test", toolTags: new Set(), qualityGates: [], detectPatterns: [], multishotExamples: "", phaseExamples: "" },
        systemPrompt: "system",
        projectedContext: { blocks: [], totalTokens: 0, omitted: [] },
        mcpServerEntryPath: "",
        workingDirectory: "/repo",
        task: "Run one committed route",
        resumeStrategy: "none",
      } as unknown as SessionContext,
      requirements: {},
      routeCandidates: [{
        provider: "codex-oauth",
        model: "gpt-5.5",
        credentialBinding,
        executionCredential,
      }],
      sessionConfig: { task: "Run one committed route", permissionPolicy: { approval: "never", sandbox: "read-only" } },
      permissionPolicy: { approval: "never", sandbox: "read-only" },
      env: {},
      sessionHooks: { userPromptSubmit: vi.fn() } as unknown as SessionHooks,
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith("codex-oauth", expect.objectContaining({
      model: "gpt-5.5",
      credentialBinding,
      executionCredential,
    }));
  });

  it("records managed child provider routes in the session provider list", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn(async function* () {
      yield {
        type: "tool_use",
        toolCallId: "call-managed-invoke",
        toolCallScopeId: "turn-1:response:1",
        toolName: "managed_agent.invoke",
        input: {
          providerRoute: {
            providerId: "opencode-go",
            model: "qwen3.6-plus",
          },
        },
      };
      yield {
        type: "tool_result",
        toolCallId: "call-managed-invoke",
        toolCallScopeId: "turn-1:response:1",
        toolName: "managed_agent.invoke",
        output: "ok",
      };
      yield { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false };
    });
    const createSession = vi.fn(() => ({
      run,
      dispose: vi.fn(async () => undefined),
    }));

    try {
      const result = await runSession({
        registry: {
          createSession,
          selectBest: vi.fn(),
          reportSuccess: vi.fn(),
          reportFailure: vi.fn(),
        } as unknown as SessionRegistry,
        cleanupRegistry: {
          register: vi.fn(),
        } as never,
        manager: {} as never,
        context: {
          mode: "cli-wrapper",
          domain: {
            name: "test",
            displayName: "Test",
            toolTags: new Set(),
            qualityGates: [],
            detectPatterns: [],
            multishotExamples: "",
            phaseExamples: "",
          },
          systemPrompt: "system",
          projectedContext: {
            blocks: [],
            totalTokens: 0,
            omitted: [],
          },
          mcpServerEntryPath: "",
          workingDirectory: "/repo",
          task: "Collect visual reference evidence",
          resumeStrategy: "none",
        } as unknown as SessionContext,
        requirements: {},
        routeCandidates: [{ provider: "codex-oauth", model: "gpt-5.5" }],
        sessionConfig: {
          task: "Collect visual reference evidence",
          permissionPolicy: {
            approval: "never",
            sandbox: "read-only",
          },
        },
        permissionPolicy: {
          approval: "never",
          sandbox: "read-only",
        },
        env: {},
        sessionHooks: {
          userPromptSubmit: vi.fn(),
          preToolUse: vi.fn(),
          postToolUse: vi.fn(),
        } as unknown as SessionHooks,
      });

      expect(result.providersUsed).toEqual(["codex-oauth", "opencode-go"]);
      expect(result.transcript).toContainEqual(expect.objectContaining({
        event: expect.objectContaining({
          type: "tool_result",
          toolName: "managed_agent.invoke",
          output: "ok",
        }),
      }));
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("sets managedChildDispatched to true when managed_agent.invoke is called", async () => {
    const run = vi.fn(async function* () {
      yield {
        type: "tool_use",
        toolCallId: "call-managed-invoke",
        toolCallScopeId: "turn-1:response:1",
        toolName: "managed_agent.invoke",
        input: { providerRoute: { providerId: "opencode-go" } },
      };
      yield {
        type: "tool_result",
        toolCallId: "call-managed-invoke",
        toolCallScopeId: "turn-1:response:1",
        toolName: "managed_agent.invoke",
        output: "ok",
      };
      yield { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false };
    });
    const result = await runSession({
      registry: {
        createSession: vi.fn(() => ({ run, dispose: vi.fn(async () => undefined) })),
        selectBest: vi.fn(),
        reportSuccess: vi.fn(),
        reportFailure: vi.fn(),
      } as unknown as SessionRegistry,
      cleanupRegistry: { register: vi.fn() } as never,
      manager: {} as never,
      context: {
        mode: "cli-wrapper",
        domain: { name: "test", displayName: "Test", toolTags: new Set(), qualityGates: [], detectPatterns: [], multishotExamples: "", phaseExamples: "" },
        systemPrompt: "system",
        projectedContext: { blocks: [], totalTokens: 0, omitted: [] },
        mcpServerEntryPath: "",
        workingDirectory: "/repo",
        task: "test",
        resumeStrategy: "none",
      } as unknown as SessionContext,
      requirements: {},
      routeCandidates: [{ provider: "codex-oauth" }],
      sessionConfig: { task: "test", permissionPolicy: { approval: "never", sandbox: "read-only" } },
      permissionPolicy: { approval: "never", sandbox: "read-only" },
      env: {},
      sessionHooks: { userPromptSubmit: vi.fn(), preToolUse: vi.fn(), postToolUse: vi.fn() } as unknown as SessionHooks,
    });
    expect(result.managedChildDispatched).toBe(true);
  });

  it("sets managedChildDispatched to false when no managed invocation tool is used", async () => {
    const run = vi.fn(async function* () {
      yield {
        type: "tool_use",
        toolCallId: "call-read",
        toolCallScopeId: "turn-1:response:1",
        toolName: "read",
        input: { filePath: "foo.ts" },
      };
      yield {
        type: "tool_result",
        toolCallId: "call-read",
        toolCallScopeId: "turn-1:response:1",
        toolName: "read",
        output: "content",
      };
      yield { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false };
    });
    const result = await runSession({
      registry: {
        createSession: vi.fn(() => ({ run, dispose: vi.fn(async () => undefined) })),
        selectBest: vi.fn(),
        reportSuccess: vi.fn(),
        reportFailure: vi.fn(),
      } as unknown as SessionRegistry,
      cleanupRegistry: { register: vi.fn() } as never,
      manager: {} as never,
      context: {
        mode: "cli-wrapper",
        domain: { name: "test", displayName: "Test", toolTags: new Set(), qualityGates: [], detectPatterns: [], multishotExamples: "", phaseExamples: "" },
        systemPrompt: "system",
        projectedContext: { blocks: [], totalTokens: 0, omitted: [] },
        mcpServerEntryPath: "",
        workingDirectory: "/repo",
        task: "test",
        resumeStrategy: "none",
      } as unknown as SessionContext,
      requirements: {},
      routeCandidates: [{ provider: "codex-oauth" }],
      sessionConfig: { task: "test", permissionPolicy: { approval: "never", sandbox: "read-only" } },
      permissionPolicy: { approval: "never", sandbox: "read-only" },
      env: {},
      sessionHooks: { userPromptSubmit: vi.fn(), preToolUse: vi.fn(), postToolUse: vi.fn() } as unknown as SessionHooks,
    });
    expect(result.managedChildDispatched).toBe(false);
  });
});
