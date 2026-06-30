import { describe, expect, it, vi } from "vitest";
import { runSession, type RunSessionRouteCandidate } from "./run-session.js";
import type { SessionRegistry } from "../wrapper/session-registry.js";
import type { SessionContext } from "../wrapper/index.js";
import type { SessionHooks } from "./session-hooks.js";

describe("runSession", () => {
  it("passes per-route reasoning effort to the selected session attempt", async () => {
    const run = vi.fn(async function* () {
      yield { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false };
    });
    const createSession = vi.fn(() => ({
      run,
      dispose: vi.fn(async () => undefined),
    }));
    const routeCandidates: readonly RunSessionRouteCandidate[] = [{
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
    }];

    await runSession({
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
      reasoningEffort: "xhigh",
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo",
      reasoningEffort: "xhigh",
    }));
  });

  it("records managed child provider routes in the session provider list", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn(async function* () {
      yield {
        type: "tool_use",
        toolName: "managed_agent.invoke",
        input: {
          providerRoute: {
            providerId: "opencode-go",
            model: "qwen3.6-plus",
          },
        },
      };
      yield { type: "tool_result", toolName: "managed_agent.invoke", output: "ok" };
      yield { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false };
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
});
