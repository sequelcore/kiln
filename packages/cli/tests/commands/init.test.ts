import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

describe("initCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-init-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates .kiln/ directory", () => {
    initCommand(MOCK_APP_CONFIG, tempDir);
    expect(existsSync(join(tempDir, ".kiln"))).toBe(true);
  });

  it("creates config.json with detected domain", () => {
    const config = initCommand(MOCK_APP_CONFIG, tempDir);

    expect(config).not.toBeNull();
    expect(config!.domain).toBeTruthy();
    expect(config!.requireApproval).toBe(true);
    expect(config!.maxDepth).toBe(3);
    expect(config!.parallelWorkers).toBe(2);
    expect(config!.provider).toBe("claude");
    expect(config!.mode).toBe("api-key");

    const onDisk = JSON.parse(
      readFileSync(join(tempDir, ".kiln", "config.json"), "utf-8"),
    ) as ProjectConfig;
    expect(onDisk.domain).toBe(config!.domain);
  });

  it("creates memory/ subdirectory", () => {
    initCommand(MOCK_APP_CONFIG, tempDir);
    expect(existsSync(join(tempDir, ".kiln", "memory"))).toBe(true);
  });

  it("skips if already initialized (no force)", () => {
    const first = initCommand(MOCK_APP_CONFIG, tempDir);
    expect(first).not.toBeNull();

    const second = initCommand(MOCK_APP_CONFIG, tempDir);
    expect(second).toBeNull();
  });

  it("re-initializes with --force flag", () => {
    const first = initCommand(MOCK_APP_CONFIG, tempDir);
    expect(first).not.toBeNull();

    const second = initCommand(MOCK_APP_CONFIG, tempDir, { force: true });
    expect(second).not.toBeNull();
    expect(second!.domain).toBeTruthy();
  });

  it("appends to .gitignore", () => {
    initCommand(MOCK_APP_CONFIG, tempDir);

    const gitignore = readFileSync(join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".kiln/memory.db");
    expect(gitignore).toContain(".kiln/agents/");
  });

  it("does not duplicate .gitignore entries on re-init", () => {
    initCommand(MOCK_APP_CONFIG, tempDir);
    initCommand(MOCK_APP_CONFIG, tempDir, { force: true });

    const gitignore = readFileSync(join(tempDir, ".gitignore"), "utf-8");
    const memoryDbCount = gitignore.split(".kiln/memory.db").length - 1;
    expect(memoryDbCount).toBe(1);
  });
});
