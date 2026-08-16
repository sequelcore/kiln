import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { configCommand } from "../../src/commands/config.js";
import type { ResolvedKilnConfig } from "../../src/kiln-yaml-types.js";
import type { KilnAppConfig } from "../../src/config.js";
import { DomainRegistry } from "@kilnai/core/domain";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

function writeKiln(dir: string, config: ResolvedKilnConfig): void {
  mkdirSync(join(dir, ".kiln"), { recursive: true });
  writeFileSync(join(dir, ".kiln", "kiln.yaml"), `version: "1"\n${Object.entries(config)
    .filter(([k]) => k !== "version")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n`);
}

function readKiln(dir: string): ResolvedKilnConfig {
  return parseYaml(readFileSync(join(dir, ".kiln", "kiln.yaml"), "utf-8")) as ResolvedKilnConfig;
}

const DEFAULT_KILN: ResolvedKilnConfig = {
  version: "1",
  domain: "generic",
  channels: ["cli", "web"],
  teamMode: "sequential",
  requireApproval: true,
  maxDepth: 3,
  parallelWorkers: 2,
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

  it("set updates an admitted project config value", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "set", ["domain", "backend"], tempDir);

    const config = readKiln(tempDir);
    expect(config.domain).toBe("backend");
  });

  it.each(["provider", "model", "mode"])("does not write global execution field %s into project config", async (field) => {
    writeKiln(tempDir, DEFAULT_KILN);
    const path = join(tempDir, ".kiln", "kiln.yaml");
    const before = readFileSync(path);

    await configCommand(MOCK_APP_CONFIG, "set", [field, "synthetic-value"], tempDir);

    expect(readFileSync(path)).toEqual(before);
    expect(consoleSpy.mock.calls.flat().join("\n")).toContain(`Unknown config key: ${field}`);
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

  it("sets global skill visibility and reviewed external catalog policy without hand editing", async () => {
    const globalDir = join(tempDir, "xdg", "kiln");
    const external = {
      version: 1,
      harnesses: { codex: { expectedFingerprint: `sha256:${"b".repeat(64)}`, keepImplicit: [{ sourceId: "plugin:docs:pdf:.", packageDigest: `sha256:${"a".repeat(64)}` }] } },
    };
    const builtin = { enabled: true, include: ["research-workflow", "orchestration-workflow"] };
    await configCommand(MOCK_APP_CONFIG, "set", ["--global", "skills.builtin", JSON.stringify(builtin)], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["--global", "skills.visibility.default", "explicit-only"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["--global", "skills.visibility.overrides", '{"pdf":"implicit"}'], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["--global", "skills.externalCatalog", JSON.stringify(external)], tempDir);

    const global = parseYaml(readFileSync(join(globalDir, "config.yaml"), "utf8")) as ResolvedKilnConfig;
    expect(global.skills).toMatchObject({
      builtin,
      visibility: { default: "explicit-only", overrides: { pdf: "implicit" } },
      externalCatalog: external,
    });
  });

  it("rejects global-only skill policy without --global and leaves project bytes unchanged", async () => {
    writeKiln(tempDir, DEFAULT_KILN);
    const path = join(tempDir, ".kiln", "kiln.yaml");
    const before = readFileSync(path);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit:1"); }) as never);
    try {
      await expect(configCommand(MOCK_APP_CONFIG, "set", ["skills.visibility.default", "disabled"], tempDir))
        .rejects.toThrow("exit:1");
    } finally {
      exitSpy.mockRestore();
    }
    expect(readFileSync(path)).toEqual(before);
  });

  it("set updates interactive-use policy", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.enabled", "true"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.browserProvider", "playwright"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.browserEnvironment", "isolated-headed"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.allowedDomains", "example.com, docs.example.com"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.allowExternalBrowser", "false"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.allowComputer", "true"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.computerProvider", "windows-uia"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.computerEnvironment", "local-active-desktop"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.allowedApplications", "Calculator, msedge"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.applicationAliases", "{\"Calculator\":[\"Calculadora\",\"CalculatorApp\"]}"], tempDir);

    const config = readKiln(tempDir);
    expect(config.interactiveUse?.enabled).toBe(true);
    expect(config.interactiveUse?.browserProvider).toBe("playwright");
    expect(config.interactiveUse?.browserEnvironment).toBe("isolated-headed");
    expect(config.interactiveUse?.allowedDomains).toEqual(["example.com", "docs.example.com"]);
    expect(config.interactiveUse?.allowExternalBrowser).toBe(false);
    expect(config.interactiveUse?.allowComputer).toBe(true);
    expect(config.interactiveUse?.computerProvider).toBe("windows-uia");
    expect(config.interactiveUse?.computerEnvironment).toBe("local-active-desktop");
    expect(config.interactiveUse?.allowedApplications).toEqual(["Calculator", "msedge"]);
    expect(config.interactiveUse?.applicationAliases).toEqual({
      Calculator: ["Calculadora", "CalculatorApp"],
    });
  });

  it("reset writes default kiln.yaml", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "reset", [], tempDir);

    const config = readKiln(tempDir);
    expect(config.domain).toBe("generic");
    expect(config).not.toHaveProperty("provider");
    expect(config).not.toHaveProperty("model");
    expect(config).not.toHaveProperty("mode");
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

  it("setup prints the canonical setup snapshot", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "setup", [], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('"projectRoot"');
    expect(output).toContain('"recommendedActions"');
  });

  it("setup executes an explicit setup action", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "setup", ["--action", "adopt-project-context"], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('"action": "adopt-project-context"');
    expect(output).toContain('"status": "applied"');
  });
});
