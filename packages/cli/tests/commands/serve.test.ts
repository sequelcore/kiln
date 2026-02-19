import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "@kilnai/core";
import type { KilnAppConfig } from "../../src/config.js";

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
let capturedOrchestrator: unknown = null;

vi.mock("../../src/mcp/server.js", () => {
  return {
    KilnMcpServer: class MockKilnMcpServer {
      start = mockStart;
      stop = mockStop;
      constructor(orchestrator: unknown) {
        capturedOrchestrator = orchestrator;
      }
    },
  };
});

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => {
    throw new Error("createRegistry not called in serve tests");
  },
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

describe("serveCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOrchestrator = null;
  });

  it("creates orchestrator and MCP server", async () => {
    const { serveCommand } = await import("../../src/commands/serve.js");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await serveCommand(MOCK_APP_CONFIG);

    expect(capturedOrchestrator).toBeInstanceOf(Orchestrator);

    stderrSpy.mockRestore();
  });

  it("calls server.start()", async () => {
    const { serveCommand } = await import("../../src/commands/serve.js");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await serveCommand(MOCK_APP_CONFIG);

    expect(mockStart).toHaveBeenCalledTimes(1);

    stderrSpy.mockRestore();
  });
});
