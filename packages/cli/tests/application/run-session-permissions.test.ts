import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainConfig } from "@kilnai/core/domain";
import { runSession } from "../../src/application/run-session.js";
import type { SessionContext } from "../../src/wrapper/index.js";
import { nativeHarnessCancellationDisposition } from "../../src/wrapper/native-harness-terminal-disposition.js";
import { SessionRegistry } from "../../src/wrapper/session-registry.js";
import { nativeHarnessDisposition, runtimeFailureDisposition } from "../fixtures/terminal-disposition.js";

const DOMAIN: DomainConfig = {
  name: "generic",
  displayName: "Generic",
  detectPatterns: [],
  toolTags: new Set(),
  qualityGates: [],
  multishotExamples: "",
  phaseExamples: "",
};
const KILN_SESSION_ID = "kiln-session-1";
const TOOL_CALL_IDENTITY = {
  toolCallId: "call-1",
  toolCallScopeId: "turn-1:response:1",
} as const;

function makeContext(): SessionContext {
  return {
    mode: "api-key",
    domain: DOMAIN,
    systemPrompt: "",
    projectedContext: { blocks: [], estimatedTokens: 0 },
    mcpServerEntryPath: "",
    workingDirectory: process.cwd(),
    task: "Test permission gating",
    resumeStrategy: "none",
  };
}

function createSessionFromEvents(
  events: readonly unknown[],
  providerSessionId = "session-1",
): {
  sessionId: string;
  capabilities: Record<string, unknown>;
  run: () => AsyncGenerator<unknown, void, unknown>;
  dispose: () => Promise<void>;
} {
  return {
    sessionId: providerSessionId,
    capabilities: {},
    run: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    dispose: async () => {},
  };
}

