import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../src/config.js";

const mockRegister = vi.fn();
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockCreateServer = vi.fn(() => ({ connect: mockConnect }));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class MockStdioServerTransport {},
}));

vi.mock("@kilnai/core", () => ({
  DevToolRegistry: class MockDevToolRegistry {
    register = mockRegister;
  },
  DevToolExecutionBridge: class MockDevToolExecutionBridge {
    constructor(_options: unknown) {}
  },
  DevToolsMcpServer: class MockDevToolsMcpServer {
    constructor(_options: unknown) {}
    initialize = mockInitialize;
    createServer = mockCreateServer;
  },
  BashTool: class MockBashTool {},
  ReadTool: class MockReadTool {},
  WriteTool: class MockWriteTool {},
  EditTool: class MockEditTool {},
  GrepTool: class MockGrepTool {},
  GlobTool: class MockGlobTool {},
  GitTool: class MockGitTool {},
}));

import { createCli } from "../src/index.js";
import { toolsCommand } from "../src/commands/tools.js";

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be used in tools command tests");
  },
};

describe("tools command", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("starts the dev tools MCP entrypoint with --mcp", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await toolsCommand(APP_CONFIG, { mcp: true });

    expect(mockRegister).toHaveBeenCalledTimes(7);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockCreateServer).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "kiln dev tools MCP server running (stdio)",
    );
  });

  it("shows the tools command in CLI help output", async () => {
    process.argv = ["bun", "kiln", "--help"];
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    await expect(createCli(APP_CONFIG)).rejects.toThrow("process.exit:0");

    const helpOutput = stdoutSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(helpOutput).toContain("tools");
    expect(helpOutput).toContain(
      "Launch native dev tools MCP server over stdio (--mcp)",
    );
  });
});
