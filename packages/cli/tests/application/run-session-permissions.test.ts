import { describe, expect, it, vi } from "vitest";
import type { DomainConfig } from "@kilnai/core";
import { runSession } from "../../src/application/run-session.js";
import type { SessionContext } from "../../src/wrapper/index.js";

const DOMAIN: DomainConfig = {
  name: "generic",
  displayName: "Generic",
  detectPatterns: [],
  toolTags: new Set(),
  qualityGates: [],
  multishotExamples: "",
  phaseExamples: "",
};

function makeContext(): SessionContext {
  return {
    mode: "api-key",
    domain: DOMAIN,
    systemPrompt: "",
    memorySnapshot: undefined,
    mcpServerEntryPath: "",
    workingDirectory: process.cwd(),
    task: "Test permission gating",
  };
}

function createSessionFromEvents(
  events: readonly unknown[],
): {
  sessionId: string;
  capabilities: Record<string, unknown>;
  run: () => AsyncGenerator<unknown, void, unknown>;
  dispose: () => Promise<void>;
} {
  return {
    sessionId: "session-1",
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

  it("disallowed MCP tool is denied when scoped mcpTools allowlist is defined", async () => {
    const reportFailure = vi.fn();
    const preToolUse = vi.fn();

    const session = createSessionFromEvents([
      { type: "tool_use", toolName: "secrets_fetch", input: {}, source: "mcp" },
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
          agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["memory_store"] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["memory_store"] }],
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
    expect(result.lastError).toContain('denied MCP tool "secrets_fetch"');
    expect(reportFailure).toHaveBeenCalledWith("claude", false);
    expect(preToolUse).not.toHaveBeenCalled();
    expect(result.transcript).toContainEqual(
      expect.objectContaining({
        event: { type: "tool_use", toolName: "secrets_fetch [DENIED]" },
      }),
    );
  });

  it("allowed MCP tool passes when included in scoped mcpTools allowlist", async () => {
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
          agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["memory_store"] }],
        },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        agentScopes: [{ agent: "agent-alpha", inherit: true, mcpTools: ["memory_store"] }],
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
