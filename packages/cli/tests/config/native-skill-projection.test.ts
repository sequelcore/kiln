import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join } from "node:path";

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

import { discoverSkillDirs, syncNativeSkillProjections } from "../../src/config/native-skill-projection.js";

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
    readdirSyncMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = await syncNativeSkillProjections("/workspace/project", SKILLS_DISABLED);

    expect(result).toEqual({
      claude: true,
      codex: true,
      opencode: true,
      synced: 0,
      errors: [],
    });
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
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
        throw new Error("ENOENT");
      }
      throw new Error(`Unexpected path: ${targetPath}`);
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
      throw new Error(`Unexpected path: ${targetPath}`);
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
      throw new Error(`Unexpected path: ${targetPath}`);
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
        throw new Error("ENOENT");
      }
      if (targetPath === projectDir) {
        return [dirent("repo-context-review", true)];
      }
      if (targetPath === join(projectDir, "repo-context-review")) {
        return [];
      }
      throw new Error(`Unexpected path: ${targetPath}`);
    });

    const dirs = discoverSkillDirs(projectPath);

    expect(dirs.has("repo-context-review")).toBe(false);
  });

  it("projects configured Kiln builtin skills to native skill directories", async () => {
    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath.endsWith(join(".kiln", "skills"))) {
        throw new Error("ENOENT");
      }
      throw new Error(`Unexpected path: ${targetPath}`);
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
      if (targetPath === projectDir) {
        throw new Error("ENOENT");
      }
      throw new Error(`Unexpected path: ${targetPath}`);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    fsMocks.files.set(join(skillSourceDir, "notes.txt"), "notes\n");

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
        throw new Error("ENOENT");
      }
      throw new Error(`Unexpected path: ${targetPath}`);
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
        throw new Error("ENOENT");
      }
      throw new Error(`Unexpected path: ${targetPath}`);
    });
    fsMocks.files.set(join(skillSourceDir, "SKILL.md"), PLANNER_SKILL);
    fsMocks.files.set(join(skillSourceDir, "notes.txt"), "notes\n");

    const result = await syncNativeSkillProjections(projectPath, SKILLS_DISABLED);

    expect(result.errors).toHaveLength(0);
    const state = JSON.parse(fsMocks.files.get(join(projectPath, ".kiln", "install-state.json")) ?? "{}") as {
      targets: Record<string, { projectionKind?: string; managedFields: string[] }>;
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
    });
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
        throw new Error("ENOENT");
      }
      throw new Error(`Unexpected path: ${targetPath}`);
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
      "Codex skill \"planner\" file \"SKILL.md\" failed: managed file drift detected: $file",
    ]);
    expect(fsMocks.files.get(codexSkillPath)).toBe("user drift\n");

    const forced = await syncNativeSkillProjections(projectPath, { ...SKILLS_DISABLED, force: true });

    expect(forced.codex).toBe(true);
    expect(forced.errors).toHaveLength(0);
    expect(fsMocks.files.get(codexSkillPath)).toBe(PLANNER_SKILL);
  });
});
