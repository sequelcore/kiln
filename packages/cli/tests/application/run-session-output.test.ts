import { describe, expect, it, vi, afterEach } from "vitest";
import type { DomainConfig } from "@kilnai/core";
import { runSession } from "../../src/application/run-session.js";
import { createRunOutputController } from "../../src/application/run-output.js";
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
const TOOL_CALL_SCOPE_ID = "turn-1:response:1";

function makeContext(): SessionContext {
  return {
    mode: "api-key",
    domain: DOMAIN,
    systemPrompt: "",
    projectedContext: { blocks: [], estimatedTokens: 0 },
    memorySnapshot: undefined,
    mcpServerEntryPath: "",
    workingDirectory: process.cwd(),
    task: "Return exact output",
  };
}

function createSessionFromEvents(events: readonly unknown[]) {
  return {
    sessionId: "provider-session-1",
    capabilities: {},
    run: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    dispose: async () => {},
  };
}

describe("runSession output routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes assistant deltas and tool telemetry through the supplied output sink", async () => {
    const output = {
      mode: "answer" as const,
      writeAssistantDelta: vi.fn(),
      resetAssistantAnswer: vi.fn(),
      writeToolUse: vi.fn(),
      writeToolOutputDelta: vi.fn(),
      writeProviderFallback: vi.fn(),
    };
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const session = createSessionFromEvents([
      {
        type: "tool_use",
        toolCallId: "read-1",
        toolCallScopeId: TOOL_CALL_SCOPE_ID,
        toolName: "Read",
        input: { path: "README.md" },
      },
      {
        type: "tool_output_delta",
        toolCallId: "read-1",
        toolCallScopeId: TOOL_CALL_SCOPE_ID,
        toolName: "Read",
        stream: "stdout",
        delta: "reading\n",
        chunkIndex: 0,
      },
      {
        type: "tool_result",
        toolCallId: "read-1",
        toolCallScopeId: TOOL_CALL_SCOPE_ID,
        toolName: "Read",
        output: "ok",
      },
      {
        type: "tool_use",
        toolCallId: "bash-1",
        toolCallScopeId: TOOL_CALL_SCOPE_ID,
        toolName: "bash",
        input: { command: "bunx vitest run" },
      },
      {
        type: "tool_result",
        toolCallId: "bash-1",
        toolCallScopeId: TOOL_CALL_SCOPE_ID,
        toolName: "bash",
        output: "blocked",
        isError: true,
      },
      { type: "text_delta", content: "Only four bullets.\n" },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]);

    const result = await runSession({
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: [], scores: [] }),
        createSession: () => session as never,
        reportFailure: () => {},
        reportSuccess: () => {},
      } as never,
      cleanupRegistry: { register: () => {} } as never,
      manager: { trackCostUpdate: () => {} } as never,
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
      } as never,
      output,
    });

    expect(result.accumulatedText).toBe("Only four bullets.\n");
    expect(output.writeAssistantDelta).toHaveBeenCalledWith("Only four bullets.\n");
    expect(output.writeToolUse).toHaveBeenCalledWith("Read");
    expect(output.writeToolOutputDelta).toHaveBeenCalledWith("reading\n");
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(result.exactArtifacts).toContain("File inspected: README.md");
    expect(result.exactArtifacts).not.toContain("Command executed: bunx vitest run");
  });

  it("does not route thinking deltas into answer output", async () => {
    const output = {
      mode: "answer" as const,
      writeAssistantDelta: vi.fn(),
      resetAssistantAnswer: vi.fn(),
      writeToolUse: vi.fn(),
      writeToolOutputDelta: vi.fn(),
      writeProviderFallback: vi.fn(),
    };
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const session = createSessionFromEvents([
      { type: "text_delta", content: "private reasoning", isThinking: true },
      { type: "text_delta", content: "visible answer" },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]);

    const result = await runSession({
      registry: {
        selectBest: () => ({ primary: "opencode", orderedFallbacks: [], scores: [] }),
        createSession: () => session as never,
        reportFailure: () => {},
        reportSuccess: () => {},
      } as never,
      cleanupRegistry: { register: () => {} } as never,
      manager: { trackCostUpdate: () => {} } as never,
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
      } as never,
      output,
    });

    expect(result.accumulatedText).toBe("visible answer");
    expect(output.writeAssistantDelta).toHaveBeenCalledTimes(1);
    expect(output.writeAssistantDelta).toHaveBeenCalledWith("visible answer");
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it("routes provider fallback notices through the supplied output sink", async () => {
    const output = {
      mode: "answer" as const,
      writeAssistantDelta: vi.fn(),
      resetAssistantAnswer: vi.fn(),
      writeToolUse: vi.fn(),
      writeToolOutputDelta: vi.fn(),
      writeProviderFallback: vi.fn(),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const primarySession = createSessionFromEvents([
      { type: "error", code: "PRIMARY_FAILED", message: "Primary failed", isRetryable: false },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "failed", isPreflightCrash: false },
    ]);
    const fallbackSession = createSessionFromEvents([
      { type: "text_delta", content: "fallback answer" },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]);

    await runSession({
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: ["opencode"], scores: [] }),
        createSession: (providerId: string) => providerId === "claude" ? primarySession as never : fallbackSession as never,
        reportFailure: () => {},
        reportSuccess: () => {},
      } as never,
      cleanupRegistry: { register: () => {} } as never,
      manager: { trackCostUpdate: () => {} } as never,
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
      } as never,
      output,
    });

    expect(output.writeProviderFallback).toHaveBeenCalledWith("claude");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("removes abandoned provider partial text from non-human output before fallback", async () => {
    const output = createRunOutputController("answer");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    const primarySession = createSessionFromEvents([
      { type: "text_delta", content: "primary partial" },
      { type: "error", code: "PRIMARY_FAILED", message: "Primary failed", isRetryable: false },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "failed", isPreflightCrash: false },
    ]);
    const fallbackSession = createSessionFromEvents([
      { type: "text_delta", content: "fallback answer" },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]);

    const result = await runSession({
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: ["opencode"], scores: [] }),
        createSession: (providerId: string) => providerId === "claude" ? primarySession as never : fallbackSession as never,
        reportFailure: () => {},
        reportSuccess: () => {},
      } as never,
      cleanupRegistry: { register: () => {} } as never,
      manager: { trackCostUpdate: () => {} } as never,
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
      } as never,
      output,
    });

    expect(result.accumulatedText).toBe("fallback answer");
    expect(result.lastError).toBeNull();
    expect(result.attempts).toMatchObject([
      { providerId: "claude", succeeded: false, error: "Primary failed" },
      { providerId: "opencode", succeeded: true, error: null },
    ]);
    expect(output.capturedAnswer).toBe("fallback answer");
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("Provider claude failed"));
  });

  it("returns only fallback answer after abandoned provider partial text without an output sink", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const primarySession = createSessionFromEvents([
      { type: "text_delta", content: "primary partial" },
      { type: "error", code: "PRIMARY_FAILED", message: "Primary failed", isRetryable: false },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "failed", isPreflightCrash: false },
    ]);
    const fallbackSession = createSessionFromEvents([
      { type: "text_delta", content: "fallback answer" },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]);

    const result = await runSession({
      registry: {
        selectBest: () => ({ primary: "claude", orderedFallbacks: ["opencode"], scores: [] }),
        createSession: (providerId: string) => providerId === "claude" ? primarySession as never : fallbackSession as never,
        reportFailure: () => {},
        reportSuccess: () => {},
      } as never,
      cleanupRegistry: { register: () => {} } as never,
      manager: { trackCostUpdate: () => {} } as never,
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
      } as never,
    });

    expect(result.accumulatedText).toBe("fallback answer");
    expect(result.lastError).toBeNull();
    expect(stdoutWrite).toHaveBeenCalledWith("primary partial");
    expect(stdoutWrite).toHaveBeenCalledWith("fallback answer");
    expect(consoleError).toHaveBeenCalledWith("[kiln] Provider claude failed, trying next...");
  });

  it("preserves provider error details when a run crashes before turn start", async () => {
    const session = createSessionFromEvents([
      { type: "error", code: "CODEX_EXIT_ERROR", message: "unexpected argument --bad", isRetryable: false },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "failed", isPreflightCrash: true },
    ]);

    const result = await runSession({
      registry: {
        selectBest: () => ({ primary: "codex", orderedFallbacks: [], scores: [] }),
        createSession: () => session as never,
        reportFailure: () => {},
        reportSuccess: () => {},
      } as never,
      cleanupRegistry: { register: () => {} } as never,
      manager: { trackCostUpdate: () => {} } as never,
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
      } as never,
    });

    expect(result.lastError).toBe("Provider codex crashed before starting: unexpected argument --bad");
    expect(result.attempts).toMatchObject([
      { providerId: "codex", succeeded: false, error: "Provider codex crashed before starting: unexpected argument --bad" },
    ]);
  });
});
