import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { syncNativeHookProjections } from "../../src/config/native-hook-projection.js";

const testDir = join(tmpdir(), "kiln-hook-test-" + Date.now());
const projectPath = testDir;
const kilnDir = join(testDir, ".kiln");

describe("syncNativeHookProjections", () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(kilnDir, "hooks"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("succeeds and creates default hook content", async () => {
    const result = await syncNativeHookProjections(projectPath, kilnDir);

    expect(result.claudeHook).toBe(true);
    expect(result.errors).toHaveLength(0);

    const hookPath = join(kilnDir, "hooks", "autoformat.sh");
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("Kiln autoformat hook");
  });

  it("uses existing hook content", async () => {
    const customContent = "#!/bin/sh\necho 'custom hook'\n";
    const sourcePath = join(kilnDir, "hooks", "autoformat.sh");
    writeFileSync(sourcePath, customContent, "utf-8");

    const result = await syncNativeHookProjections(projectPath, kilnDir);

    expect(result.claudeHook).toBe(true);

    const destPath = join(projectPath, ".claude", "hooks", "autoformat.sh");
    expect(existsSync(destPath)).toBe(true);
    const content = readFileSync(destPath, "utf-8");
    expect(content).toBe(customContent);
  });

  it("registers hook in settings.json", async () => {
    await syncNativeHookProjections(projectPath, kilnDir);

    const settingsPath = join(projectPath, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const content = readFileSync(settingsPath, "utf-8");
    expect(content).toContain("hooks");
    expect(content).toContain("autoformat");
  });

  it("merges with existing settings.json", async () => {
    const settingsPath = join(projectPath, ".claude", "settings.json");
    mkdirSync(join(projectPath, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ mcpServers: { kiln: {} } }), "utf-8");

    await syncNativeHookProjections(projectPath, kilnDir);

    const content = readFileSync(settingsPath, "utf-8");
    expect(content).toContain("mcpServers");
    expect(content).toContain("hooks");
  });

  it("creates .claude/hooks directory if needed", async () => {
    await syncNativeHookProjections(projectPath, kilnDir);

    const hooksDir = join(projectPath, ".claude", "hooks");
    expect(existsSync(hooksDir)).toBe(true);
  });

  it("records install state and aborts the drifted hook file target only", async () => {
    const isolated = mkdtempSync(join(tmpdir(), "kiln-hook-drift-"));
    const isolatedKilnDir = join(isolated, ".kiln");
    try {
      const first = await syncNativeHookProjections(isolated, isolatedKilnDir);
      expect(first.errors).toHaveLength(0);

      const hookPath = join(isolated, ".claude", "hooks", "autoformat.sh");
      writeFileSync(hookPath, "#!/bin/sh\necho user drift\n", "utf-8");

      const second = await syncNativeHookProjections(isolated, isolatedKilnDir);

      expect(second.claudeHook).toBe(false);
      expect(second.errors).toEqual([
        "Claude Code: managed file drift detected: $file",
      ]);
      expect(readFileSync(hookPath, "utf-8")).toContain("user drift");

      const settings = JSON.parse(
        readFileSync(join(isolated, ".claude", "settings.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(settings.hooks).toBeDefined();

      const state = JSON.parse(
        readFileSync(join(isolatedKilnDir, "install-state.json"), "utf-8"),
      ) as { targets: Record<string, unknown> };
      const expectedTargets = [
        "claude-autoformat-hook",
        "claude-hook-settings",
        ...(process.platform === "win32" ? [] : ["codex-autoformat-hook"]),
      ];
      expect(Object.keys(state.targets).sort()).toEqual(expectedTargets.sort());
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it("force overwrites drifted managed hook files", async () => {
    const isolated = mkdtempSync(join(tmpdir(), "kiln-hook-force-"));
    const isolatedKilnDir = join(isolated, ".kiln");
    try {
      await syncNativeHookProjections(isolated, isolatedKilnDir);
      const hookPath = join(isolated, ".claude", "hooks", "autoformat.sh");
      writeFileSync(hookPath, "#!/bin/sh\necho user drift\n", "utf-8");

      const result = await syncNativeHookProjections(isolated, isolatedKilnDir, { force: true });

      expect(result.errors).toHaveLength(0);
      expect(result.claudeHook).toBe(true);
      expect(readFileSync(hookPath, "utf-8")).toContain("Kiln autoformat hook");
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
