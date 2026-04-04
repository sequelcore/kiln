import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainConfig } from "@kilnai/core";
import { runSession } from "../../src/application/run-session.js";
import type { SessionContext } from "../../src/wrapper/index.js";
import { ApprovalMemoryStore } from "../../src/wrapper/approval-memory-store.js";

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

function makeContext(): SessionContext {
  return {
    mode: "api-key",
    domain: DOMAIN,
    systemPrompt: "",
    projectedContext: { blocks: [], estimatedTokens: 0 },
    memorySnapshot: undefined,
    mcpServerEntryPath: "",
    workingDirectory: process.cwd(),
    task: "Test permission gating",
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

  it("denied tool_use causes provider attempt failure", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Bash", input: { command: "ls" } },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { type: "tool_use", toolName: "Bash [DENIED]" },
      }),
    );
  });

  it("denied file-governance path on input.filePath blocks provider attempt", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Read", input: { filePath: "project/.env" } },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { type: "tool_use", toolName: "Read [DENIED]" },
      }),
    );
  });

  it("denied file-governance path on input.path blocks provider attempt", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Write", input: { path: "project/.env", content: "x" } },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { type: "tool_use", toolName: "Write [DENIED]" },
      }),
    );
  });

  it("allowed file-governance path on input.path preserves current behavior", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Read", input: { path: "project/docs/readme.md" } },
      { type: "tool_result", toolName: "Read", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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

  it("once grant allows denied tool_use, preserves allowed flow, and is consumed", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();
    const approvalMemoryStore = new ApprovalMemoryStore(projectPath);

    await approvalMemoryStore.grant({
      scope: "once",
      surface: "tool",
      selector: "Bash",
      action: "allow",
    });

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Bash", input: { command: "ls" } },
      { type: "tool_result", toolName: "Bash", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
      approvalMemoryStore,
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
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { type: "tool_use", toolName: "Bash" },
      }),
    );

    const remaining = await approvalMemoryStore.findMatch({
      surface: "tool",
      selector: "Bash",
      action: "allow",
      sessionId: KILN_SESSION_ID,
    });
    expect(remaining).toBeNull();
  });

  it("once grant is not consumed when later command gate denies tool execution", async () => {
    const reportFailure = vi.fn();
    const preToolUse = vi.fn();
    const approvalMemoryStore = new ApprovalMemoryStore(projectPath);

    await approvalMemoryStore.grant({
      scope: "once",
      surface: "tool",
      selector: "Bash",
      action: "allow",
    });

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Bash", input: { command: "rm -rf /tmp/cache" } },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
          tools: [{ tool: "Bash", action: "deny" }],
          commands: [{ pattern: "rm -rf /tmp/cache", action: "deny", shell: "bash" }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "deny" }],
        commands: [{ pattern: "rm -rf /tmp/cache", action: "deny", shell: "bash" }],
      },
      approvalMemoryStore,
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

    const remaining = await approvalMemoryStore.findMatch({
      surface: "tool",
      selector: "Bash",
      action: "allow",
      sessionId: KILN_SESSION_ID,
    });
    expect(remaining).not.toBeNull();
    expect(remaining?.scope).toBe("once");
  });

  it("session grant allows denied tool_use and preserves allowed flow", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();
    const approvalMemoryStore = new ApprovalMemoryStore(projectPath);

    await approvalMemoryStore.grant({
      scope: "session",
      sessionId: KILN_SESSION_ID,
      surface: "tool",
      selector: "Read",
      action: "allow",
    });

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Read", input: { filePath: "README.md" } },
      { type: "tool_result", toolName: "Read", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ], "provider-session-42");

    const result = await runSession({
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
      approvalMemoryStore,
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

  it("project grant allows denied tool_use and preserves allowed flow", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();
    const approvalMemoryStore = new ApprovalMemoryStore(projectPath);

    await approvalMemoryStore.grant({
      scope: "project",
      surface: "tool",
      selector: "Write",
      action: "allow",
    });

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Write", input: { filePath: "README.md", content: "ok" } },
      { type: "tool_result", toolName: "Write", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
      approvalMemoryStore,
      env: {},
      sessionHooks: {
        userPromptSubmit: () => {},
        preToolUse,
        postToolUse,
      } as any,
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(preToolUse).toHaveBeenCalledWith("Write");
    expect(postToolUse).toHaveBeenCalledWith("Write");
    expect(reportSuccess).toHaveBeenCalledWith("claude");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("allowed tool_use keeps current behavior", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Bash", input: { command: "ls" } },
      { type: "tool_result", toolName: "Bash", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "Bash", action: "allow" }],
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

  it("agent-scoped deny overrides root allow when agent is supplied", async () => {
    const reportFailure = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Read", input: { filePath: "README.md" } },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(preToolUse).not.toHaveBeenCalled();
  });

  it("denied bash command blocks provider attempt even when tool is allowed", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Bash", input: { command: "rm -rf /tmp/cache" } },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { type: "tool_use", toolName: "Bash [DENIED]" },
      }),
    );
  });

  it("once command grant allows denied bash command and is consumed", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();
    const approvalMemoryStore = new ApprovalMemoryStore(projectPath);

    await approvalMemoryStore.grant({
      scope: "once",
      surface: "command",
      selector: "git push origin main",
      action: "allow",
    });

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Bash", input: { command: "git push origin main" } },
      { type: "tool_result", toolName: "Bash", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
      approvalMemoryStore,
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

    const remaining = await approvalMemoryStore.findMatch({
      surface: "command",
      selector: "git push origin main",
      action: "allow",
      sessionId: KILN_SESSION_ID,
    });
    expect(remaining).toBeNull();
  });

  it("session command grant uses stable Kiln session id instead of provider session id", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();
    const approvalMemoryStore = new ApprovalMemoryStore(projectPath);

    await approvalMemoryStore.grant({
      scope: "session",
      sessionId: KILN_SESSION_ID,
      surface: "command",
      selector: "git push origin main",
      action: "allow",
    });

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "Bash", input: { command: "git push origin main" } },
      { type: "tool_result", toolName: "Bash", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ], "provider-session-42");

    const result = await runSession({
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
      approvalMemoryStore,
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

  it("allowed bash command preserves current behavior", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "bash", input: { command: "git status" } },
      { type: "tool_result", toolName: "bash", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
      { type: "tool_use", toolName: "Bash", input: { command: "git push origin main" } },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(preToolUse).not.toHaveBeenCalled();
  });

  it("denies MCP tool when canonical selector is not in scoped mcpTools allowlist", async () => {
    const reportFailure = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      {
        type: "tool_use",
        toolName: "memory_store",
        input: {},
        source: "mcp",
        mcpSelector: "secrets/fetch",
      },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
          agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["  MEMORY_STORE  "] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
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
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { type: "tool_use", toolName: "memory_store [DENIED]" },
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
        type: "tool_use",
        toolName: "memory_store",
        input: { key: "a", value: "b" },
        source: "mcp",
        mcpSelector: "  MeMoRy_Store ",
      },
      { type: "tool_result", toolName: "memory_store", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
          agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["  MEMORY_STORE  "] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
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
        type: "tool_use",
        toolName: "Memory_Store",
        input: { key: "a", value: "b" },
        source: "mcp",
      },
      { type: "tool_result", toolName: "Memory_Store", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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
          agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: [" memory_store "] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
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

  it("MCP tool use preserves current behavior when no scoped mcpTools restriction exists", async () => {
    const reportFailure = vi.fn();
    const reportSuccess = vi.fn();
    const preToolUse = vi.fn();
    const postToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "memory_store", input: { key: "a", value: "b" }, source: "mcp" },
      { type: "tool_result", toolName: "memory_store", output: "ok" },
      { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
    ]);

    const result = await runSession({
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

    expect(result.sessionSucceeded).toBe(true);
    expect(preToolUse).toHaveBeenCalledWith("memory_store");
    expect(postToolUse).toHaveBeenCalledWith("memory_store");
    expect(reportSuccess).toHaveBeenCalledWith("claude");
    expect(reportFailure).not.toHaveBeenCalled();
  });
});
