import { beforeEach, describe, it, expect, vi } from "vitest";
import { mcpConfigCommand } from "../../src/commands/mcp-config.js";
import type { KilnAppConfig } from "../../src/config.js";

vi.mock("../../src/mcp/config-generator.js", async () => {
  const mod = await vi.importActual<typeof import("../../src/mcp/config-generator.js")>("../../src/mcp/config-generator.js");
  return {
    ...mod,
    generateMcpConfig: vi.fn().mockResolvedValue(undefined),
  };
});

const APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Test app",
  createRegistry: () => { throw new Error("not used"); },
  mcpServerName: "kiln",
};

describe("mcpConfigCommand", () => {
  beforeEach(async () => {
    const { generateMcpConfig } = await import("../../src/mcp/config-generator.js");
    vi.mocked(generateMcpConfig).mockClear();
  });

  it("defaults to claude-code client", async () => {
    const { generateMcpConfig } = await import("../../src/mcp/config-generator.js");
    await mcpConfigCommand(APP_CONFIG, {});
    expect(generateMcpConfig).toHaveBeenCalledWith(
      "claude-code",
      { name: "kiln", command: "kiln", args: ["tools", "--mcp"] },
      expect.any(String),
    );
  });

  it("uses the canonical CLI MCP entrypoint for all generated client projections", async () => {
    const { generateMcpConfig } = await import("../../src/mcp/config-generator.js");
    await mcpConfigCommand(APP_CONFIG, { client: "all" });
    expect(generateMcpConfig).toHaveBeenCalledWith(
      "all",
      { name: "kiln", command: "kiln", args: ["tools", "--mcp"] },
      expect.any(String),
    );
  });

  it("uses custom client flag", async () => {
    const { generateMcpConfig } = await import("../../src/mcp/config-generator.js");
    await mcpConfigCommand(APP_CONFIG, { client: "codex" });
    expect(generateMcpConfig).toHaveBeenCalledWith(
      "codex",
      expect.any(Object),
      expect.any(String),
    );
  });

  it("uses custom name flag", async () => {
    const { generateMcpConfig } = await import("../../src/mcp/config-generator.js");
    await mcpConfigCommand(APP_CONFIG, { name: "custom-server" });
    expect(generateMcpConfig).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: "custom-server" }),
      expect.any(String),
    );
  });

  it("uses custom command flag", async () => {
    const { generateMcpConfig } = await import("../../src/mcp/config-generator.js");
    await mcpConfigCommand(APP_CONFIG, { command: "bun" });
    expect(generateMcpConfig).toHaveBeenCalledWith(
      expect.any(String),
      { name: "kiln", command: "bun", args: ["tools", "--mcp"] },
      expect.any(String),
    );
  });

  it("uses custom args flag", async () => {
    const { generateMcpConfig } = await import("../../src/mcp/config-generator.js");
    await mcpConfigCommand(APP_CONFIG, { args: "run ./server.js" });
    expect(generateMcpConfig).toHaveBeenCalledWith(
      expect.any(String),
      { name: "kiln", command: "kiln", args: ["run", "./server.js"] },
      expect.any(String),
    );
  });

  it("passes all flags together", async () => {
    const { generateMcpConfig } = await import("../../src/mcp/config-generator.js");
    await mcpConfigCommand(APP_CONFIG, { client: "opencode", name: "my-kiln", command: "bun", args: "run kiln tools --mcp" });
    expect(generateMcpConfig).toHaveBeenCalledWith(
      "opencode",
      { name: "my-kiln", command: "bun", args: ["run", "kiln", "tools", "--mcp"] },
      expect.any(String),
    );
  });
});
