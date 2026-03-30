import { describe, it, expect } from "vitest";
import { ClaudeSession } from "../../src/wrapper/claude-code-process.js";
import type { ClaudeSessionConfig } from "../../src/wrapper/claude-code-process.js";
import type { IKilnSession } from "../../src/wrapper/session.js";

function baseConfig(overrides: Partial<ClaudeSessionConfig> = {}): ClaudeSessionConfig {
  return {
    task: "Fix the login bug",
    systemPrompt: "You are a test assistant.",
    cwd: process.cwd(),
    ...overrides,
  };
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
});