describe("runSession tool permission gating", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "kiln-run-session-perms-"));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("explicit direct provider does not fall back to harness providers on failure", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const createdProviders: string[] = [];

    const directProviderSession = createSessionFromEvents([
      { type: "error", code: "PROVIDER_SESSION_ERROR", message: "Missing required API key", isRetryable: false },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: runtimeFailureDisposition(),
        isPreflightCrash: false,
      },
    ]);
    const fallbackHarnessSession = createSessionFromEvents([
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "openrouter", orderedFallbacks: ["claude"], scores: [] }),
        createSession: (providerId: string) => {
          createdProviders.push(providerId);
          return providerId === "openrouter"
            ? directProviderSession as any
            : fallbackHarnessSession as any;
        },
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: { preferredProvider: "openrouter" },
      sessionConfig: {
        task: "test",
        permissionPolicy: { approval: "never", sandbox: "workspace-write" },
      },
      permissionPolicy: { approval: "never", sandbox: "workspace-write" },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse: () => {},
        postToolUse: () => {},
      } as any,
    });

    expect(createdProviders).toEqual(["openrouter"]);
    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toBe("Missing required API key");
    expect(result.successfulProviderId).toBeUndefined();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith("openrouter", false);
  });

  it("non-explicit selection preserves fallback behavior", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const createdProviders: string[] = [];

    const primarySession = createSessionFromEvents([
      { type: "error", code: "PRIMARY_FAILED", message: "Primary failed", isRetryable: false },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "failed"),
        isPreflightCrash: false,
      },
    ]);
    const fallbackSession = createSessionFromEvents([
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("opencode", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: ["opencode"], scores: [] }),
        createSession: (providerId: string) => {
          createdProviders.push(providerId);
          return providerId === "claude" ? primarySession as any : fallbackSession as any;
        },
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: { approval: "never", sandbox: "workspace-write" },
      },
      permissionPolicy: { approval: "never", sandbox: "workspace-write" },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse: () => {},
        postToolUse: () => {},
      } as any,
    });

    expect(createdProviders).toEqual(["claude", "opencode"]);
    expect(result.sessionSucceeded).toBe(true);
    expect(result.successfulProviderId).toBe("opencode");
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(reportSuccess).toHaveBeenCalledWith("opencode");
  });

  it("denied tool_use causes provider attempt failure", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "ls" } },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "deny" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "deny" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied tool "Bash"');
    expect(reportFailure).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash [DENIED]" },
      }),
    );
  });

  it("denied file-governance path on input.filePath blocks provider attempt", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Read", input: { filePath: "project/.env" } },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Read", action: "allow" }],
          fileGovernance: { denyGlobs: ["**/.env"] },
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Read", action: "allow" }],
        fileGovernance: { denyGlobs: ["**/.env"] },
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied file path "project/.env"');
    expect(reportFailure).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Read [DENIED]" },
      }),
    );
  });

  it("denied file-governance path on input.path blocks provider attempt", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Write", input: { path: "project/.env", content: "x" } },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Write", action: "allow" }],
          fileGovernance: { denyGlobs: ["**/.env"] },
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Write", action: "allow" }],
        fileGovernance: { denyGlobs: ["**/.env"] },
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied file path "project/.env"');
    expect(reportFailure).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Write [DENIED]" },
      }),
    );
  });

  it("allowed file-governance path on input.path preserves current behavior", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Read", input: { path: "project/docs/readme.md" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Read", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Read", action: "allow" }],
          fileGovernance: {
            denyGlobs: ["**/.env"],
            allowGlobs: ["**/*.md"],
          },
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Read", action: "allow" }],
        fileGovernance: {
          denyGlobs: ["**/.env"],
          allowGlobs: ["**/*.md"],
        },
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(preToolUse).toHaveBeenCalledWith("Read");
    expect(postToolUse).toHaveBeenCalledWith("Read");
    expect(reportSuccess).toHaveBeenCalledWith("claude");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("normalizes an empty tool root path to the governed workspace root", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();
    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Tree", input: { path: "" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Tree", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);
    const permissionPolicy = {
      approval: "on-request" as const,
      sandbox: "read-only" as const,
      tools: [{ tool: "Tree", action: "allow" as const }],
      fileGovernance: { allowGlobs: ["."] },
    };

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: { task: "test", permissionPolicy },
      permissionPolicy,
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(preToolUse).toHaveBeenCalledWith("Tree");
    expect(postToolUse).toHaveBeenCalledWith("Tree");
    expect(reportSuccess).toHaveBeenCalledWith("claude");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("denied tool_use remains a hard prohibition", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "ls" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Bash", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionId: KILN_SESSION_ID,
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "deny" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "deny" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied tool "Bash"');
    expect(preToolUse).not.toHaveBeenCalled();
    expect(postToolUse).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();

  });

  it("a command denial remains a hard prohibition after tool admission", async () => {
    const reportFailure = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "rm -rf /tmp/cache" } },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess: () => {},
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionId: KILN_SESSION_ID,
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "allow" }],
          commands: [{ pattern: "rm -rf /tmp/cache", action: "deny", shell: "bash" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "allow" }],
        commands: [{ pattern: "rm -rf /tmp/cache", action: "deny", shell: "bash" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied command "rm -rf /tmp/cache"');
    expect(preToolUse).not.toHaveBeenCalled();

  });

  it("provider continuation identity does not override a denied tool_use", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Read", input: { filePath: "README.md" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Read", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ], "provider-session-42");

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionId: KILN_SESSION_ID,
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Read", action: "deny" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Read", action: "deny" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied tool "Read"');
    expect(preToolUse).not.toHaveBeenCalled();
    expect(postToolUse).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a denied write remains a hard prohibition", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Write", input: { filePath: "README.md", content: "ok" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Write", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionId: KILN_SESSION_ID,
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Write", action: "deny" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Write", action: "deny" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied tool "Write"');
    expect(preToolUse).not.toHaveBeenCalled();
    expect(postToolUse).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("allowed tool_use keeps current behavior", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "ls" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Bash", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "allow" }],
          commands: [{ pattern: "ls", action: "allow", shell: "bash" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "allow" }],
        commands: [{ pattern: "ls", action: "allow", shell: "bash" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(preToolUse).toHaveBeenCalledWith("Bash");
    expect(postToolUse).toHaveBeenCalledWith("Bash");
    expect(reportSuccess).toHaveBeenCalledWith("claude");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("blocks an unmatched on-request tool when no approval channel is available", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Read", input: { filePath: "README.md" } },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: { approval: "on-request", sandbox: "read-only" },
      },
      permissionPolicy: { approval: "on-request", sandbox: "read-only" },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied tool "Read"');
    expect(preToolUse).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
  });

  it("agent-scoped deny overrides root allow when agent is supplied", async () => {
    const reportFailure = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Read", input: { filePath: "README.md" } },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess: () => {},
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Read", action: "allow" }],
          agentScopes: [{
            agent: "agent-alpha",
            inherit: true,
            tools: [{ tool: "Read", action: "deny" }],
          }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Read", action: "allow" }],
        agentScopes: [{
          agent: "agent-alpha",
          inherit: true,
          tools: [{ tool: "Read", action: "deny" }],
        }],
      },
      permissionAgent: "agent-alpha",
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied tool "Read"');
    expect(reportFailure).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
  });

  it("retains the native terminal disposition and leaves provider health neutral after repeated policy denials", async () => {
    const observedAbortStates: boolean[] = [];
    const capabilities = {
      mcp: true,
      streaming: true,
      resumable: false,
      resume: false,
      costTrackingMode: "native" as const,
      supportedTools: [],
      maxContextTokens: null,
      priority: 1,
      fallbackTo: null,
      permissionPolicy: { approval: "on-request" as const, sandbox: "read-only" as const },
    };
    let created = 0;
    const registry = new SessionRegistry([{
      id: "claude",
      deliberationTransport: "native-level" as const,
      costTier: "high" as const,
      capabilities,
      create: () => {
        created += 1;
        return {
          sessionId: `denial-session-${created}`,
          capabilities,
          run: async function* (runOptions: { readonly abortSignal?: AbortSignal }) {
            yield { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "ls" } };
            observedAbortStates.push(runOptions.abortSignal?.aborted === true);
            yield {
              type: "completed",
              totalUsd: 0,
              durationMs: 1,
              disposition: nativeHarnessCancellationDisposition("runtime_cancelled"),
              isPreflightCrash: false,
            };
          },
          dispose: async () => {},
        } as any;
      },
    }]);

    const run = () => runSession({
      governedGoalTools: "forbidden",
      registry,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: { preferredProvider: "claude" },
      routeCandidates: [{ provider: "claude" }],
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "deny" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "deny" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse: () => {},
        postToolUse: () => {},
      } as any,
    });

    const results = await Promise.all([run(), run(), run()]);

    expect(observedAbortStates).toEqual([true, true, true]);
    expect(results.map((result) => result.sessionSucceeded)).toEqual([false, false, false]);
    expect(results.map((result) => result.terminalDisposition)).toEqual([
      nativeHarnessCancellationDisposition("runtime_cancelled"),
      nativeHarnessCancellationDisposition("runtime_cancelled"),
      nativeHarnessCancellationDisposition("runtime_cancelled"),
    ]);
    expect(registry.getHealth("claude")).toBe("healthy");
    expect(registry.selectBest({ preferredProvider: "claude" }).primary).toBe("claude");
  });

  it("denied bash command blocks provider attempt even when tool is allowed", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "rm -rf /tmp/cache" } },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "allow" }],
          commands: [{ pattern: "rm -rf /tmp/cache", action: "deny", shell: "bash" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "allow" }],
        commands: [{ pattern: "rm -rf /tmp/cache", action: "deny", shell: "bash" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied command "rm -rf /tmp/cache"');
    expect(reportFailure).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash [DENIED]" },
      }),
    );
  });

  it("a denied bash command cannot execute", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "git push origin main" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Bash", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionId: KILN_SESSION_ID,
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "allow" }],
          commands: [{ pattern: "git push origin main", action: "deny", shell: "bash" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "allow" }],
        commands: [{ pattern: "git push origin main", action: "deny", shell: "bash" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied command "git push origin main"');
    expect(preToolUse).not.toHaveBeenCalled();
    expect(postToolUse).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();

  });

  it("provider continuation identity does not override a denied bash command", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "git push origin main" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Bash", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ], "provider-session-42");

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionId: KILN_SESSION_ID,
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "allow" }],
          commands: [{ pattern: "git push origin main", action: "deny", shell: "bash" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "allow" }],
        commands: [{ pattern: "git push origin main", action: "deny", shell: "bash" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied command "git push origin main"');
    expect(preToolUse).not.toHaveBeenCalled();
    expect(postToolUse).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("allowed bash command preserves current behavior", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "bash", input: { command: "git status" } },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "bash", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "bash", action: "allow" }],
          commands: [{ pattern: "git status", action: "allow", shell: "bash" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "bash", action: "allow" }],
        commands: [{ pattern: "git status", action: "allow", shell: "bash" }],
      },
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(preToolUse).toHaveBeenCalledWith("bash");
    expect(postToolUse).toHaveBeenCalledWith("bash");
    expect(reportSuccess).toHaveBeenCalledWith("claude");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("agent-scoped command deny overrides root allow when permissionAgent is supplied", async () => {
    const reportFailure = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "Bash", input: { command: "git push origin main" } },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess: () => {},
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Bash", action: "allow" }],
          commands: [{ pattern: "git push origin main", action: "allow", shell: "bash" }],
          agentScopes: [{
            agent: "agent-alpha",
            inherit: true,
            commands: [{ pattern: "git push origin main", action: "deny", shell: "bash" }],
          }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "allow" }],
        commands: [{ pattern: "git push origin main", action: "allow", shell: "bash" }],
        agentScopes: [{
          agent: "agent-alpha",
          inherit: true,
          commands: [{ pattern: "git push origin main", action: "deny", shell: "bash" }],
        }],
      },
      permissionAgent: "agent-alpha",
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied command "git push origin main"');
    expect(reportFailure).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
  });

  it("denies MCP tool when canonical selector is not in scoped mcpTools allowlist", async () => {
    const reportFailure = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      {
        ...TOOL_CALL_IDENTITY,
        type: "tool_use",
        toolName: "memory_store",
        input: {},
        source: "mcp",
        mcpSelector: "secrets/fetch",
      },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess: () => {},
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "memory_store", action: "allow" }],
          agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["  MEMORY_STORE  "] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "memory_store", action: "allow" }],
        agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["  MEMORY_STORE  "] }],
      },
      permissionAgent: "agent-alpha",
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse: () => {},
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(result.lastError).toContain('denied MCP tool "memory_store"');
    expect(reportFailure).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "memory_store [DENIED]" },
      }),
    );
  });

  it("allows MCP tool when canonical selector matches normalized scoped mcpTools entries", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      {
        ...TOOL_CALL_IDENTITY,
        type: "tool_use",
        toolName: "memory_store",
        input: { key: "a", value: "b" },
        source: "mcp",
        mcpSelector: "  MeMoRy_Store ",
      },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "memory_store", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "memory_store", action: "allow" }],
          agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["  MEMORY_STORE  "] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "memory_store", action: "allow" }],
        agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["  MEMORY_STORE  "] }],
      },
      permissionAgent: "agent-alpha",
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(preToolUse).toHaveBeenCalledWith("memory_store");
    expect(postToolUse).toHaveBeenCalledWith("memory_store");
    expect(reportSuccess).toHaveBeenCalledWith("claude");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("falls back to normalized toolName when MCP event selector is absent", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      {
        ...TOOL_CALL_IDENTITY,
        type: "tool_use",
        toolName: "Memory_Store",
        input: { key: "a", value: "b" },
        source: "mcp",
      },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "Memory_Store", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "Memory_Store", action: "allow" }],
          agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: [" memory_store "] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Memory_Store", action: "allow" }],
        agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: [" memory_store "] }],
      },
      permissionAgent: "agent-alpha",
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(preToolUse).toHaveBeenCalledWith("Memory_Store");
    expect(postToolUse).toHaveBeenCalledWith("Memory_Store");
    expect(reportSuccess).toHaveBeenCalledWith("claude");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("agent-scoped allow cannot bypass the parent approval requirement", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { ...TOOL_CALL_IDENTITY, type: "tool_use", toolName: "memory_store", input: { key: "a", value: "b" }, source: "mcp" },
      { ...TOOL_CALL_IDENTITY, type: "tool_result", toolName: "memory_store", output: "ok" },
      {
        type: "completed",
        totalUsd: 0,
        durationMs: 1,
        disposition: nativeHarnessDisposition("claude-code", "completed"),
        isPreflightCrash: false,
      },
    ]);

    const result = await runSession({
      governedGoalTools: "forbidden",
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as any,
        reportFailure,
        reportSuccess,
      } as any,
      cleanupRegistry: { register: () => {} } as any,
      manager: { trackCostUpdate: () => {} } as any,
      context: makeContext(),
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: {
          approval: "on-request",
          sandbox: "read-only",
          agentScopes: [{ agent: "agent-alpha", inherit: true, tools: [{ tool: "memory_store", action: "allow" }] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        agentScopes: [{ agent: "agent-alpha", inherit: true, tools: [{ tool: "memory_store", action: "allow" }] }],
      },
      permissionAgent: "agent-alpha",
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(false);
    expect(preToolUse).not.toHaveBeenCalled();
    expect(postToolUse).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });
});
