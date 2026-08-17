import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  homedir: vi.fn(() => "/home/tester"),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((path: string) => fsMocks.files.has(path)),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn((path: string) => fsMocks.files.get(path) ?? ""),
  readdirSync: vi.fn(),
  renameSync: vi.fn((source: string, destination: string) => {
    const content = fsMocks.files.get(source);
    if (content === undefined) throw new Error(`ENOENT: ${source}`);
    fsMocks.files.set(destination, content);
    fsMocks.files.delete(source);
  }),
  rmSync: vi.fn((path: string) => {
    fsMocks.files.delete(path);
  }),
  writeFileSync: vi.fn((path: string, content: string) => {
    fsMocks.files.set(path, content);
  }),
}));

vi.mock("node:os", () => ({
  homedir: fsMocks.homedir,
  default: {
    homedir: fsMocks.homedir,
  },
}));

import {
  discoverSkillDirs,
  discoverSkillProjectionSources,
  normalizeProjectedSkillFileContent,
  syncNativeSkillProjections,
} from "../../src/config/native-skill-projection.js";
import { canonicalSkillKey } from "../../src/config/native-projection-paths.js";

const SKILLS_DISABLED = { skillConfig: { builtin: { enabled: false } } } as const;
const PLANNER_SKILL = "---\nname: planner\ndescription: Plan work.\n---\n";

const existsSyncMock = existsSync as unknown as ReturnType<typeof vi.fn>;
const mkdirSyncMock = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const readFileSyncMock = readFileSync as unknown as ReturnType<typeof vi.fn>;
const readdirSyncMock = readdirSync as unknown as ReturnType<typeof vi.fn>;
const writeFileSyncMock = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const homedirMock = os.homedir as unknown as ReturnType<typeof vi.fn>;

function dirent(name: string, isDirectory: boolean): { name: string; isDirectory: () => boolean; isFile: () => boolean } {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  };
}

