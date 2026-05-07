import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { statusCommand } from "../../src/commands/status.js";
import { writeKilnYaml, defaultKilnYaml } from "../../src/kiln-yaml.js";
import { writeGlobalConfig } from "../../src/config/global-config.js";
import type { KilnAppConfig } from "../../src/config.js";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => {
    throw new Error("createRegistry not called in status tests");
  },
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

describe("statusCommand", () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let tempDir: string;
  let tempConfigHome: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-status-"));
    tempConfigHome = mkdtempSync(join(tmpdir(), "kiln-status-config-"));
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(tempConfigHome, { recursive: true, force: true });
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    consoleSpy.mockRestore();
  });

  it("prints error when not initialized", async () => {
    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Not initialized");
    expect(output).toContain("kiln init");
  });

  it("prints domain when initialized", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, defaultKilnYaml("python"));

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("python");
  });

  it("shows all config values", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, {
      version: "1",
      domain: "react-typescript",
      channels: ["cli", "web"],
      teamMode: "sequential",
      requireApproval: false,
      maxDepth: 5,
      parallelWorkers: 4,
      provider: "openai",
      mode: "api-key",
    });

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("react-typescript");
    expect(output).toContain("false");
    expect(output).toContain("5");
    expect(output).toContain("4");
    expect(output).toContain("openai");
    expect(output).toContain("api-key");
  });

  it("shows memory file count", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(join(kilnDir, "memory"), { recursive: true });
    writeKilnYaml(kilnDir, { ...defaultKilnYaml("python") });
    writeFileSync(join(kilnDir, "memory", "chunk1.jsonl"), "{}");
    writeFileSync(join(kilnDir, "memory", "chunk2.jsonl"), "{}");

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Memory files:     2");
  });

  it("shows managed-agent route health", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, {
      ...defaultKilnYaml("python"),
      managedAgents: {
        enabled: true,
        defaultProvider: "codex",
        defaultProfile: "foundation-readonly-plan",
        requireApproval: true,
        routes: [{
          id: "codex-readonly",
          kind: "harness",
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          profiles: ["foundation-readonly-plan"],
        }],
      },
    });

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Managed agent routes:");
    expect(output).toContain("codex-readonly");
    expect(output).toContain("harness/codex gpt-5.3-codex-spark");
    expect(output).toContain("available");
  });

  it("shows configured engine route health", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, { ...defaultKilnYaml("python") });
    writeGlobalConfig({
      version: "1",
      engines: {
        codex: { enabled: true, billing: "plus-quota" },
        opencode: { enabled: true, billing: "free" },
      },
      routing: {
        defaultWorker: "codex",
        fallback: "opencode",
        budgetAware: true,
        budget: {
          codex: { dailyTokenCeiling: 100 },
        },
      },
    });

    await statusCommand(MOCK_APP_CONFIG, tempDir, {
      engineRegistry: {
        probeAll: () => [
          { engineId: "codex", enabled: true, available: false, reason: "not found" },
          { engineId: "opencode", enabled: true, available: true },
        ],
      },
      getDailyTokensUsed: (engineId) => engineId === "codex" ? 125 : 0,
    });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Engine routes:");
    expect(output).toContain("codex");
    expect(output).toContain("unavailable - not found");
    expect(output).toContain("opencode");
    expect(output).toContain("Resolved worker: opencode");
    expect(output).toContain("Managed agent routes:");
    expect(output).toContain("codex-readonly");
    expect(output).toContain("unavailable - Provider 'codex' is unavailable.");
  });

  it("shows managed-agent routes synthesized from enabled global engines", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, { ...defaultKilnYaml("python") });
    writeGlobalConfig({
      version: "1",
      engines: {
        claude: { enabled: true, billing: "subscription" },
        codex: { enabled: true, billing: "plus-quota" },
      },
      routing: {
        defaultWorker: "claude",
      },
      models: {
        codex: "gpt-5.4-mini",
      },
    });

    await statusCommand(MOCK_APP_CONFIG, tempDir, {
      engineRegistry: {
        probeAll: () => [
          { engineId: "claude", enabled: true, available: true },
          { engineId: "codex", enabled: true, available: true },
        ],
      },
    });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Managed agent routes:");
    expect(output).toContain("codex-readonly");
    expect(output).toContain("harness/codex gpt-5.4-mini");
  });
});
