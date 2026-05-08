import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { configCommand } from "../../src/commands/config.js";
import type { KilnYaml } from "../../src/kiln-yaml-types.js";
import type { KilnAppConfig } from "../../src/config.js";
import { DomainRegistry } from "@kilnai/core";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

function writeKiln(dir: string, config: KilnYaml): void {
  mkdirSync(join(dir, ".kiln"), { recursive: true });
  writeFileSync(join(dir, ".kiln", "kiln.yaml"), `version: "1"\n${Object.entries(config)
    .filter(([k]) => k !== "version")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n`);
}

function readKiln(dir: string): KilnYaml {
  return parseYaml(readFileSync(join(dir, ".kiln", "kiln.yaml"), "utf-8")) as KilnYaml;
}

const DEFAULT_KILN: KilnYaml = {
  version: "1",
  domain: "generic",
  channels: ["cli", "web"],
  teamMode: "sequential",
  requireApproval: true,
  maxDepth: 3,
  parallelWorkers: 2,
  provider: "claude",
  mode: "api-key",
  permissions: { approval: "on-request", sandbox: "read-only" },
};

describe("configCommand", () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempDir, "xdg"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("show prints current config", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "show", [], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('"domain": "generic"');
    expect(output).toContain('"requireApproval": true');
    expect(output).toContain('"maxDepth": 3');
  });

  it("set updates a config value", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "set", ["provider", "openai"], tempDir);

    const config = readKiln(tempDir);
    expect(config.provider).toBe("openai");
  });

  it("set handles boolean values", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "set", ["requireApproval", "false"], tempDir);

    const config = readKiln(tempDir);
    expect(config.requireApproval).toBe(false);
  });

  it("set handles numeric values", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "set", ["maxDepth", "5"], tempDir);

    const config = readKiln(tempDir);
    expect(config.maxDepth).toBe(5);
  });

  it("errors when not initialized", async () => {
    await configCommand(MOCK_APP_CONFIG, "show", [], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Not initialized");
  });

  it("set updates permissions.approval", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "set", ["permissions.approval", "never"], tempDir);

    const config = readKiln(tempDir);
    expect(config.permissions?.approval).toBe("never");
  });

  it("set updates permissions.sandbox", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "set", ["permissions.sandbox", "danger-full-access"], tempDir);

    const config = readKiln(tempDir);
    expect(config.permissions?.sandbox).toBe("danger-full-access");
  });

  it("reset writes default kiln.yaml", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "reset", [], tempDir);

    const config = readKiln(tempDir);
    expect(config.domain).toBe("generic");
    expect(config.provider).toBe("claude");
    expect(config.permissions?.approval).toBe("on-request");
  });

  it("read projections prints canonical projection status", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "read", ["projections"], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("repo-shim:agents");
    expect(output).toContain("repo-shim:claude");
  });

  it("read setup prints cross-surface setup recommendations", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "read", ["setup"], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('"projectRoot"');
    expect(output).toContain('"repoShims"');
    expect(output).toContain('"recommendedActions"');
  });
});
