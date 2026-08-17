import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { initCommand } from "../../src/commands/init.js";
import type { ResolvedKilnConfig } from "../../src/kiln-yaml-types.js";
import type { KilnAppConfig } from "../../src/config.js";
import { DomainRegistry } from "@kilnai/core/domain";

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
};

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

  it("creates kiln.yaml with correct fields", async () => {
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);

    expect(config).not.toBeNull();
    expect(config!.version).toBe("1");
    expect(config!.requireApproval).toBe(true);
    expect(config!.maxDepth).toBe(3);
    expect(config!.parallelWorkers).toBe(2);
    expect(config).not.toHaveProperty("provider");
    expect(config).not.toHaveProperty("model");
    expect(config).not.toHaveProperty("mode");
    expect(config!.permissions?.approval).toBe("on-request");
    expect(config!.permissions?.sandbox).toBe("read-only");

    const onDisk = parseYaml(
      readFileSync(join(tempDir, ".kiln", "kiln.yaml"), "utf-8"),
    ) as ResolvedKilnConfig;
    expect(onDisk.version).toBe("1");
    expect(onDisk.requireApproval).toBe(true);
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
    expect(second!.version).toBe("1");
  });

  it("does not add ignored project-local memory database entries", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);

    expect(existsSync(join(tempDir, ".gitignore"))).toBe(false);
  });

  it("does not create .gitignore on re-init just for memory database entries", async () => {
    await initCommand(MOCK_APP_CONFIG, tempDir, NON_INTERACTIVE);
    await initCommand(MOCK_APP_CONFIG, tempDir, { force: true, interactive: false });

    expect(existsSync(join(tempDir, ".gitignore"))).toBe(false);
  });

  it("non-interactive init with --domain flag uses specified domain", async () => {
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, {
      interactive: false,
      domain: "generic",
    });
    expect(config).not.toBeNull();
    expect(config!.domain).toBe("generic");
  });

  it("uses --provider only for the generated app gateway, not project config", async () => {
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, {
      interactive: false,
      provider: "openai",
    });
    expect(config).not.toBeNull();
    expect(config).not.toHaveProperty("provider");
    expect(readFileSync(join(tempDir, ".kiln", "gateway.yaml"), "utf8")).toContain("name: openai");
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
    const config = await initCommand(MOCK_APP_CONFIG, tempDir, { force: false });
    expect(config).not.toBeNull();
  });
});
