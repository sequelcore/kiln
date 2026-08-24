import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  listGlobalInstructionShimTargets,
  readGlobalInstructionShimProjectionSnapshots as readGlobalInstructionShimProjectionSnapshotsRaw,
  syncGlobalInstructionShimProjections as syncGlobalInstructionShimProjectionsRaw,
  type GlobalInstructionShimProjectionOptions,
} from "../../src/application/global-instruction-shim-projection.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import {
  readNativeProjectionInstallState,
  resolveGlobalNativeProjectionStateDir,
} from "../../src/config/native-projection-state.js";

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "kiln-global-instruction-shim-projection-"));
const PROJECT_PATH = join(FIXTURE_ROOT, "project");
const USER_HOME = join(FIXTURE_ROOT, "home");
const KILN_HOME = join(USER_HOME, ".kiln");
const GLOBAL_PROJECTION_STATE_DIR = resolveGlobalNativeProjectionStateDir(USER_HOME);
const PROJECT_STATE_BINDING = (() => {
  mkdirSync(PROJECT_PATH, { recursive: true });
  return resolveProjectStateBinding(PROJECT_PATH, { kilnHome: KILN_HOME });
})();
const FIXED_TIMESTAMP = "2026-07-04T00:00:00.000Z";
const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;

function resetFixture(): void {
  rmSync(PROJECT_PATH, { recursive: true, force: true });
  rmSync(USER_HOME, { recursive: true, force: true });
  rmSync(join(FIXTURE_ROOT, "xdg-config"), { recursive: true, force: true });
  rmSync(PROJECT_STATE_BINDING.projectStateRoot, { recursive: true, force: true });
  mkdirSync(PROJECT_PATH, { recursive: true });
  mkdirSync(PROJECT_STATE_BINDING.projectStateRoot, { recursive: true });
  mkdirSync(join(KILN_HOME, "instructions"), { recursive: true });
  mkdirSync(join(FIXTURE_ROOT, "xdg-config", "kiln"), { recursive: true });
  writeFileSync(join(KILN_HOME, "config.yaml"), [
    "version: '5'",
    "activeInstructionProfiles:",
    "  - sequel-engineering",
    "",
  ].join("\n"), "utf-8");
  writeFileSync(join(PROJECT_PATH, "package.json"), JSON.stringify({ name: "shim-project" }), "utf-8");
  writeFileSync(PROJECT_STATE_BINDING.configPath, [
    "version: \"1\"",
    "activeInstructionProfiles:",
    "  - sequel-engineering",
    "",
  ].join("\n"), "utf-8");
  writeGlobalProfile("No dead code.\n\nCodex OAuth, OpenCode Go, and OpenCode Zen are Kiln direct providers.");
}

function projectionOptions(options: GlobalInstructionShimProjectionOptions = {}): GlobalInstructionShimProjectionOptions {
  return {
    ...options,
    userHome: options.userHome ?? USER_HOME,
    projectStateBinding: options.projectStateBinding ?? PROJECT_STATE_BINDING,
  };
}

function syncGlobalInstructionShimProjections(
  projectPath: string,
  options: GlobalInstructionShimProjectionOptions = {},
): ReturnType<typeof syncGlobalInstructionShimProjectionsRaw> {
  return syncGlobalInstructionShimProjectionsRaw(projectPath, projectionOptions(options));
}

function readGlobalInstructionShimProjectionSnapshots(
  projectPath: string,
  options: GlobalInstructionShimProjectionOptions = {},
): ReturnType<typeof readGlobalInstructionShimProjectionSnapshotsRaw> {
  return readGlobalInstructionShimProjectionSnapshotsRaw(projectPath, projectionOptions(options));
}

function writeGlobalProfile(
  instructions: string,
  instructionsRoot = join(KILN_HOME, "instructions"),
): void {
  mkdirSync(instructionsRoot, { recursive: true });
  writeFileSync(join(instructionsRoot, "sequel-engineering.md"), [
    "---",
    "name: sequel-engineering",
    "displayName: Sequel Engineering",
    "description: Shared Sequel engineering doctrine.",
    "doctrine:",
    "  principles:",
    "    - No redundancy.",
    "    - No dead code.",
    "  workflow:",
    "    - Scout, plan, test, implement, review.",
    "  qualityGates:",
    "    - Run focused tests before claiming completion.",
    "  delegation:",
    "    - Use configured Kiln agent profiles for delegated work.",
    "---",
    instructions,
    "",
  ].join("\n"), "utf-8");
}

