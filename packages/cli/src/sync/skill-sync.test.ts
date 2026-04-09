import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

vi.mock("node:fs", () => ({
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(),
  },
}));

import { discoverSkillDirs, syncSkills } from "./skill-sync.js";

const copyFileSyncMock = copyFileSync as unknown as ReturnType<typeof vi.fn>;
const mkdirSyncMock = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const readdirSyncMock = readdirSync as unknown as ReturnType<typeof vi.fn>;
const homedirMock = os.homedir as unknown as ReturnType<typeof vi.fn>;

function dirent(name: string, isDirectory: boolean): { name: string; isDirectory: () => boolean; isFile: () => boolean } {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  };
}

describe("skill-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    copyFileSyncMock.mockReset();
    mkdirSyncMock.mockReset();
    readdirSyncMock.mockReset();
    homedirMock.mockReset();

    homedirMock.mockReturnValue("/home/tester");
    mkdirSyncMock.mockImplementation(() => undefined);
    copyFileSyncMock.mockImplementation(() => undefined);
  });

  it("returns synced:0 and all true when no skill directories exist", async () => {
    readdirSyncMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = await syncSkills("/workspace/project");

    expect(result).toEqual({
      claude: true,
      codex: true,
      opencode: true,
      synced: 0,
      errors: [],
    });
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(copyFileSyncMock).not.toHaveBeenCalled();
  });

  it("discoverSkillDirs() returns global skills when no project dir", () => {
    const projectPath = "/workspace/project";
    const globalDir = join("/home/tester", ".kiln", "skills");
    const projectDir = join(projectPath, ".kiln", "skills");

    readdirSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === globalDir) {
        return [dirent("planner", true), dirent("README.md", false)];
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
      if (targetPath === projectDir) {
        return [dirent("planner", true)];
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
      if (targetPath === projectDir) {
        return [dirent("reviewer", true)];
      }
      throw new Error(`Unexpected path: ${targetPath}`);
    });

    const dirs = discoverSkillDirs(projectPath);

    expect([...dirs.entries()]).toEqual([
      ["planner", join(globalDir, "planner")],
      ["reviewer", join(projectDir, "reviewer")],
    ]);
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
      if (targetPath === projectDir) {
        throw new Error("ENOENT");
      }
      if (targetPath === skillSourceDir) {
        return [dirent("SKILL.md", false), dirent("notes.txt", false), dirent("assets", true)];
      }
      throw new Error(`Unexpected path: ${targetPath}`);
    });

    const result = await syncSkills(projectPath);

    expect(result.claude).toBe(true);
    expect(result.codex).toBe(true);
    expect(result.opencode).toBe(true);
    expect(result.synced).toBe(3);
    expect(copyFileSyncMock).toHaveBeenCalledTimes(6);
    expect(copyFileSyncMock).toHaveBeenCalledWith(
      join(skillSourceDir, "SKILL.md"),
      join("/home/tester", ".claude", "skills", "planner", "SKILL.md"),
    );
    expect(copyFileSyncMock).toHaveBeenCalledWith(
      join(skillSourceDir, "SKILL.md"),
      join("/home/tester", ".codex", "skills", "planner", "SKILL.md"),
    );
    expect(copyFileSyncMock).toHaveBeenCalledWith(
      join(skillSourceDir, "SKILL.md"),
      join("/home/tester", ".config", "opencode", "skills", "planner", "SKILL.md"),
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
      if (targetPath === projectDir) {
        throw new Error("ENOENT");
      }
      if (targetPath === skillSourceDir) {
        return [dirent("SKILL.md", false)];
      }
      throw new Error(`Unexpected path: ${targetPath}`);
    });

    copyFileSyncMock.mockImplementation((_sourcePath: string, targetPath: string) => {
      if (targetPath.includes(".codex")) {
        throw new Error("codex write failed");
      }
    });

    const result = await syncSkills(projectPath);

    expect(result.claude).toBe(true);
    expect(result.codex).toBe(false);
    expect(result.opencode).toBe(true);
    expect(result.synced).toBe(2);
    expect(result.errors.some((entry) => entry.includes("codex write failed"))).toBe(true);
  });
});
