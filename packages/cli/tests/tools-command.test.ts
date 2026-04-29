import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../src/config.js";

const coreMocks = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const bridge = { source: "core-default-bridge" };
  const toolNames = ["bash", "read", "write", "edit", "patch", "stat", "tree", "view_image", "ocr_image", "web_search", "web_fetch", "grep", "glob", "git"];
  return {
    bridge,
    toolNames,
    createDefaultBuiltinToolSurface: vi.fn(() => ({ bridge, toolNames })),
    initialize: vi.fn().mockResolvedValue(undefined),
    connect,
    createServer: vi.fn(() => ({ connect })),
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class MockStdioServerTransport {},
}));

vi.mock("@kilnai/core", () => ({
  createDefaultBuiltinToolSurface: coreMocks.createDefaultBuiltinToolSurface,
  DevToolsMcpServer: class MockDevToolsMcpServer {
    constructor(options: unknown) {
      expect(options).toEqual({ bridge: coreMocks.bridge });
    }
    initialize = coreMocks.initialize;
    createServer = coreMocks.createServer;
  },
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

    expect(coreMocks.createDefaultBuiltinToolSurface).toHaveBeenCalledTimes(1);
    expect(coreMocks.createDefaultBuiltinToolSurface).toHaveReturnedWith({
      bridge: coreMocks.bridge,
      toolNames: coreMocks.toolNames,
    });
    expect(coreMocks.initialize).toHaveBeenCalledTimes(1);
    expect(coreMocks.createServer).toHaveBeenCalledTimes(1);
    expect(coreMocks.connect).toHaveBeenCalledTimes(1);
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
