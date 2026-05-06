import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { syncNativeHookProjections } from "../../src/config/native-hook-projection.js";

const testDir = join(os.tmpdir(), "kiln-hook-test-" + Date.now());
const projectPath = testDir;
const kilnDir = join(testDir, ".kiln");

describe("syncNativeHookProjections", () => {
  beforeAll(() => {
    fs.mkdirSync(join(kilnDir, "hooks"), { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("succeeds and creates default hook content", async () => {
    const result = await syncNativeHookProjections(projectPath, kilnDir);

    expect(result.claudeHook).toBe(true);
    expect(result.errors).toHaveLength(0);

    const hookPath = join(kilnDir, "hooks", "autoformat.sh");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("Kiln autoformat hook");
  });

  it("uses existing hook content", async () => {
    const customContent = "#!/bin/sh\necho 'custom hook'\n";
    const sourcePath = join(kilnDir, "hooks", "autoformat.sh");
    fs.writeFileSync(sourcePath, customContent, "utf-8");

    const result = await syncNativeHookProjections(projectPath, kilnDir);

    expect(result.claudeHook).toBe(true);

    const destPath = join(projectPath, ".claude", "hooks", "autoformat.sh");
    expect(fs.existsSync(destPath)).toBe(true);
    const content = fs.readFileSync(destPath, "utf-8");
    expect(content).toBe(customContent);
  });

  it("registers hook in settings.json", async () => {
    await syncNativeHookProjections(projectPath, kilnDir);

    const settingsPath = join(projectPath, ".claude", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const content = fs.readFileSync(settingsPath, "utf-8");
    expect(content).toContain("hooks");
    expect(content).toContain("autoformat");
  });

  it("merges with existing settings.json", async () => {
    const settingsPath = join(projectPath, ".claude", "settings.json");
    fs.mkdirSync(join(projectPath, ".claude"), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: { kiln: {} } }), "utf-8");

    await syncNativeHookProjections(projectPath, kilnDir);

    const content = fs.readFileSync(settingsPath, "utf-8");
    expect(content).toContain("mcpServers");
    expect(content).toContain("hooks");
  });

  it("creates .claude/hooks directory if needed", async () => {
    await syncNativeHookProjections(projectPath, kilnDir);

    const hooksDir = join(projectPath, ".claude", "hooks");
    expect(fs.existsSync(hooksDir)).toBe(true);
  });
});
