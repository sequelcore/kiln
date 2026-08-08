import { afterEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../src/config.js";
import { createCli } from "../src/index.js";

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be used in tools command tests");
  },
  kilnYaml: {
    version: "1",
  },
};

describe("CLI help", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("shows the tools command in CLI help output", async () => {
    process.argv = ["bun", "kiln", "--help"];
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    await expect(createCli(APP_CONFIG)).rejects.toThrow("process.exit:0");

    const helpOutput = stdoutSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(helpOutput).toContain("import-native");
    expect(helpOutput).toContain("uninstall");
    expect(helpOutput).toContain("route");
    expect(helpOutput).toContain("tools");
    expect(helpOutput).toContain("operator-runtime");
    expect(helpOutput).not.toContain("  serve");
    expect(helpOutput).toContain(
      "Launch native dev tools MCP server over stdio and inspect shared resources (--mcp, --resources, --resource <uri>)",
    );
  });

  it("shows sync help without dispatching the mutating command", async () => {
    process.argv = ["bun", "kiln", "sync", "--help"];
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    await expect(createCli(APP_CONFIG)).rejects.toThrow("process.exit:0");

    const helpOutput = stdoutSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(helpOutput).toContain("kiln sync (--all | --target <targets> | <target flags>)");
    expect(helpOutput).toContain("--dry-run");
  });
});