function targetPath(targetId: string): string {
  const target = listGlobalInstructionShimTargets(USER_HOME).find((entry) => entry.targetId === targetId);
  if (!target) {
    throw new Error(`Missing target fixture for ${targetId}`);
  }
  return target.filePath;
}

describe("global instruction shim projection", () => {
  beforeAll(() => {
    process.env.XDG_CONFIG_HOME = join(FIXTURE_ROOT, "xdg-config");
  });

  afterAll(() => {
    process.env.XDG_CONFIG_HOME = ORIGINAL_XDG_CONFIG_HOME;
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetFixture();
  });

  it("lists the official global instruction entrypoints for each native harness", () => {
    expect(listGlobalInstructionShimTargets(USER_HOME)).toEqual([
      {
        targetId: "codex-global-instructions",
        harness: "codex",
        displayName: "Codex global instructions",
        filePath: join(USER_HOME, ".codex", "AGENTS.md"),
      },
      {
        targetId: "claude-global-instructions",
        harness: "claude",
        displayName: "Claude global instructions",
        filePath: join(USER_HOME, ".claude", "CLAUDE.md"),
      },
      {
        targetId: "opencode-global-instructions",
        harness: "opencode",
        displayName: "OpenCode global instructions",
        filePath: join(USER_HOME, ".config", "opencode", "AGENTS.md"),
      },
    ]);
  });

  it("writes signed global shims from global Kiln instruction profiles only", async () => {
    const result = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: FIXED_TIMESTAMP,
    });

    expect(result.errors).toEqual([]);
    expect(result.synced).toBe(3);
    expect(result.targets.every((target) => target.status === "written")).toBe(true);

    const codex = readFileSync(targetPath("codex-global-instructions"), "utf-8");
    const claude = readFileSync(targetPath("claude-global-instructions"), "utf-8");
    const opencode = readFileSync(targetPath("opencode-global-instructions"), "utf-8");

    for (const content of [codex, claude, opencode]) {
      expect(content).toContain("kiln:global-instruction-shim:v1");
      expect(content).toContain("sourceProfiles: sequel-engineering");
      expect(content).toContain("generator: global-instruction-shims-v1");
      expect(content).toContain("# Sequel Global Instructions");
      expect(content).toContain("## Direct Provider Boundary");
      expect(content).toContain("codex-oauth");
      expect(content).toContain("opencode-go");
      expect(content).toContain("opencode-zen");
      expect(content).toContain("No dead code.");
      expect(content).not.toContain("## Project");
      expect(content).not.toContain("## Agents");
    }
    expect(codex).toContain("target: codex");
    expect(claude).toContain("target: claude");
    expect(opencode).toContain("target: opencode");

    const state = readNativeProjectionInstallState(GLOBAL_PROJECTION_STATE_DIR);
    expect(Object.keys(state.targets).sort()).toEqual([
      "claude-global-instructions",
      "codex-global-instructions",
      "opencode-global-instructions",
    ]);
  });

  it("shares install and drift evidence across distinct project bindings", async () => {
    const secondProjectPath = join(FIXTURE_ROOT, "second-project");
    mkdirSync(secondProjectPath, { recursive: true });
    const secondBinding = resolveProjectStateBinding(secondProjectPath, {
      kilnHome: KILN_HOME,
    });
    mkdirSync(secondBinding.projectStateRoot, { recursive: true });
    writeFileSync(join(secondProjectPath, "package.json"), JSON.stringify({ name: "second-shim-project" }), "utf-8");
    writeFileSync(secondBinding.configPath, [
      "version: \"1\"",
      "activeInstructionProfiles:",
      "  - sequel-engineering",
      "",
    ].join("\n"), "utf-8");

    const first = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: FIXED_TIMESTAMP,
    });
    expect(first.errors).toEqual([]);
    expect(readNativeProjectionInstallState(GLOBAL_PROJECTION_STATE_DIR).targets["codex-global-instructions"])
      .toBeDefined();
    expect(existsSync(join(PROJECT_STATE_BINDING.projectionsPath, "install-state.json"))).toBe(false);

    const second = await syncGlobalInstructionShimProjectionsRaw(secondProjectPath, {
      userHome: USER_HOME,
      projectStateBinding: secondBinding,
      timestamp: "2026-07-04T01:00:00.000Z",
    });
    expect(second.errors).toEqual([]);
    expect(second.targets.every((target) => target.status === "unchanged")).toBe(true);
    expect(existsSync(join(secondBinding.projectionsPath, "install-state.json"))).toBe(false);

    writeFileSync(targetPath("codex-global-instructions"), "# drifted shared global shim", "utf-8");
    const secondSnapshot = await readGlobalInstructionShimProjectionSnapshotsRaw(secondProjectPath, {
      userHome: USER_HOME,
      projectStateBinding: secondBinding,
    });
    expect(secondSnapshot).toContainEqual(expect.objectContaining({
      targetId: "codex-global-instructions",
      status: "drifted",
    }));
  });

  it("keeps production projection lifecycle state in the canonical XDG Kiln home", async () => {
    const canonicalKilnHome = join(FIXTURE_ROOT, "xdg-config", "kiln");
    writeGlobalProfile("Canonical XDG doctrine.", join(canonicalKilnHome, "instructions"));

    const result = await syncGlobalInstructionShimProjectionsRaw(PROJECT_PATH, {
      projectStateBinding: PROJECT_STATE_BINDING,
      timestamp: FIXED_TIMESTAMP,
    });

    expect(result.errors).toEqual([]);
    expect(readNativeProjectionInstallState(join(canonicalKilnHome, "runtime", "native-projections"))
      .targets["codex-global-instructions"]).toBeDefined();
    expect(existsSync(join(homedir(), ".kiln", "runtime", "native-projections", "install-state.json"))).toBe(false);
  });

  it("plans all global shims without writing targets, backups, or install state", async () => {
    const result = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      dryRun: true,
      timestamp: FIXED_TIMESTAMP,
    });

    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((outcome) => outcome.status === "planned")).toBe(true);
    expect(listGlobalInstructionShimTargets(USER_HOME).every((target) => !existsSync(target.filePath))).toBe(true);
    expect(existsSync(join(GLOBAL_PROJECTION_STATE_DIR, "install-state.json"))).toBe(false);
    expect(existsSync(join(GLOBAL_PROJECTION_STATE_DIR, "backups"))).toBe(false);
    expect(existsSync(join(PROJECT_STATE_BINDING.projectionsPath, "install-state.json"))).toBe(false);
    expect(existsSync(PROJECT_STATE_BINDING.backupsPath)).toBe(false);
  });

  it("is idempotent when managed global shims are unchanged", async () => {
    await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: FIXED_TIMESTAMP,
    });
    const firstCodex = readFileSync(targetPath("codex-global-instructions"), "utf-8");

    const result = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: "2026-07-04T01:00:00.000Z",
    });

    expect(result.errors).toEqual([]);
    expect(result.synced).toBe(0);
    expect(result.targets.every((target) => target.status === "unchanged")).toBe(true);
    expect(readFileSync(targetPath("codex-global-instructions"), "utf-8")).toBe(firstCodex);
  });

  it("blocks unmanaged global files until adoption is explicit", async () => {
    mkdirSync(join(USER_HOME, ".codex"), { recursive: true });
    writeFileSync(targetPath("codex-global-instructions"), "# Hand-written Codex guidance", "utf-8");

    const blocked = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: FIXED_TIMESTAMP,
    });

    expect(blocked.errors).toContain("codex-global-instructions: unmanaged global instruction file exists; rerun with adoption after review");
    expect(blocked.targets.find((target) => target.targetId === "codex-global-instructions")).toMatchObject({
      status: "blocked",
    });
    expect(readFileSync(targetPath("codex-global-instructions"), "utf-8")).toBe("# Hand-written Codex guidance");

    const adopted = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      adoptUnmanaged: true,
      timestamp: FIXED_TIMESTAMP,
    });

    expect(adopted.errors).toEqual([]);
    expect(readFileSync(targetPath("codex-global-instructions"), "utf-8")).toContain("kiln:global-instruction-shim:v1");
    const backups = readdirSync(join(GLOBAL_PROJECTION_STATE_DIR, "backups", "codex-global-instructions"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(GLOBAL_PROJECTION_STATE_DIR, "backups", "codex-global-instructions", backups[0]!), "utf-8"))
      .toBe("# Hand-written Codex guidance");
  });

  it("reports stale managed shims and blocks drift until force is explicit", async () => {
    await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: FIXED_TIMESTAMP,
    });

    writeGlobalProfile("No dead code.\n\nAdd a new durable global rule.");
    expect(await readGlobalInstructionShimProjectionSnapshots(PROJECT_PATH, { userHome: USER_HOME }))
      .toContainEqual(expect.objectContaining({
        targetId: "codex-global-instructions",
        status: "stale",
      }));

    await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: "2026-07-04T01:00:00.000Z",
    });
    writeFileSync(targetPath("codex-global-instructions"), "# Manual edit after management", "utf-8");

    const blocked = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: "2026-07-04T02:00:00.000Z",
    });

    expect(blocked.errors).toContain("codex-global-instructions: managed global instruction drift detected; rerun with force after review");
    expect(readFileSync(targetPath("codex-global-instructions"), "utf-8")).toBe("# Manual edit after management");

    const forced = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      force: true,
      timestamp: "2026-07-04T03:00:00.000Z",
    });
    expect(forced.errors).toEqual([]);
    expect(readFileSync(targetPath("codex-global-instructions"), "utf-8")).toContain("Add a new durable global rule.");
  });

  it("removes only managed global shims for disabled native harnesses", async () => {
    await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      timestamp: FIXED_TIMESTAMP,
    });
    mkdirSync(join(USER_HOME, ".claude"), { recursive: true });
    writeFileSync(targetPath("claude-global-instructions"), "# User-owned Claude guidance", "utf-8");

    const result = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      disabledHarnesses: ["codex", "claude"],
      timestamp: "2026-07-04T01:00:00.000Z",
    });

    expect(result.targets.find((target) => target.targetId === "codex-global-instructions")).toMatchObject({
      status: "removed",
    });
    expect(result.targets.find((target) => target.targetId === "claude-global-instructions")).toMatchObject({
      status: "disabled-unmanaged",
    });
    expect(existsSync(targetPath("codex-global-instructions"))).toBe(false);
    expect(readFileSync(targetPath("claude-global-instructions"), "utf-8")).toBe("# User-owned Claude guidance");
  });

  it("replaces adopted symlink entrypoints with independent managed files", async () => {
    mkdirSync(join(USER_HOME, ".claude"), { recursive: true });
    mkdirSync(join(USER_HOME, ".codex"), { recursive: true });
    mkdirSync(join(USER_HOME, ".config", "opencode"), { recursive: true });
    const sharedAgentsPath = join(USER_HOME, ".claude", "AGENTS.md");
    writeFileSync(sharedAgentsPath, "# Shared legacy AGENTS", "utf-8");
    try {
      symlinkSync(sharedAgentsPath, targetPath("codex-global-instructions"));
      symlinkSync(sharedAgentsPath, targetPath("opencode-global-instructions"));
    } catch {
      return;
    }

    const result = await syncGlobalInstructionShimProjections(PROJECT_PATH, {
      userHome: USER_HOME,
      adoptUnmanaged: true,
      timestamp: FIXED_TIMESTAMP,
    });

    expect(result.errors).toEqual([]);
    expect(lstatSync(targetPath("codex-global-instructions")).isSymbolicLink()).toBe(false);
    expect(lstatSync(targetPath("opencode-global-instructions")).isSymbolicLink()).toBe(false);
    expect(readFileSync(targetPath("codex-global-instructions"), "utf-8")).toContain("target: codex");
    expect(readFileSync(targetPath("opencode-global-instructions"), "utf-8")).toContain("target: opencode");
    expect(readFileSync(sharedAgentsPath, "utf-8")).toBe("# Shared legacy AGENTS");
  });
});
