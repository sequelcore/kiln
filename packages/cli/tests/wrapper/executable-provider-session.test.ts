import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionEvent } from "../../src/wrapper/session.js";
import { ExecutableProviderSession, type ExecutableProviderSessionConfig } from "../../src/wrapper/executable-provider-session.js";

const mockProcessMessage = vi.fn();
const mockOrchestratorConstructor = vi.fn();
const mockAddUserMessage = vi.fn();
const mockAddAssistantMessage = vi.fn();

vi.mock("@kilnai/runtime", () => {
  class MockRuntimeSession {
    addUserMessage = mockAddUserMessage;
    addAssistantMessage = mockAddAssistantMessage;
    conversationHistory: unknown[] = [];
    sessionMode = "ai_active" as const;
    id = "cli-test-session";
  }

  return {
    RuntimeSessionOrchestrator: class MockRuntimeSessionOrchestrator {
      constructor(...args: unknown[]) {
        mockOrchestratorConstructor(...args);
      }
      processMessage = mockProcessMessage;
    },
    RuntimeSession: MockRuntimeSession,
  };
});

const mocks = {
  processMessage: mockProcessMessage,
  orchestratorConstructor: mockOrchestratorConstructor,
  addUserMessage: mockAddUserMessage,
  addAssistantMessage: mockAddAssistantMessage,
};

function baseConfig(overrides: Partial<ExecutableProviderSessionConfig> = {}): ExecutableProviderSessionConfig {
  return {
    provider: "codex-oauth",
    task: "Implement feature X",
    permissionPolicy: { approval: "never", sandbox: "read-only" },
    ...overrides,
  };
}

async function collectEvents(iter: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const event of iter) {
    events.push(event);
  }
  return events;
}

