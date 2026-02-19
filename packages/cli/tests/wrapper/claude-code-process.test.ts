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
  it("creates instance with config", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session).toBeDefined();
  });

  it("isRunning returns false before start", () => {
    const session = new ClaudeSession(baseConfig());
    expect(session.isRunning).toBe(false);
  });

  it("stop does not throw before start", () => {
    const session = new ClaudeSession(baseConfig());
    expect(() => session.stop()).not.toThrow();
  });

  it("accepts message handlers before start", () => {
    const session = new ClaudeSession(baseConfig());
    expect(() => session.onMessage(() => {})).not.toThrow();
  });

  it("accepts exit handlers before start", () => {
    const session = new ClaudeSession(baseConfig());
    expect(() => session.onExit(() => {})).not.toThrow();
  });

  it("stores MCP server config", () => {
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
    expect(session).toBeDefined();
  });

  it("stores permission mode config", () => {
    const session = new ClaudeSession(
      baseConfig({
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      }),
    );
    expect(session).toBeDefined();
  });

  it("stores env config", () => {
    const session = new ClaudeSession(
      baseConfig({
        env: { ANTHROPIC_API_KEY: "sk-test" },
      }),
    );
    expect(session).toBeDefined();
  });
});
