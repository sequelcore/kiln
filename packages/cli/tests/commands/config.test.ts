import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configCommand } from "../../src/commands/config.js";
import type { ProjectConfig } from "../../src/commands/init.js";
import type { KilnAppConfig } from "../../src/config.js";
import { DomainRegistry } from "@kiln/core";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

function writeConfig(dir: string, config: ProjectConfig): void {
  mkdirSync(join(dir, ".kiln"), { recursive: true });
  writeFileSync(join(dir, ".kiln", "config.json"), JSON.stringify(config, null, 2) + "\n");
}

function readConfig(dir: string): ProjectConfig {
  return JSON.parse(readFileSync(join(dir, ".kiln", "config.json"), "utf-8")) as ProjectConfig;
}

const DEFAULT_CONFIG: ProjectConfig = {
  domain: "python",
  requireApproval: true,
  maxDepth: 3,
  parallelWorkers: 2,
  provider: "claude",
  mode: "api-key",
};

describe("configCommand", () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  it("show prints current config", () => {
    writeConfig(tempDir, DEFAULT_CONFIG);

    configCommand(MOCK_APP_CONFIG, "show", [], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('"domain": "python"');
    expect(output).toContain('"requireApproval": true');
    expect(output).toContain('"maxDepth": 3');
  });

  it("set updates a config value", () => {
    writeConfig(tempDir, DEFAULT_CONFIG);

    configCommand(MOCK_APP_CONFIG, "set", ["provider", "openai"], tempDir);

    const config = readConfig(tempDir);
    expect(config.provider).toBe("openai");
  });

  it("set handles boolean values", () => {
    writeConfig(tempDir, DEFAULT_CONFIG);

    configCommand(MOCK_APP_CONFIG, "set", ["requireApproval", "false"], tempDir);

    const config = readConfig(tempDir);
    expect(config.requireApproval).toBe(false);
  });

  it("set handles numeric values", () => {
    writeConfig(tempDir, DEFAULT_CONFIG);

    configCommand(MOCK_APP_CONFIG, "set", ["maxDepth", "5"], tempDir);

    const config = readConfig(tempDir);
    expect(config.maxDepth).toBe(5);
  });

  it("errors when not initialized", () => {
    configCommand(MOCK_APP_CONFIG, "show", [], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Not initialized");
  });
});