describe("ExecutableProviderSession implements IKilnSession", () => {
  it("declares implements IKilnSession", () => {
    const session: import("../../src/wrapper/session.js").IKilnSession = new ExecutableProviderSession(baseConfig());
    expect(session).toBeDefined();
  });

  it("sessionId is a non-empty UUID string", () => {
    const session = new ExecutableProviderSession(baseConfig());
    expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("providerSessionId is undefined", () => {
    const session = new ExecutableProviderSession(baseConfig());
    expect(session.providerSessionId).toBeUndefined();
  });

  it("supportedTools includes the 7 CLI builtin tools", () => {
    const session = new ExecutableProviderSession(baseConfig());
    const tools = session.capabilities.supportedTools;
    expect(tools).toContain("bash");
    expect(tools).toContain("read");
    expect(tools).toContain("write");
    expect(tools).toContain("edit");
    expect(tools).toContain("grep");
    expect(tools).toContain("glob");
    expect(tools).toContain("git");
    expect(tools).toHaveLength(7);
  });

  it("capabilities reflect executable mode: mcp=false, streaming=true, costTrackingMode=computed", () => {
    const session = new ExecutableProviderSession(baseConfig());
    expect(session.capabilities).toMatchObject({
      mcp: false,
      streaming: true,
      resumable: false,
      resume: false,
      costTrackingMode: "computed",
      priority: 1,
    });
  });

  it("capabilities.supportedTools is non-empty (distinguishes executable from text-only)", () => {
    const session = new ExecutableProviderSession(baseConfig());
    expect(session.capabilities.supportedTools.length).toBeGreaterThan(0);
  });

  it("dispose resolves and is a no-op", async () => {
    const session = new ExecutableProviderSession(baseConfig());
    await expect(session.dispose()).resolves.toBeUndefined();
    await expect(session.dispose()).resolves.toBeUndefined();
  });
});

describe("ExecutableProviderSession.run()", () => {
  beforeEach(() => {
    mocks.processMessage.mockReset();
    mocks.orchestratorConstructor.mockReset();
    mocks.addUserMessage.mockReset();
    mocks.addAssistantMessage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("yields text_delta events from orchestrator result.parts", async () => {
    mocks.processMessage.mockResolvedValueOnce({
      parts: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
      toolExecutions: [],
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ExecutableProviderSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "test prompt" }));

    expect(events).toContainEqual({ type: "text_delta", content: "Hello " });
    expect(events).toContainEqual({ type: "text_delta", content: "world" });
  });

  it("yields tool_result events from orchestrator toolExecutions", async () => {
    mocks.processMessage.mockResolvedValueOnce({
      parts: [{ type: "text", text: "Done" }],
      toolExecutions: [
        {
          toolName: "bash",
          durationMs: 42,
          success: true,
          resultSummary: "echo output",
        },
      ],
      inputTokens: 5,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ExecutableProviderSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "run command" }));

    expect(events).toContainEqual({
      type: "tool_result",
      toolName: "bash",
      output: "echo output",
    });
  });

  it("yields file_changed events for write/edit tool executions", async () => {
    mocks.processMessage.mockResolvedValueOnce({
      parts: [{ type: "text", text: "File written" }],
      toolExecutions: [
        {
          toolName: "write",
          durationMs: 50,
          success: true,
          resultSummary: "written",
          fileChanges: [{ path: "src/foo.ts", changeType: "modified" as const }],
        },
      ],
      inputTokens: 5,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ExecutableProviderSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "write file" }));

    expect(events).toContainEqual({
      type: "file_changed",
      path: "src/foo.ts",
      changeType: "modified",
    });
  });

  it("yields error and completed on orchestrator error", async () => {
    mocks.processMessage.mockRejectedValueOnce(new Error("network failure"));

    const session = new ExecutableProviderSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "test" }));

    expect(events).toContainEqual({
      type: "error",
      code: "EXECUTABLE_SESSION_ERROR",
      message: "network failure",
      isRetryable: false,
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: true }));
  });

  it("yields error and completed when aborted before start", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const session = new ExecutableProviderSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "aborted", abortSignal: abortController.signal }));

    expect(events).toContainEqual({
      type: "error",
      code: "ABORTED",
      message: "Aborted before start",
      isRetryable: false,
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: true }));
  });

  it("yields escalation error when orchestrator returns escalation signal", async () => {
    mocks.processMessage.mockResolvedValueOnce({
      parts: [],
      toolExecutions: [],
      inputTokens: 5,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
      escalation: { reason: "dangerous command detected", type: "dangerous_command" as const },
    });

    const session = new ExecutableProviderSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "dangerous" }));

    expect(events).toContainEqual({
      type: "error",
      code: "ESCALATION",
      message: "dangerous command detected",
      isRetryable: false,
    });
  });

  it("yields cost_update and completed at end of successful run", async () => {
    mocks.processMessage.mockResolvedValueOnce({
      parts: [{ type: "text", text: "done" }],
      toolExecutions: [],
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ExecutableProviderSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "finish" }));

    expect(events).toContainEqual({ type: "cost_update", usd: 0, mode: "computed" });
    const completed = events.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { isError: boolean }).isError).toBe(false);
  });

  it("passes tool definitions into RuntimeSessionOrchestrator so the provider can emit tool calls", async () => {
    mocks.processMessage.mockResolvedValueOnce({
      parts: [{ type: "text", text: "done" }],
      toolExecutions: [],
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ExecutableProviderSession(baseConfig());
    await collectEvents(session.run({ prompt: "finish" }));

    expect(mocks.orchestratorConstructor).toHaveBeenCalledTimes(1);
    const [deps] = mocks.orchestratorConstructor.mock.calls[0] as [{ tools?: Array<{ name: string }> }];
    expect(deps.tools?.map((tool) => tool.name)).toEqual(["bash", "read", "write", "edit", "grep", "glob", "git"]);
  });

  it("does not eagerly add the user message before delegating to the orchestrator", async () => {
    mocks.processMessage.mockResolvedValueOnce({
      parts: [{ type: "text", text: "done" }],
      toolExecutions: [],
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ExecutableProviderSession(baseConfig());
    await collectEvents(session.run({ prompt: "finish" }));

    expect(mocks.addUserMessage).not.toHaveBeenCalled();
  });
});
