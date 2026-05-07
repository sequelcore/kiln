import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKilnConfigReadTool } from "../../src/application/config-read-tool.js";

let tempDir: string;

describe("KilnConfigReadTool", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-read-tool-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempDir, "xdg"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "tool-project" }), "utf-8");
    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
    writeFileSync(join(tempDir, ".kiln", "kiln.yaml"), [
      'version: "1"',
      "provider: codex-oauth",
      "permissions:",
      "  approval: on-request",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf-8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns a governed read-only config view", async () => {
    const tool = createKilnConfigReadTool(tempDir);

    const result = await tool.execute({
      name: "kiln_config.read",
      input: { view: "permissions" },
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toEqual({
      approval: "on-request",
      sandbox: "read-only",
    });
  });

  it("rejects unknown views", async () => {
    const tool = createKilnConfigReadTool(tempDir);

    const result = await tool.execute({
      name: "kiln_config.read",
      input: { view: "yaml" },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid kiln_config.read view");
  });
});
