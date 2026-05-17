import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("blocks review-only actions instead of mutating drifted state", async () => {
    const result = await executeConfigSetupAction({
      projectPath: tempDir,
      action: "review-native-projection-drift",
    });

    expect(result.status).toBe("blocked");
    expect(result.message.toLowerCase()).toContain("review");
    expect(result.setup.projectRoot).toBe(tempDir);
  });
});
