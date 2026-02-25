import { describe, it, expect } from "vitest";
import { ClaudeSession } from "../../src/wrapper/claude-code-process.js";
import type { ClaudeSessionConfig } from "../../src/wrapper/claude-code-process.js";

function baseConfig(overrides: Partial<ClaudeSessionConfig> = {}): ClaudeSessionConfig {
  return {
    task: "Fix the login bug",
    systemPrompt: "You are a test assistant.",
    cwd: process.cwd(),
    ...overrides,
  };
}

describe("ClaudeSession", () => {
  it("isRunning returns false before start", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.isRunning).toBe(false);
  });

  it("stop does not throw before start", () => {
    const session = new ClaudeSession(baseConfig());
    expect(() => session.stop()).not.toThrow();
  });

  it("stop can be called multiple times without error", () => {
    const session = new ClaudeSession(baseConfig());
    expect(() => {
      session.stop();
      session.stop();
      session.stop();
    }).not.toThrow();
  });

  it("isRunning remains false after stop without start", () => {
    const session = new ClaudeSession(baseConfig());
    session.stop();
    expect(session.isRunning).toBe(false);
  });

  it("accepts message handlers before start without error", () => {
    const session = new ClaudeSession(baseConfig());
    const handler = () => {};
    expect(() => session.onMessage(handler)).not.toThrow();
  });

  it("accepts exit handlers before start without error", () => {
    const session = new ClaudeSession(baseConfig());
    const handler = () => {};
    expect(() => session.onExit(handler)).not.toThrow();
  });

  it("accepts multiple message handlers", () => {
    const session = new ClaudeSession(baseConfig());
    expect(() => {
      session.onMessage(() => {});
      session.onMessage(() => {});
    }).not.toThrow();
    // Session still not running -- handlers are queued for when start() is called
    expect(session.isRunning).toBe(false);
  });

  it("accepts MCP server config without affecting pre-start state", () => {
    const session = new ClaudeSession(
      baseConfig({
        mcpServers: {
          kiln: {
            command: "bun",
            args: ["run", "/path/to/mcp.ts"],
          },
        },
      }),
    );
    expect(session.isRunning).toBe(false);
    expect(() => session.stop()).not.toThrow();
  });

  it("accepts permission mode config without affecting pre-start state", () => {
    const session = new ClaudeSession(
      baseConfig({
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      }),
    );
    expect(session.isRunning).toBe(false);
    expect(() => session.stop()).not.toThrow();
  });

  it("accepts env config without affecting pre-start state", () => {
    const session = new ClaudeSession(
      baseConfig({
        env: { ANTHROPIC_API_KEY: "sk-test" },
      }),
    );
    expect(session.isRunning).toBe(false);
    expect(() => session.stop()).not.toThrow();
  });
});