describe("native-skill-projection", () => {
  it("removes a UTF-8 BOM only from projected SKILL.md content", () => {
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, 0x2d, 0x2d, 0x2d]);
    expect([...normalizeProjectedSkillFileContent("SKILL.md", bom)]).toEqual([0x2d, 0x2d, 0x2d]);
    expect(normalizeProjectedSkillFileContent("assets/data.bin", bom)).toBe(bom);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
    readFileSyncMock.mockReset();
    readdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    homedirMock.mockReset();
    fsMocks.files.clear();

    homedirMock.mockReturnValue("/home/tester");
    mkdirSyncMock.mockImplementation(() => undefined);
    existsSyncMock.mockImplementation((path: string) => fsMocks.files.has(path));
    readFileSyncMock.mockImplementation((path: string) => {
      const configured = fsMocks.files.get(path);
      if (configured !== undefined) return configured;
      if (basename(path).toLowerCase() === "skill.md") {
        const name = basename(dirname(path));
        return `---\nname: ${name}\ndescription: Test skill.\n---\n`;
      }
      return "";
    });
    writeFileSyncMock.mockImplementation((path: string, content: string) => {
      fsMocks.files.set(path, content);
    });
  });

  it("returns synced:0 and all true when no skill directories exist", async () => {
    readdirSyncMock.mockImplementation((targetPath: string) => {
      return readdirMissing(targetPath);
    });

    const result = await syncNativeSkillProjections("/workspace/project", SKILLS_DISABLED);

    expect(result).toEqual({
      claude: true,
      codex: true,
      opencode: true,
      synced: 0,
      errors: [],
      outcomes: [],
    });
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it("renders explicit-only visibility per harness and fails closed for unsupported OpenCode", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false), dirent("agents", true)];
      if (targetPath === join(skillSourceDir, "agents")) return [dirent("openai.yaml", false)];
      if (targetPath === projectDir) throw new Error("ENOENT");
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), "---\nname: planner\ndescription: Plan work.\nlicense: MIT\n---\nBody\n");
    fsMocks.files.set(join(skillSourceDir, "agents", "openai.yaml"), "interface:\n  display_name: Planner\n");

    const result = await syncNativeSkillProjections(projectPath, {
      skillConfig: {
        builtin: { enabled: false },
        visibility: { overrides: { planner: "explicit-only" } },
      },
    });

    expect(result.errors).toEqual([]);
    expect(fsMocks.files.get(join("/home/tester", ".codex", "skills", "planner", "agents", "openai.yaml")))
      .toContain("allow_implicit_invocation: false");
    expect(fsMocks.files.get(join("/home/tester", ".codex", "skills", "planner", "agents", "openai.yaml")))
      .toContain("display_name: Planner");
    expect(fsMocks.files.get(join("/home/tester", ".claude", "skills", "planner", "SKILL.md")))
      .toContain("disable-model-invocation: true");
    expect(fsMocks.files.get(join("/home/tester", ".claude", "skills", "planner", "SKILL.md")))
      .toContain("license: MIT");
    expect(fsMocks.files.has(join("/home/tester", ".claude", "skills", "planner", "agents", "openai.yaml")))
      .toBe(false);
    expect([...fsMocks.files.keys()].some((path) => path.includes(join(".config", "opencode", "skills", "planner"))))
      .toBe(false);
    expect(result.outcomes).toContainEqual(expect.objectContaining({
      targetId: "opencode-skill:planner",
      status: "skipped",
      reason: expect.stringContaining("explicit-only visibility is unsupported"),
    }));
  });

  it("overrides stale native opt-out metadata when visibility returns to implicit", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false), dirent("agents", true)];
      if (targetPath === join(skillSourceDir, "agents")) return [dirent("openai.yaml", false)];
      return readdirMissing(targetPath);
    });
    fsMocks.files.set(
      join(skillSourceDir, "SKILL.md"),
      "---\nname: planner\ndescription: Plan work.\ndisable-model-invocation: true\n---\nBody\n",
    );
    fsMocks.files.set(
      join(skillSourceDir, "agents", "openai.yaml"),
      "policy:\n  allow_implicit_invocation: false\n",
    );

    await syncNativeSkillProjections(projectPath, {
      skillConfig: { builtin: { enabled: false }, visibility: { overrides: { planner: "implicit" } } },
    });

    expect(fsMocks.files.get(join("/home/tester", ".codex", "skills", "planner", "agents", "openai.yaml")))
      .toContain("allow_implicit_invocation: true");
    expect(fsMocks.files.get(join("/home/tester", ".claude", "skills", "planner", "SKILL.md")))
      .toContain("disable-model-invocation: false");
    expect(fsMocks.files.has(join("/home/tester", ".claude", "skills", "planner", "agents", "openai.yaml")))
      .toBe(false);
  });

  it("does not project disabled skills", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      return readdirMissing(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);

    const result = await syncNativeSkillProjections(projectPath, {
      skillConfig: {
        builtin: { enabled: false },
        visibility: { overrides: { planner: "disabled" } },
      },
    });

    expect(result.synced).toBe(0);
    expect([...fsMocks.files.keys()].some((path) => path.includes(`${join("skills", "planner")}`)))
      .toBe(true); // canonical source remains
    expect([...fsMocks.files.keys()].some((path) => path.includes(join(".codex", "skills", "planner"))))
      .toBe(false);
  });

  it("prunes previously managed projections when a skill becomes disabled", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      return readdirMissing(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    const result = await syncNativeSkillProjections(projectPath, {
      skillConfig: {
        builtin: { enabled: false },
        visibility: { overrides: { planner: "disabled" } },
      },
    });

    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "codex-skill:planner/SKILL.md", status: "removed" }),
      expect.objectContaining({ targetId: "claude-skill:planner/SKILL.md", status: "removed" }),
      expect.objectContaining({ targetId: "opencode-skill:planner/SKILL.md", status: "removed" }),
    ]));
    expect([...fsMocks.files.keys()].some((path) => path.includes(join(".codex", "skills", "planner"))))
      .toBe(false);
    const state = JSON.parse(fsMocks.files.get(join(projectPath, ".kiln", "install-state.json")) ?? "{}") as {
      targets?: Record<string, unknown>;
    };
    expect(Object.keys(state.targets ?? {}).some((targetId) => targetId.includes("skill:planner/"))).toBe(false);
  });

  it("reports a failed outcome when a harness skill directory cannot be created", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    const codexSkillsDir = join("/home/tester", ".codex", "skills");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      if (targetPath === projectDir) throw new Error("ENOENT");
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    mkdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === codexSkillsDir) throw new Error("access denied");
    });

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.codex).toBe(false);
    expect(result.outcomes).toContainEqual({
      targetId: "codex-skill-directory",
      path: codexSkillsDir,
      status: "failed",
      reason: "access denied",
    });
    expect([...fsMocks.files.keys()].some((path) => path.startsWith(codexSkillsDir))).toBe(false);
  });

  it("discoverSkillDirs() returns global skills when no project dir", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return [dirent("planner", true), dirent("README.md", false)];
      }
      if (targetPath === join(globalDir, "planner")) {
        return [dirent("SKILL.md", false)];
      }
      if (targetPath === projectDir) {
        return readdirMissing(targetPath);
      }
      return readdirFallback(targetPath);
    });

    const dirs = discoverSkillDirs(projectPath);

    expect([...dirs.entries()]).toEqual([
      ["planner", join(globalDir, "planner")],
    ]);
  });

  it("discoverSkillDirs() project overrides global skill with same name", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return [dirent("planner", true)];
      }
      if (targetPath === join(globalDir, "planner")) {
        return [dirent("SKILL.md", false)];
      }
      if (targetPath === projectDir) {
        return [dirent("planner", true)];
      }
      if (targetPath === join(projectDir, "planner")) {
        return [dirent("SKILL.md", false)];
      }
      return readdirFallback(targetPath);
    });

    const dirs = discoverSkillDirs(projectPath);

    expect(dirs.get("planner")).toBe(join(projectDir, "planner"));
  });

  it("discoverSkillDirs() merges distinct skills from both dirs", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return [dirent("planner", true)];
      }
      if (targetPath === join(globalDir, "planner")) {
        return [dirent("SKILL.md", false)];
      }
      if (targetPath === projectDir) {
        return [dirent("reviewer", true)];
      }
      if (targetPath === join(projectDir, "reviewer")) {
        return [dirent("SKILL.md", false)];
      }
      return readdirFallback(targetPath);
    });

    const dirs = discoverSkillDirs(projectPath);

    expect([...dirs.entries()]).toEqual([
      ["planner", join(globalDir, "planner")],
      ["reviewer", join(projectDir, "reviewer")],
    ]);
  });

  it("discoverSkillDirs() ignores empty directories so builtins are not shadowed", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return readdirMissing(targetPath);
      }
      if (targetPath === projectDir) {
        return [dirent("repo-context-review", true)];
      }
      if (targetPath === join(projectDir, "repo-context-review")) {
        return [];
      }
      return readdirFallback(targetPath);
    });

    const dirs = discoverSkillDirs(projectPath);

    expect(dirs.has("repo-context-review")).toBe(false);
  });

  it("admits safe flat skills and lets project flat files override user flat duplicates", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const userFile = join(globalDir, "user.md");
    const invalidFile = join(globalDir, "invalid.md");
    const projectFile = join(projectDir, "project.md");
    // The two flat files must be duplicates on every platform. Case-insensitive
    // collision is a Windows-only property of canonicalSkillKey and is covered
    // against both platforms in native-projection-paths.test.ts.
    fsMocks.files.set(userFile, "---\nname: buildtools\ndescription: user\n---\n");
    fsMocks.files.set(invalidFile, "---\nname: ../escape\ndescription: invalid\n---\n");
    fsMocks.files.set(projectFile, "---\nname: buildtools\ndescription: project\n---\n");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("user.md", false), dirent("invalid.md", false)];
      if (targetPath === projectDir) return [dirent("project.md", false)];
      return readdirFallback(targetPath);
    });

    const sources = discoverSkillProjectionSources(projectPath, SKILLS_DISABLED.skillConfig);
    expect(sources.get(canonicalSkillKey("buildtools"))).toMatchObject({
      skillName: "buildtools",
      sourceIdentity: "project:buildtools",
      files: [{ fileName: "project.md", content: "---\nname: buildtools\ndescription: project\n---\n" }],
    });
    expect(sources.has(canonicalSkillKey("../escape"))).toBe(false);
  });

  it("lets a project flat skill override a user canonical directory", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const userSkillDir = join(globalDir, "planner");
    const projectFile = join(projectDir, "planner.md");
    fsMocks.files.set(join(userSkillDir, "SKILL.md"), PLANNER_SKILL);
    fsMocks.files.set(projectFile, "---\nname: planner\ndescription: project flat\n---\n");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === userSkillDir) return [dirent("SKILL.md", false)];
      if (targetPath === projectDir) return [dirent("planner.md", false)];
      return readdirFallback(targetPath);
    });

    const source = discoverSkillProjectionSources(projectPath, SKILLS_DISABLED.skillConfig).get("planner");

    expect(source).toMatchObject({
      sourceIdentity: "project:planner",
      files: [{ fileName: "planner.md", content: "---\nname: planner\ndescription: project flat\n---\n" }],
    });
  });

  it("lets a project canonical directory override a user flat skill", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const userFile = join(globalDir, "planner.md");
    const projectSkillDir = join(projectDir, "planner");
    fsMocks.files.set(userFile, "---\nname: planner\ndescription: user flat\n---\n");
    fsMocks.files.set(join(projectSkillDir, "SKILL.md"), PLANNER_SKILL);
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner.md", false)];
      if (targetPath === projectDir) return [dirent("planner", true)];
      if (targetPath === projectSkillDir) return [dirent("SKILL.md", false)];
      return readdirFallback(targetPath);
    });

    const source = discoverSkillProjectionSources(projectPath, SKILLS_DISABLED.skillConfig).get("planner");

    expect(source).toMatchObject({
      sourceIdentity: "project:planner",
      sourceDir: projectSkillDir,
    });
  });

  it("prefers a canonical directory over a flat skill in the same origin", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const skillDir = join(globalDir, "planner");
    fsMocks.files.set(join(skillDir, "SKILL.md"), PLANNER_SKILL);
    fsMocks.files.set(join(globalDir, "planner.md"), "---\nname: planner\ndescription: flat\n---\n");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true), dirent("planner.md", false)];
      if (targetPath === skillDir) return [dirent("SKILL.md", false)];
      return readdirMissing(targetPath);
    });

    const source = discoverSkillProjectionSources(projectPath, SKILLS_DISABLED.skillConfig).get("planner");

    expect(source).toMatchObject({ sourceIdentity: "user:planner", sourceDir: skillDir });
  });

  it("ignores unsafe flat frontmatter names without touching harness roots", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("invalid.md", false)];
      return readdirMissing(targetPath);
    });
    fsMocks.files.set(join(globalDir, "invalid.md"), "---\nname: C:\\escape\ndescription: invalid\n---\n");

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result).toMatchObject({ claude: true, codex: true, opencode: true, synced: 0, errors: [] });
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect([...fsMocks.files.keys()].some((path) => path.includes("escape"))).toBe(false);
  });

  it("blocks unsafe recursive resource names before resolving a target file", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false), dirent("../escape", false)];
      return readdirMissing(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.errors.some((error) => error.includes("unsafe skill resource path"))).toBe(true);
    expect([...fsMocks.files.keys()].some((path) => path.includes("escape"))).toBe(false);
  });

  it("blocks a canonical-byte file when historical projection identity does not match", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      return readdirMissing(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);
    const statePath = join(projectPath, ".kiln", "install-state.json");
    const state = JSON.parse(fsMocks.files.get(statePath) ?? "{}") as {
      targets: Record<string, Record<string, unknown>>;
    };
    state.targets["codex-skill:planner/SKILL.md"]!.sourceIdentity = "skill:other/SKILL.md";
    fsMocks.files.set(statePath, JSON.stringify(state));

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.codex).toBe(false);
    expect(result.errors).toContain(
      "Codex skill \"planner\" file \"SKILL.md\" failed: managed projection identity mismatch",
    );
    expect(fsMocks.files.get(join("/home/tester", ".codex", "skills", "planner", "SKILL.md"))).toBe(PLANNER_SKILL);
  });

  it("adopts byte-identical unmanaged files and blocks divergent unmanaged files unless forced", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    const codexSkillPath = join("/home/tester", ".codex", "skills", "planner", "SKILL.md");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      return readdirMissing(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    fsMocks.files.set(codexSkillPath, "operator-owned content\n");

    const blocked = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(blocked.codex).toBe(false);
    expect(blocked.errors).toContain(
      "Codex skill \"planner\" file \"SKILL.md\" failed: unmanaged skill file exists; rerun with force after review",
    );
    expect(fsMocks.files.get(codexSkillPath)).toBe("operator-owned content\n");

    const forced = await syncNativeSkillProjections(projectPath, { ...SKILLS_DISABLED, force: true });
    expect(forced.codex).toBe(true);
    expect(fsMocks.files.get(codexSkillPath)).toBe(PLANNER_SKILL);

    fsMocks.files.delete(join(projectPath, ".kiln", "install-state.json"));
    writeFileSyncMock.mockClear();
    const adoptionPlan = await syncNativeSkillProjections(projectPath, { ...SKILLS_DISABLED, dryRun: true });
    expect(adoptionPlan.outcomes).toContainEqual(expect.objectContaining({
      targetId: "codex-skill:planner/SKILL.md",
      status: "planned",
      reason: "adopted byte-identical unmanaged skill file",
    }));
    expect(fsMocks.files.has(join(projectPath, ".kiln", "install-state.json"))).toBe(false);

    const adopted = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);
    expect(adopted.codex).toBe(true);
    expect(adopted.outcomes).toContainEqual(expect.objectContaining({
      targetId: "codex-skill:planner/SKILL.md",
      status: "unchanged",
      reason: "adopted byte-identical unmanaged skill file",
    }));
    expect(writeFileSyncMock).not.toHaveBeenCalledWith(codexSkillPath, expect.anything(), expect.anything());
  });

  it("blocks canonical bytes when a legacy snapshot has no matching historical hash", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      return readdirMissing(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);
    const statePath = join(projectPath, ".kiln", "install-state.json");
    const state = JSON.parse(fsMocks.files.get(statePath) ?? "{}") as {
      targets: Record<string, Record<string, unknown>>;
    };
    const target = state.targets["codex-skill:planner/SKILL.md"]!;
    delete target.projectionKind;
    delete target.harness;
    delete target.sourceIdentity;
    target.contentHash = "historical-snapshot";
    target.managedFieldHashes = { "$file": "historical-snapshot" };
    fsMocks.files.set(statePath, JSON.stringify(state));
    writeFileSyncMock.mockClear();

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.codex).toBe(false);
    expect(result.errors).toContain(
      "Codex skill \"planner\" file \"SKILL.md\" failed: managed projection identity mismatch",
    );
    expect(fsMocks.files.get(join("/home/tester", ".codex", "skills", "planner", "SKILL.md"))).toBe(PLANNER_SKILL);
    expect(writeFileSyncMock).not.toHaveBeenCalledWith(
      join("/home/tester", ".codex", "skills", "planner", "SKILL.md"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("projects configured Kiln builtin skills to native skill directories", async () => {
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath.endsWith(join(".kiln", "skills"))) {
        return readdirMissing(targetPath);
      }
      return readdirFallback(targetPath);
    });

    const result = await syncNativeSkillProjections("/workspace/project", {
      skillConfig: {
        builtin: {
          include: ["tdd-workflow"],
        },
      },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.synced).toBe(3);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join("/home/tester", ".codex", "skills", "tdd-workflow", "SKILL.md"),
      expect.stringContaining("name: tdd-workflow"),
      "utf-8",
    );
  });

  it("plans every builtin skill file without creating directories, files, backups, or install state", async () => {
    readdirSyncMock.mockImplementation((targetPath: string) => {
      return readdirMissing(targetPath);
    });

    const result = await syncNativeSkillProjections("/workspace/project", {
      dryRun: true,
      skillConfig: { builtin: { include: ["tdd-workflow"] } },
    });

    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((outcome) => outcome.status === "planned")).toBe(true);
  });

  it("reports disabled harness skill paths as skipped", async () => {
    readdirSyncMock.mockImplementation((targetPath: string) => {
      return readdirMissing(targetPath);
    });

    const result = await syncNativeSkillProjections("/workspace/project", {
      dryRun: true,
      disabledHarnesses: ["codex"],
      skillConfig: { builtin: { include: ["tdd-workflow"] } },
    });

    expect(result.outcomes).toContainEqual({
      targetId: "codex-skill:tdd-workflow",
      path: join("/home/tester", ".codex", "skills", "tdd-workflow"),
      status: "skipped",
      reason: "Codex harness is disabled",
    });
    expect(result.outcomes).not.toContainEqual(expect.objectContaining({
      targetId: expect.stringMatching(/^codex-skill:/),
      status: "planned",
    }));
  });

  it("skill files are copied to all three target directories", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return [dirent("planner", true)];
      }
      if (targetPath === skillSourceDir) {
        return [dirent("SKILL.md", false), dirent("notes.txt", false), dirent("assets", true)];
      }
      if (targetPath === join(skillSourceDir, "assets")) {
        return [dirent("icon.svg", false)];
      }
      if (targetPath === projectDir) {
        return readdirMissing(targetPath);
      }
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    fsMocks.files.set(join(skillSourceDir, "notes.txt"), "notes\n");
    fsMocks.files.set(join(skillSourceDir, "assets", "icon.svg"), "<svg />\n");

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.claude).toBe(true);
    expect(result.codex).toBe(true);
    expect(result.opencode).toBe(true);
    expect(result.synced).toBe(3);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join("/home/tester", ".claude", "skills", "planner", "SKILL.md"),
      PLANNER_SKILL,
      "utf-8",
    );
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join("/home/tester", ".codex", "skills", "planner", "SKILL.md"),
      PLANNER_SKILL,
      "utf-8",
    );
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join("/home/tester", ".codex", "skills", "planner", "assets", "icon.svg"),
      "<svg />\n",
      "utf-8",
    );
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join("/home/tester", ".config", "opencode", "skills", "planner", "SKILL.md"),
      PLANNER_SKILL,
      "utf-8",
    );
  });

  it("write failure marks correct target as false and captures error", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return [dirent("planner", true)];
      }
      if (targetPath === skillSourceDir) {
        return [dirent("SKILL.md", false)];
      }
      if (targetPath === projectDir) {
        return readdirMissing(targetPath);
      }
      return readdirFallback(targetPath);
    });

    writeFileSyncMock.mockImplementation((targetPath: string, content: string) => {
      if (targetPath.includes(".codex")) {
        throw new Error("codex write failed");
      }
      fsMocks.files.set(targetPath, content);
    });

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.claude).toBe(true);
    expect(result.codex).toBe(false);
    expect(result.opencode).toBe(true);
    expect(result.synced).toBe(2);
    expect(result.errors.some((entry) => entry.includes("codex write failed"))).toBe(true);
  });

  it("records install state for each projected skill file", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return [dirent("planner", true)];
      }
      if (targetPath === skillSourceDir) {
        return [dirent("SKILL.md", false), dirent("notes.txt", false)];
      }
      if (targetPath === projectDir) {
        return readdirMissing(targetPath);
      }
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    fsMocks.files.set(join(skillSourceDir, "notes.txt"), "notes\n");

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.errors).toHaveLength(0);
    const state = JSON.parse(fsMocks.files.get(join(projectPath, ".kiln", "install-state.json")) ?? "{}") as {
      targets: Record<string, { projectionKind?: string; managedFields: string[]; harness?: string; sourceIdentity?: string }>;
    };
    expect(Object.keys(state.targets).sort()).toEqual([
      "claude-skill:planner/SKILL.md",
      "claude-skill:planner/notes.txt",
      "codex-skill:planner/SKILL.md",
      "codex-skill:planner/notes.txt",
      "opencode-skill:planner/SKILL.md",
      "opencode-skill:planner/notes.txt",
    ]);
    expect(state.targets["claude-skill:planner/SKILL.md"]).toMatchObject({
      projectionKind: "file",
      managedFields: ["$file"],
      harness: "claude",
      sourceIdentity: "user:planner/SKILL.md",
    });

    writeFileSyncMock.mockClear();
    const converged = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);
    expect(converged.errors).toEqual([]);
    expect(converged.outcomes.every((outcome) => outcome.status === "unchanged")).toBe(true);
    expect(converged.outcomes.every((outcome) => outcome.reason === "managed skill file is current")).toBe(true);
    expect(writeFileSyncMock.mock.calls.some(([path]) => String(path).includes(join("skills", "planner")))).toBe(false);
  });

  it("reconciles stale fully-owned skill snapshots without rewriting canonical files", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    const statePath = join(projectPath, ".kiln", "install-state.json");
    const targetFiles = [
      { target: "claude", path: join("/home/tester", ".claude", "skills", "planner", "SKILL.md") },
      { target: "codex", path: join("/home/tester", ".codex", "skills", "planner", "SKILL.md") },
      { target: "opencode", path: join("/home/tester", ".config", "opencode", "skills", "planner", "SKILL.md") },
    ];

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      if (targetPath === projectDir) throw new Error("ENOENT");
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);

    await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);
    const staleState = JSON.parse(fsMocks.files.get(statePath) ?? "{}") as {
      targets: Record<string, { contentHash: string; managedFieldHashes: Record<string, string> }>;
    };
    for (const target of Object.values(staleState.targets)) {
      target.contentHash = "historical-snapshot";
      target.managedFieldHashes.$file = "historical-snapshot";
    }
    fsMocks.files.set(statePath, JSON.stringify(staleState));
    writeFileSyncMock.mockClear();

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.errors).toEqual([]);
    expect(result.outcomes).toEqual(expect.arrayContaining(targetFiles.map(({ target, path }) => ({
      targetId: `${target}-skill:planner/SKILL.md`,
      path,
      status: "unchanged",
      reason: "reconciled managed skill file snapshot",
    }))));
    expect(writeFileSyncMock.mock.calls.some(([path]) => targetFiles.some((target) => target.path === path))).toBe(false);
    expect(writeFileSyncMock.mock.calls.some(([path]) => String(path).includes(".kiln/backups/"))).toBe(false);

    const repairedState = JSON.parse(fsMocks.files.get(statePath) ?? "{}") as {
      targets: Record<string, { contentHash: string; managedFieldHashes: Record<string, string> }>;
    };
    expect(Object.values(repairedState.targets).every((target) => target.contentHash !== "historical-snapshot")).toBe(true);
    for (const { path } of targetFiles) {
      expect(fsMocks.files.get(path)).toBe(PLANNER_SKILL);
    }
  });

  it("reports stale snapshot reconciliation in dry-run without mutating files or state", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    const statePath = join(projectPath, ".kiln", "install-state.json");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      if (targetPath === projectDir) throw new Error("ENOENT");
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);

    await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);
    const staleState = JSON.parse(fsMocks.files.get(statePath) ?? "{}") as {
      targets: Record<string, { contentHash: string; managedFieldHashes: Record<string, string> }>;
    };
    for (const target of Object.values(staleState.targets)) {
      target.contentHash = "historical-snapshot";
      target.managedFieldHashes.$file = "historical-snapshot";
    }
    const staleStateJson = JSON.stringify(staleState);
    fsMocks.files.set(statePath, staleStateJson);
    writeFileSyncMock.mockClear();

    const result = await syncNativeSkillProjections(projectPath, { ...SKILLS_DISABLED, dryRun: true });

    expect(result.errors).toEqual([]);
    expect(result.outcomes.filter((outcome) => outcome.status === "unchanged")).toHaveLength(3);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(fsMocks.files.get(statePath)).toBe(staleStateJson);
  });

  it("projects nested skill resources and records their relative paths", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    const referenceDir = join(skillSourceDir, "references");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) {
        return [dirent("SKILL.md", false), dirent("references", true)];
      }
      if (targetPath === referenceDir) return [dirent("workflow.md", false)];
      if (targetPath === projectDir) throw new Error("ENOENT");
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    fsMocks.files.set(join(referenceDir, "workflow.md"), "# Workflow\n");

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.errors).toHaveLength(0);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join("/home/tester", ".codex", "skills", "planner", "references", "workflow.md"),
      "# Workflow\n",
      "utf-8",
    );
    const state = JSON.parse(fsMocks.files.get(join(projectPath, ".kiln", "install-state.json")) ?? "{}") as {
      targets: Record<string, unknown>;
    };
    expect(state.targets).toHaveProperty("codex-skill:planner/references/workflow.md");
  });

  it("aborts only drifted projected skill files unless force is set", async () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    const codexSkillPath = join("/home/tester", ".codex", "skills", "planner", "SKILL.md");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return [dirent("planner", true)];
      }
      if (targetPath === skillSourceDir) {
        return [dirent("SKILL.md", false)];
      }
      if (targetPath === projectDir) {
        return readdirMissing(targetPath);
      }
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);

    const first = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);
    expect(first.errors).toHaveLength(0);
    fsMocks.files.set(codexSkillPath, "user drift\n");

    const second = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(second.claude).toBe(true);
    expect(second.codex).toBe(false);
    expect(second.opencode).toBe(true);
    expect(second.errors).toEqual([
      "Codex skill \"planner\" file \"SKILL.md\" failed: managed file drift detected: file content",
    ]);
    expect(fsMocks.files.get(codexSkillPath)).toBe("user drift\n");

    const forced = await syncNativeSkillProjections(projectPath, { ...SKILLS_DISABLED, force: true });

    expect(forced.codex).toBe(true);
    expect(forced.errors).toHaveLength(0);
    expect(fsMocks.files.get(codexSkillPath)).toBe(PLANNER_SKILL);
  });

  it("removes managed files for skills removed from the canonical catalog", async () => {
    const projectPath = "/workspace/project";
    const kilnDir = join(projectPath, ".kiln");
    const removedPath = join("/home/tester", ".codex", "skills", "removed", "SKILL.md");
    fsMocks.files.set(removedPath, "removed\n");
    fsMocks.files.set(join(kilnDir, "install-state.json"), JSON.stringify({
      version: 1,
      targets: {
        "codex-skill:removed/SKILL.md": {
          targetId: "codex-skill:removed/SKILL.md",
          filePath: removedPath,
          projectionKind: "file",
          contentHash: "ignored",
          managedFields: ["$file"],
          managedFieldHashes: {
            "$file": "bc772298e9274d658105f8298b3e35d8c88142ec543e168dade9ea8fa1e0294d",
          },
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      },
    }));
    readdirSyncMock.mockImplementation((targetPath: string) => {
      return readdirMissing(targetPath);
    });

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.errors).toEqual([]);
    expect(fsMocks.files.has(removedPath)).toBe(false);
    const state = JSON.parse(fsMocks.files.get(join(kilnDir, "install-state.json")) ?? "{}") as {
      targets: Record<string, unknown>;
    };
    expect(state.targets).not.toHaveProperty("codex-skill:removed/SKILL.md");
  });

  it("drops stale case-only install state without deleting the current skill file", async () => {
    const projectPath = "/workspace/project";
    const kilnDir = join(projectPath, ".kiln");
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");
    const skillSourceDir = join(globalDir, "planner");
    const codexSkillPath = join("/home/tester", ".codex", "skills", "planner", "SKILL.md");
    fsMocks.files.set(codexSkillPath, PLANNER_SKILL);
    fsMocks.files.set(join(kilnDir, "install-state.json"), JSON.stringify({
      version: 1,
      targets: {
        "codex-skill:planner/skill.md": {
          targetId: "codex-skill:planner/skill.md",
          filePath: codexSkillPath,
          projectionKind: "file",
          contentHash: "legacy",
          managedFields: ["$file"],
          managedFieldHashes: { "$file": "legacy" },
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      },
    }));
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) return [dirent("planner", true)];
      if (targetPath === skillSourceDir) return [dirent("SKILL.md", false)];
      if (targetPath === projectDir) throw new Error("ENOENT");
      return readdirFallback(targetPath);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.errors).toEqual([]);
    expect(fsMocks.files.get(codexSkillPath)).toBe(PLANNER_SKILL);
    const state = JSON.parse(fsMocks.files.get(join(kilnDir, "install-state.json")) ?? "{}") as {
      targets: Record<string, unknown>;
    };
    expect(state.targets).not.toHaveProperty("codex-skill:planner/skill.md");
    expect(state.targets).toHaveProperty("codex-skill:planner/SKILL.md");
  });
});

/**
 * Backup pruning reads the backup directory it just created. `mkdirSync` is a
 * no-op here, so model that directory as freshly empty; retention itself is
 * covered against the real filesystem in native-projection-backup.test.ts.
 */
function readdirFallback(targetPath: string): never[] {
  if (targetPath.includes("backups")) return [];
  throw new Error(`Unexpected path: ${targetPath}`);
}

/** As `readdirFallback`, for mocks whose terminal case is a missing directory. */
function readdirMissing(targetPath: string): never[] {
  if (targetPath.includes("backups")) return [];
  throw new Error("ENOENT");
}
