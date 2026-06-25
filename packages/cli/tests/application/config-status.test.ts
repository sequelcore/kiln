import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfigStatusSnapshot, readConfigStatusView } from "../../src/application/config-status.js";
import { writeRepoShimProjections } from "../../src/application/repo-shim-projection.js";

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

describe("config-status", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-status-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempDir, "xdg"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      name: "status-project",
      scripts: { test: "bun test" },
    }), "utf-8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("reads effective config and projection status from canonical sources", async () => {
    writeProjectConfig(tempDir);

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir, now: new Date("2026-05-07T12:00:00.000Z") });

    expect(snapshot.generatedAt).toBe("2026-05-07T12:00:00.000Z");
    expect(snapshot.project.projectName).toBe("status-project");
    expect(snapshot.project.kilnYaml.status).toBe("valid");
    expect(snapshot.global.status).toBe("missing");
    expect(snapshot.effectiveConfigStatus).toBe("valid");
    expect(snapshot.effectiveConfig?.provider).toBe("codex-oauth");
    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:agents", status: "missing" }),
      expect.objectContaining({ targetId: "repo-shim:claude", status: "missing" }),
    ]));
    expect(snapshot.setup).toMatchObject({
      projectRoot: tempDir,
      projectContext: {
        status: "missing",
        recommendation: "adopt-project-context",
      },
      repoShims: expect.arrayContaining([
        expect.objectContaining({
          target: "agents",
          targetId: "repo-shim:agents",
          status: "missing",
          recommendation: "sync-repo-shims",
        }),
      ]),
      recommendedActions: expect.arrayContaining([
        "adopt-project-context",
        "sync-repo-shims",
      ]),
    });
  });

  it("marks generated repo shims as current", async () => {
    writeProjectConfig(tempDir);
    await writeRepoShimProjections(tempDir);

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:agents", status: "current" }),
      expect.objectContaining({ targetId: "repo-shim:claude", status: "current" }),
      expect.objectContaining({
        targetId: "workflow-snapshot:manifest",
        kind: "workflow-snapshot",
        status: "current",
      }),
    ]));
    expect(snapshot.setup.repoShims).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "repo-shim:agents", status: "current", recommendation: "none" }),
      expect.objectContaining({ targetId: "repo-shim:claude", status: "current", recommendation: "none" }),
    ]));
  });

  it("reports workflow snapshot manifest drift without mutating canonical state", async () => {
    writeProjectConfig(tempDir);
    await writeRepoShimProjections(tempDir);
    const manifestPath = join(tempDir, ".kiln", "projections", "workflow-snapshot-manifest.json");
    const originalManifest = readFileSync(manifestPath, "utf-8");
    const staleManifest = JSON.stringify({
      ...JSON.parse(originalManifest),
      hash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    }, null, 2);
    writeFileSync(manifestPath, `${staleManifest}\n`, "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "workflow-snapshot:manifest",
        kind: "workflow-snapshot",
        status: "stale",
        details: expect.stringContaining("expected sha256:"),
      }),
    ]));
    expect(readFileSync(manifestPath, "utf-8")).toBe(`${staleManifest}\n`);
  });

  it("returns bounded read views", async () => {
    writeProjectConfig(tempDir);
    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    const permissions = await readConfigStatusView(snapshot, "permissions");
    const health = await readConfigStatusView(snapshot, "health");
    const setup = await readConfigStatusView(snapshot, "setup");

    expect(permissions.value).toEqual({ approval: "on-request", sandbox: "read-only" });
    expect(JSON.stringify(health.value)).toContain("harnessCapabilities");
    expect(setup.value).toEqual(snapshot.setup);
  });

  it("reports only the global CLI memory path", async () => {
    writeProjectConfig(tempDir);

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });
    const memory = await readConfigStatusView(snapshot, "memory");

    expect(memory.value).toMatchObject({
      permissions: null,
      memoryDbPresent: expect.any(Boolean),
    });
    expect(JSON.stringify(memory.value)).toContain("memory.db");
    expect((memory.value as { memoryDbPath: string }).memoryDbPath).not.toBe(join(tempDir, ".kiln", "memory.db"));
    expect(JSON.stringify(memory.value)).not.toContain("legacy");
    expect(JSON.stringify(memory.value)).not.toContain("migration");
  });

  it("reports invalid project context without blocking effective config", async () => {
    writeProjectConfig(tempDir);
    writeFileSync(join(tempDir, ".kiln", "project-context.md"), "# invalid", "utf-8");

    const snapshot = await readConfigStatusSnapshot({ projectPath: tempDir });

    expect(snapshot.project.projectContext.status).toBe("invalid");
    expect(snapshot.effectiveConfigStatus).toBe("valid");
    expect(snapshot.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("project context"),
    ]));
    expect(readFileSync(join(tempDir, ".kiln", "project-context.md"), "utf-8")).toBe("# invalid");
  });
});
