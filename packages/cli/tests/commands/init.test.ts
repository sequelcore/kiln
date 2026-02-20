import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { initCommand } from "../../src/commands/init.js";
import type { ProjectConfig } from "../../src/commands/init.js";
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

// Non-interactive flags to avoid TTY prompts in tests
const NON_INTERACTIVE = { interactive: false };

describe("initCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-init-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates .kiln/ directory", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    expect(existsSync(join(tempDir, ".kiln"))).toBe(true);
  });

  it("creates config.json with detected domain", async () => {
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);

    expect(config).not.toBeNull();
    expect(config!.domain).toBeTruthy();
    expect(config!.requireApproval).toBe(true);
    expect(config!.maxDepth).toBe(3);
    expect(config!.parallelWorkers).toBe(2);
    expect(config!.provider).toBe("anthropic");
    expect(config!.mode).toBe("api-key");

    const onDisk = JSON.parse(
      readFileSync(join(tempDir, ".kiln", "config.json"), "utf-8"),
    ) as ProjectConfig;
    expect(onDisk.domain).toBe(config!.domain);
  });

  it("creates memory/ subdirectory", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    expect(existsSync(join(tempDir, ".kiln", "memory"))).toBe(true);
  });

  it("skips if already initialized (no force)", async () => {
    const first = await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    expect(first).not.toBeNull();

    const second = await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    expect(second).toBeNull();
  });

  it("re-initializes with --force flag", async () => {
    const first = await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    expect(first).not.toBeNull();

    const second = await initCommand(MOCK_APP_CONFIG, tempDir, { force: true, interactive: false });
    expect(second).not.toBeNull();
    expect(second!.domain).toBeTruthy();
  });

  it("appends to .gitignore", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);

    const gitignore = readFileSync(join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".kiln/memory.db");
    expect(gitignore).toContain(".kiln/agents/");
  });

  it("does not duplicate .gitignore entries on re-init", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    await initCommand(MOCK_APP_CONFIG, tempDir, { force: true, interactive: false });

    const gitignore = readFileSync(join(tempDir, ".gitignore"), "utf-8");
    const memoryDbCount = gitignore.split(".kiln/memory.db").length - 1;
    expect(memoryDbCount).toBe(1);
  });

  it("non-interactive init with --domain flag uses specified domain", async () => {
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, {
      interactive: false,
      domain: "generic",
    });
    expect(config).not.toBeNull();
    expect(config!.domain).toBe("generic");
  });

  it("non-interactive init with --provider flag uses specified provider", async () => {
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, {
      interactive: false,
      provider: "openai",
    });
    expect(config).not.toBeNull();
    expect(config!.provider).toBe("openai");
  });

  it("non-interactive init with --channels flag uses specified channels", async () => {
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, {
      interactive: false,
      channels: "cli,api",
    });
    expect(config).not.toBeNull();
    expect(config!.channels).toEqual(["cli", "api"]);
  });

  it("non-interactive init with --team-mode flag uses specified team mode", async () => {
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, {
      interactive: false,
      teamMode: "supervisor",
    });
    expect(config).not.toBeNull();
    expect(config!.teamMode).toBe("supervisor");
  });

  it("non-interactive init generates app.yaml file", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    expect(existsSync(join(tempDir, ".kiln", "app.yaml"))).toBe(true);
  });

  it("non-interactive init generates gateway.yaml file", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    expect(existsSync(join(tempDir, ".kiln", "gateway.yaml"))).toBe(true);
  });

  it("generated app.yaml is valid YAML", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    const content = readFileSync(join(tempDir, ".kiln", "app.yaml"), "utf-8");
    expect(() => parseYaml(content)).not.toThrow();
  });

  it("generated gateway.yaml is valid YAML", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    const content = readFileSync(join(tempDir, ".kiln", "gateway.yaml"), "utf-8");
    expect(() => parseYaml(content)).not.toThrow();
  });

  it("TTY detection: interactive is false when process.stdin.isTTY is undefined", async () => {
    // In test environments, isTTY is undefined (not a TTY)
    // initCommand should not hang waiting for input when non-interactive
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, { force: false });
    // Should complete without prompting (isTTY is falsy in test env)
    expect(config).not.toBeNull();
  });
});
