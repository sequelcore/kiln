import { describe, it, expect, vi } from "vitest";
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query as mockedQuery } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession } from "../../src/wrapper/claude-code-process.js";
import type { ClaudeSessionConfig } from "../../src/wrapper/claude-code-process.js";
import type { ExecutionSessionEvent } from "@kilnai/core";
import type { IKilnSession } from "../../src/wrapper/session.js";

function baseConfig(overrides: Partial<ClaudeSessionConfig> = {}): ClaudeSessionConfig {
  return {
    task: "Fix the login bug",
    systemPrompt: "You are a test assistant.",
    cwd: process.cwd(),
    ...overrides,
  };
}

async function collectEvents(iter: AsyncIterable<ExecutionSessionEvent>): Promise<ExecutionSessionEvent[]> {
  const events: ExecutionSessionEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

describe("ClaudeSession implements IKilnSession", () => {
  it("declares implements IKilnSession", () => {
    const session: IKilnSession = new ClaudeSession(baseConfig());
    expect(session).toBeDefined();
  });

  it("sessionId is a non-empty UUID string", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("sessionId is stable across multiple reads", () => {
    const session = new ClaudeSession(baseConfig());
    const id1 = session.sessionId;
    const id2 = session.sessionId;
    expect(id1).toBe(id2);
  });

  it("uses configured runtime session identity", () => {
    const session = new ClaudeSession(baseConfig({ runtimeSessionId: "kiln-tui:claude:session-1" }));
    expect(session.sessionId).toBe("kiln-tui:claude:session-1");
  });

  it("capabilities.mcp is true", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.capabilities.mcp).toBe(true);
  });

  it("capabilities.streaming is true", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.capabilities.streaming).toBe(true);
  });

  it("capabilities.resume is false", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.capabilities.resume).toBe(false);
  });

  it("capabilities.costTrackingMode is native", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.capabilities.costTrackingMode).toBe("native");
  });

  it("capabilities.maxContextTokens is null", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.capabilities.maxContextTokens).toBeNull();
  });

  it("capabilities.priority is 1", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.capabilities.priority).toBe(1);
  });

  it("capabilities.fallbackTo is null", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.capabilities.fallbackTo).toBeNull();
  });

  it("dispose resolves without error", async () => {
    const session = new ClaudeSession(baseConfig());
    await expect(session.dispose()).resolves.toBeUndefined();
  });

  it("dispose can be called multiple times without error", async () => {
    const session = new ClaudeSession(baseConfig());
    await session.dispose();
    await expect(session.dispose()).resolves.toBeUndefined();
  });

  it("run() emits MCP-origin tool_use events with source mcp", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield {
        type: "assistant",
        message: {
          content: [
            {
              type: "mcp_tool_use",
              name: "memory_store",
              input: { key: "k", value: "v" },
            },
          ],
        },
      };
    })());

    const session = new ClaudeSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    expect(events).toContainEqual({
      type: "tool_use",
      toolName: "memory_store",
      input: { key: "k", value: "v" },
      source: "mcp",
      mcpSelector: "memory_store",
    });
  });

  it("injects execution identity into the SDK system prompt append", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield { type: "result", total_cost_usd: 0, is_error: false };
    })());

    const session = new ClaudeSession(baseConfig({ model: "claude-sonnet-4-5-20250929" }));
    await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    const queryCalls = (mockedQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const queryCall = queryCalls[queryCalls.length - 1]?.[0] as {
      options?: { systemPrompt?: { append?: string } };
    } | undefined;
    const appendedSystemPrompt = queryCall?.options?.systemPrompt?.append ?? "";
    expect(appendedSystemPrompt).toContain("[KILN EXECUTION IDENTITY]");
    expect(appendedSystemPrompt).toContain("provider: claude-code");
    expect(appendedSystemPrompt).toContain("model: claude-sonnet-4-5-20250929");
  });

  it("uses the SDK JSON schema output format for a managed structured handoff", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield { type: "result", total_cost_usd: 0, is_error: false };
    })());

    const schema = { type: "object", required: ["summary"] };
    const session = new ClaudeSession(baseConfig({
      structuredOutputSchema: schema,
      sessionLedgerOwner: "host",
    }));
    await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    const queryCalls = (mockedQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const queryCall = queryCalls[queryCalls.length - 1]?.[0] as {
      options?: {
        outputFormat?: { type?: string; schema?: unknown };
        persistSession?: boolean;
      };
    } | undefined;
    expect(queryCall?.options?.outputFormat).toEqual({ type: "json_schema", schema });
    expect(queryCall?.options?.persistSession).toBe(false);
  });

  it("emits one native structured output event without treating it as prose", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield { type: "system", subtype: "init", model: "claude-fable-5-20260715[1m]", claude_code_version: "2.1.220" };
      yield { type: "assistant", message: { content: [{ type: "text", text: "explanatory prose" }] } };
      yield {
        type: "result",
        total_cost_usd: 0,
        is_error: false,
        modelUsage: {
          "claude-haiku-4-5-20251001": {},
          "claude-fable-5-20260715[1m]": {},
        },
        structured_output: { summary: "canonical" },
      };
    })());
    const session = new ClaudeSession(baseConfig({
      structuredOutputSchema: { type: "object" },
      harnessExecutable: "C:/tools/claude.exe",
      harnessEvidence: {
        executable: "<operator-harness>/claude.exe",
        version: "2.1.220",
      },
    }));
    const events = await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    expect(events.filter((event) => event.type === "structured_output")).toEqual([
      {
        type: "structured_output",
        value: { summary: "canonical" },
        primaryProviderModelId: "claude-fable-5-20260715[1m]",
        providerModelIds: ["claude-haiku-4-5-20251001", "claude-fable-5-20260715[1m]"],
        harness: {
          id: "claude-code",
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      },
    ]);
    expect(events.findIndex((event) => event.type === "structured_output"))
      .toBeLessThan(events.findIndex((event) => event.type === "completed"));
  });

  it("surfaces the SDK failure subtype so schema-retry exhaustion is not a silent absence", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield {
        type: "result",
        subtype: "error_max_structured_output_retries",
        total_cost_usd: 0.01,
        is_error: true,
        errors: ["structured output did not satisfy the schema"],
      };
    })());

    const session = new ClaudeSession(baseConfig({ structuredOutputSchema: { type: "object" } }));
    const events = await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    const error = events.find((event) => event.type === "error");
    expect(error).toEqual({
      type: "error",
      code: "error_max_structured_output_retries",
      message: "structured output did not satisfy the schema",
      isRetryable: false,
    });
    expect(events.findIndex((event) => event.type === "error"))
      .toBeLessThan(events.findIndex((event) => event.type === "completed"));
  });

  it("reports a failed result without an errors array using its subtype", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield { type: "result", subtype: "error_max_turns", total_cost_usd: 0, is_error: true };
    })());

    const session = new ClaudeSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    const error = events.find((event) => event.type === "error");
    expect(error).toMatchObject({ type: "error", code: "error_max_turns", isRetryable: false });
    expect((error as { message: string }).message.length).toBeGreaterThan(0);
  });

  it("emits no error event for a successful result", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield { type: "result", subtype: "success", total_cost_usd: 0, is_error: false };
    })());

    const session = new ClaudeSession(baseConfig());
    const events = await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    expect(events.filter((event) => event.type === "error")).toEqual([]);
  });

  it("executes the operator-resolved Claude Code binary instead of the SDK bundled build", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield { type: "result", subtype: "success", total_cost_usd: 0, is_error: false };
    })());

    const session = new ClaudeSession(baseConfig({ harnessExecutable: "C:/tools/claude.exe" }));
    await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    const queryCalls = (mockedQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const queryCall = queryCalls[queryCalls.length - 1]?.[0] as {
      options?: { pathToClaudeCodeExecutable?: string };
    } | undefined;
    expect(queryCall?.options?.pathToClaudeCodeExecutable).toBe("C:/tools/claude.exe");
  });

  it("leaves the executable unset when no operator binary was resolved", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield { type: "result", subtype: "success", total_cost_usd: 0, is_error: false };
    })());

    const session = new ClaudeSession(baseConfig());
    await collectEvents(session.run({ prompt: "test prompt", cwd: process.cwd() }));

    const queryCalls = (mockedQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const queryCall = queryCalls[queryCalls.length - 1]?.[0] as {
      options?: Record<string, unknown>;
    } | undefined;
    expect(queryCall?.options).not.toHaveProperty("pathToClaudeCodeExecutable");
  });

  it("keeps a cancelled run cancelled instead of reclassifying it as a provider failure", async () => {
    (mockedQuery as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce((async function* () {
      yield { type: "result", subtype: "error_during_execution", total_cost_usd: 0, is_error: true };
    })());

    const controller = new AbortController();
    controller.abort();
    const session = new ClaudeSession(baseConfig());
    const events = await collectEvents(
      session.run({ prompt: "test prompt", cwd: process.cwd(), abortSignal: controller.signal }),
    );

    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(events.find((event) => event.type === "completed"))
      .toMatchObject({ outcome: "cancelled" });
  });
});
