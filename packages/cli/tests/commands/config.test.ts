import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml, stringify } from "yaml";
import { configCommand } from "../../src/commands/config.js";
import type { ResolvedKilnConfig } from "../../src/kiln-yaml-types.js";
import type { KilnAppConfig } from "../../src/config.js";
import { defaultGlobalConfig } from "../../src/config/global-config.js";
import { DomainRegistry } from "@kilnai/core/domain";

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
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

function seedProjectConfig(dir: string): void {
  writeKiln(dir, DEFAULT_KILN);
}

function seedGlobalConfig(globalHome: string): void {
  mkdirSync(join(globalHome, "kiln"), { recursive: true });
  writeFileSync(join(globalHome, "kiln", "config.yaml"), stringify(defaultGlobalConfig()), "utf-8");
}

describe("configCommand", () => {
  let tempDir: string;
  let globalHome: string;
  let previousXdgConfigHome: string | undefined;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-config-home-"));
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("show prints the secret-free effective configuration projection", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "show", [], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain('"identity": "/domain"');
    expect(output).toContain('"value": "generic"');
    expect(output).toContain('"source": "project"');
    expect(output).toContain('"schemaRevision": 1');
  });

  it("explain prints the same effective field with provenance", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "explain", ["permissions"], tempDir);

    const output = consoleSpy.mock.calls.map((call: unknown[]) => call[0]).join("\n");
    expect(output).toContain('"identity": "/permissions"');
    expect(output).toContain('"overrideChain"');
    expect(output).toContain('"source": "project"');
    expect(output).toContain('"sandbox": "read-only"');
  });

  it("set updates an admitted project config value", async () => {
    seedProjectConfig(tempDir);

    await configCommand(MOCK_APP_CONFIG, "set", ["domain", "backend"], tempDir);

    const config = readKiln(tempDir);
    expect(config.domain).toBe("backend");
  });

  it.each(["provider", "model", "mode"])("does not write global execution field %s into project config", async (field) => {
    seedProjectConfig(tempDir);
    const path = join(tempDir, ".kiln", "kiln.yaml");
    const before = readFileSync(path);

    await configCommand(MOCK_APP_CONFIG, "set", [field, "synthetic-value"], tempDir);

    expect(readFileSync(path)).toEqual(before);
    expect(consoleErrorSpy.mock.calls.flat().join("\n")).toContain(`Unknown configuration key: ${field}`);
  });

  it("set handles boolean values", async () => {
    seedProjectConfig(tempDir);

    await configCommand(MOCK_APP_CONFIG, "set", ["requireApproval", "false", "--approve"], tempDir);

    const config = readKiln(tempDir);
    expect(config.requireApproval).toBe(false);
  });

  it("set handles numeric values", async () => {
    seedProjectConfig(tempDir);

    await configCommand(MOCK_APP_CONFIG, "set", ["maxDepth", "5", "--approve"], tempDir);

    const config = readKiln(tempDir);
    expect(config.maxDepth).toBe(5);
  });

  it("errors when not initialized", async () => {
    await configCommand(MOCK_APP_CONFIG, "show", [], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Not initialized");
  });

  it("set updates permissions.approval", async () => {
    seedProjectConfig(tempDir);

    await configCommand(MOCK_APP_CONFIG, "set", ["permissions.approval", "never", "--approve"], tempDir);

    const config = readKiln(tempDir);
    expect(config.permissions?.approval).toBe("never");
  });

  it("set updates permissions.sandbox", async () => {
    seedProjectConfig(tempDir);

    await configCommand(MOCK_APP_CONFIG, "set", ["permissions.sandbox", "danger-full-access", "--approve"], tempDir);

    const config = readKiln(tempDir);
    expect(config.permissions?.sandbox).toBe("danger-full-access");
  });

  it("sets global skill visibility and reviewed external catalog policy without hand editing", async () => {
    seedGlobalConfig(globalHome);
    const globalDir = join(globalHome, "kiln");
    const external = {
      version: 1,
      harnesses: { codex: { expectedFingerprint: `sha256:${"b".repeat(64)}`, keepImplicit: [{ sourceId: "plugin:docs:pdf:.", packageDigest: `sha256:${"a".repeat(64)}` }] } },
    };
    const builtin = { enabled: true, include: ["research-workflow", "orchestration-workflow"] };
    await configCommand(MOCK_APP_CONFIG, "set", ["--global", "skills.builtin", JSON.stringify(builtin), "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["--global", "skills.visibility.default", "explicit-only", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["--global", "skills.visibility.overrides", '{"pdf":"implicit"}', "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["--global", "skills.externalCatalog", JSON.stringify(external), "--approve"], tempDir);

    const global = parseYaml(readFileSync(join(globalDir, "config.yaml"), "utf8")) as ResolvedKilnConfig;
    expect(global.skills).toMatchObject({
      builtin,
      visibility: { default: "explicit-only", overrides: { pdf: "implicit" } },
      externalCatalog: external,
    });
  });

  it("rejects global-only skill policy without --global and leaves project bytes unchanged", async () => {
    seedProjectConfig(tempDir);
    const path = join(tempDir, ".kiln", "kiln.yaml");
    const before = readFileSync(path);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await configCommand(MOCK_APP_CONFIG, "set", ["skills.visibility.default", "disabled", "--approve"], tempDir);
      expect(process.exitCode).toBe(1);
      expect(consoleErrorSpy.mock.calls.flat().join("\n")).toContain(
        "error: scope: skills.visibility.default cannot be set in the project scope.",
      );
    } finally {
      process.exitCode = previousExitCode;
    }
    expect(readFileSync(path)).toEqual(before);
  });

  it("set updates interactive-use policy", async () => {
    seedProjectConfig(tempDir);

    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.enabled", "true", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.browserProvider", "playwright", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.browserEnvironment", "isolated-headed", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.allowedDomains", "example.com, docs.example.com", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.allowExternalBrowser", "false", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.allowComputer", "true", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.computerProvider", "windows-uia", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.computerEnvironment", "local-active-desktop", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.allowedApplications", "Calculator, msedge", "--approve"], tempDir);
    await configCommand(MOCK_APP_CONFIG, "set", ["interactiveUse.applicationAliases", "{\"Calculator\":[\"Calculadora\",\"CalculatorApp\"]}", "--approve"], tempDir);

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

  it("reset removes one keyed override and preserves unrelated settings", async () => {
    seedProjectConfig(tempDir);

    await configCommand(MOCK_APP_CONFIG, "reset", ["domain", "--approve"], tempDir);

    const config = readKiln(tempDir);
    expect(config).not.toHaveProperty("domain");
    expect(config.teamMode).toBe("sequential");
    expect(config.maxDepth).toBe(3);
    expect(config.permissions?.approval).toBe("on-request");
    expect(consoleSpy.mock.calls.flat().join("\n")).toContain("next session boundary");
  });

  it("settings prints all sections and supports the client-side modified filter", async () => {
    seedProjectConfig(tempDir);

    await configCommand(MOCK_APP_CONFIG, "settings", ["--modified"], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    const value = JSON.parse(output) as { sections: readonly { id: string }[]; entries: readonly { key: string; modified: boolean }[] };
    expect(value.sections.map((section) => section.id)).toEqual([
      "general", "providers", "models", "permissions", "tools", "usage-and-limits", "agents", "health", "advanced",
    ]);
    expect(value.entries.length).toBeGreaterThan(0);
    expect(value.entries.every((entry) => entry.modified)).toBe(true);
  });

  it("read projections prints canonical projection status", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "read", ["projections"], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("repo-shim:agents");
    expect(output).toContain("repo-shim:claude");
  });

  it("read setup prints cross-surface setup recommendations", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "read", ["setup"], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain('"projectRoot"');
    expect(output).toContain('"repoShims"');
    expect(output).toContain('"recommendedActions"');
  });

  it("setup prints the canonical setup snapshot", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "setup", [], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain('"projectRoot"');
    expect(output).toContain('"recommendedActions"');
  });

  it("setup executes an explicit setup action", async () => {
    writeKiln(tempDir, DEFAULT_KILN);

    await configCommand(MOCK_APP_CONFIG, "setup", ["--action", "adopt-project-context"], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain('"action": "adopt-project-context"');
    expect(output).toContain('"status": "applied"');
  });
});
