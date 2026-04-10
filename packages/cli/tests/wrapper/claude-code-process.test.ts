import { describe, it, expect, vi } from "vitest";
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query as mockedQuery } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession } from "../../src/wrapper/claude-code-process.js";
import type { ClaudeSessionConfig } from "../../src/wrapper/claude-code-process.js";
import type { IKilnSession, SessionEvent } from "../../src/wrapper/session.js";

function baseConfig(overrides: Partial<ClaudeSessionConfig> = {}): ClaudeSessionConfig {
  return {
    task: "Fix the login bug",
    systemPrompt: "You are a test assistant.",
    cwd: process.cwd(),
    ...overrides,
  };
}

async function collectEvents(iter: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
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
});
