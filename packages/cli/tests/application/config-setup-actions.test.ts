import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeConfigSetupAction } from "../../src/application/config-setup-actions.js";

let tempDir: string;

function writeProjectConfig(projectPath: string): void {
  mkdirSync(join(projectPath, ".kiln"), { recursive: true });
  writeFileSync(join(projectPath, ".kiln", "kiln.yaml"), [
    'version: "1"',
    "provider: codex-oauth",
    "model:",
    "  default: gpt-5.4-mini",
    "permissions:",
    "  approval: on-request",
    "  sandbox: read-only",
    "",
  ].join("\n"), "utf-8");
}

describe("config setup actions", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-setup-actions-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempDir, "xdg"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      name: "setup-actions-project",
      scripts: { test: "bun test" },
    }), "utf-8");
    writeProjectConfig(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("adopts missing project context and returns a refreshed setup snapshot", async () => {
    const result = await executeConfigSetupAction({
      projectPath: tempDir,
      action: "adopt-project-context",
    });

    expect(result.status).toBe("applied");
    expect(result.message).toContain("Project context");
    expect(existsSync(join(tempDir, ".kiln", "project-context.md"))).toBe(true);
    expect(result.setup.projectContext.status).toBe("valid");
  });

  it("syncs repo shims without using force overrides", async () => {
    const result = await executeConfigSetupAction({
      projectPath: tempDir,
      action: "sync-repo-shims",
    });

    expect(result.status).toBe("applied");
    expect(result.errors).toEqual([]);
    expect(result.setup.repoShims).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:agents", status: "current" }),
      expect.objectContaining({ targetId: "repo-shim:claude", status: "current" }),
    ]));
  });

  it("installs the control-plane MCP globally while keeping project MCP projection project-specific", async () => {
    const userHome = join(tempDir, "home");
    const result = await executeConfigSetupAction({
      projectPath: tempDir,
      action: "sync-native-projections",
      userHome,
    });

    expect(result.status).toBe("applied");
    const claudeGlobal = JSON.parse(readFileSync(join(userHome, ".claude.json"), "utf8"));
    expect(claudeGlobal.mcpServers["kiln-control-plane"]).toEqual({
      type: "stdio",
      command: process.execPath,
      args: [process.argv[1], "native-harness", "control-plane-mcp", "--harness", "claude"],
    });
    expect(existsSync(join(tempDir, ".mcp.json"))).toBe(false);
  });

  it("blocks review-only actions instead of mutating drifted state", async () => {
    const result = await executeConfigSetupAction({
      projectPath: tempDir,
      action: "review-native-projection-drift",
    });

    expect(result.status).toBe("blocked");
    expect(result.message.toLowerCase()).toContain("review");
    expect(result.setup.projectRoot).toBe(tempDir);
  });

  it("adopts unmanaged native skills into the governed user registry", async () => {
    const userHome = join(tempDir, "home");
    const nativeSkillDir = join(userHome, ".codex", "skills", "shadcn");
    mkdirSync(nativeSkillDir, { recursive: true });
    writeFileSync(join(nativeSkillDir, "SKILL.md"), [
      "---",
      "name: shadcn",
      "description: Build shadcn interfaces.",
      "---",
      "",
      "Use shadcn/ui project conventions.",
      "",
    ].join("\n"), "utf-8");

    const result = await executeConfigSetupAction({
      projectPath: tempDir,
      action: "adopt-or-back-up-native-guidance",
      userHome,
    });

    const adoptedPath = join(userHome, ".kiln", "skills", "shadcn", "SKILL.md");
    expect(result.status).toBe("applied");
    expect(readFileSync(adoptedPath, "utf-8")).toContain("name: shadcn");
    expect(result.errors).toEqual([]);
    expect(result.setup.skills?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "shadcn",
        origin: "user",
        configured: true,
        admission: expect.objectContaining({ state: "available" }),
      }),
    ]));
  });

  it("does not partially adopt when native harness copies conflict", async () => {
    const userHome = join(tempDir, "home");
    const codexRoot = join(userHome, ".codex", "skills");
    const claudeRoot = join(userHome, ".claude", "skills");
    mkdirSync(join(codexRoot, "shared"), { recursive: true });
    mkdirSync(join(claudeRoot, "shared"), { recursive: true });
    mkdirSync(join(codexRoot, "unique"), { recursive: true });
    writeFileSync(join(codexRoot, "shared", "SKILL.md"), "---\nname: shared\ndescription: Codex copy.\n---\n", "utf-8");
    writeFileSync(join(claudeRoot, "shared", "SKILL.md"), "---\nname: shared\ndescription: Claude copy.\n---\n", "utf-8");
    writeFileSync(join(codexRoot, "unique", "SKILL.md"), "---\nname: unique\ndescription: Unique skill.\n---\n", "utf-8");

    const result = await executeConfigSetupAction({
      projectPath: tempDir,
      action: "adopt-or-back-up-native-guidance",
      userHome,
    });

    expect(result.status).toBe("blocked");
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('native skill "shared" has conflicting content'),
    ]));
    expect(existsSync(join(userHome, ".kiln", "skills", "unique"))).toBe(false);
  });

  it("rejects native skill names that could escape the governed registry", async () => {
    const userHome = join(tempDir, "home");
    const nativeSkillDir = join(userHome, ".codex", "skills", "malicious");
    mkdirSync(nativeSkillDir, { recursive: true });
    writeFileSync(join(nativeSkillDir, "SKILL.md"), [
      "---",
      'name: "../../outside"',
      "description: Invalid path.",
      "---",
      "",
    ].join("\n"), "utf-8");

    const result = await executeConfigSetupAction({
      projectPath: tempDir,
      action: "adopt-or-back-up-native-guidance",
      userHome,
    });

    expect(result.status).toBe("noop");
    expect(existsSync(join(userHome, "outside"))).toBe(false);
  });
});
