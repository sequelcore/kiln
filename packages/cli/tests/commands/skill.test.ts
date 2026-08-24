import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DomainRegistry } from "@kilnai/core/domain";
import type { KilnAppConfig } from "../../src/config.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../../src/application/project-state-root.js";

// Mock the process.exit to prevent test runner from dying
const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

const TEST_CONFIG: KilnAppConfig = {
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
};

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill
tools:
  - read_file
tags:
  - testing
---

# Test Skill

Follow best practices when reviewing code.
`;

describe("skillCommand", () => {
  let tmpDir: string;
  let projectStateBinding: ProjectStateBinding;
  let originalCwd: string;
  let originalXdgConfigHome: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-skill-"));
    originalCwd = process.cwd();
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, "config");
    process.chdir(tmpDir);
    projectStateBinding = resolveProjectStateBinding(tmpDir);
    mockExit.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("list subcommand", () => {
    it("lists Kiln core builtin skills when none are installed", async () => {
      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "list", []);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("repo-context-review");
      expect(output).toContain("tdd-workflow");
      consoleSpy.mockRestore();
    });

    it("lists installed skills by name", async () => {
      const skillPath = join(tmpDir, "my-skill.md");
      writeFileSync(skillPath, VALID_SKILL_MD, "utf-8");

      const { skillCommand } = await import("../../src/commands/skill.js");
      const installSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "install", [skillPath]);
      installSpy.mockRestore();

      const listSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "list", []);
      const output = listSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("test-skill");
      listSpy.mockRestore();
    });
  });

  describe("install subcommand", () => {
    it("installs a valid SKILL.md file", async () => {
      const skillPath = join(tmpDir, "test-skill.md");
      writeFileSync(skillPath, VALID_SKILL_MD, "utf-8");

      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "install", [skillPath]);

      const installed = join(projectStateBinding.skillsPath, "test-skill", "SKILL.md");
      expect(existsSync(installed)).toBe(true);
      consoleSpy.mockRestore();
    });

    it("errors on missing path argument", async () => {
      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "install", []);
      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
    });

    it("errors on non-.md file", async () => {
      const yamlPath = join(tmpDir, "old.yaml");
      writeFileSync(yamlPath, "name: test", "utf-8");

      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "install", [yamlPath]);
      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
    });
  });

  describe("governed package lifecycle", () => {
    it("fails closed when the private skills owner is redirected by a junction", async () => {
      const source = join(tmpDir, "source", "test-skill");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "SKILL.md"), VALID_SKILL_MD, "utf8");
      const outside = join(tmpDir, "redirect-target");
      mkdirSync(outside, { recursive: true });
      mkdirSync(projectStateBinding.projectStateRoot, { recursive: true });
      try {
        symlinkSync(outside, projectStateBinding.skillsPath, "junction");
      } catch {
        return;
      }

      const { skillCommand } = await import("../../src/commands/skill.js");
      await expect(skillCommand(TEST_CONFIG, "install", [source])).rejects.toThrow(/unsafe/iu);
      expect(existsSync(join(outside, "test-skill"))).toBe(false);
    });

    it("installs a complete directory package and records immutable evidence", async () => {
      const packagePath = join(tmpDir, "source", "test-skill");
      mkdirSync(join(packagePath, "references"), { recursive: true });
      writeFileSync(join(packagePath, "SKILL.md"), VALID_SKILL_MD, "utf8");
      writeFileSync(join(packagePath, "references", "guide.md"), "# Guide\n", "utf8");
      const { skillCommand } = await import("../../src/commands/skill.js");
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await skillCommand(TEST_CONFIG, "install", [packagePath]);

      expect(existsSync(join(projectStateBinding.skillsPath, "test-skill", "references", "guide.md"))).toBe(true);
      const state = JSON.parse(readFileSync(join(projectStateBinding.projectStateRoot, "skill-install-state.json"), "utf8"));
      expect(state.packages["test-skill"]).toMatchObject({ sourcePath: packagePath });
      expect(state.packages["test-skill"].packageDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      spy.mockRestore();
    });

    it("refuses overwrite, updates current owned packages, and backs up replacements", async () => {
      const source = join(tmpDir, "source", "test-skill");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "SKILL.md"), VALID_SKILL_MD, "utf8");
      const { skillCommand } = await import("../../src/commands/skill.js");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "install", [source]);
      await skillCommand(TEST_CONFIG, "install", [source]);
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockClear();
      writeFileSync(join(source, "SKILL.md"), VALID_SKILL_MD.replace("Follow best practices", "Follow governed practices"), "utf8");
      await skillCommand(TEST_CONFIG, "update", ["test-skill", source]);
      expect(readFileSync(join(projectStateBinding.skillsPath, "test-skill", "SKILL.md"), "utf8")).toContain("governed practices");
      expect(existsSync(join(projectStateBinding.backupsPath, "skills", "test-skill"))).toBe(true);
      log.mockRestore(); error.mockRestore();
    });

    it("blocks removal after local drift and preserves a recoverable backup when forced", async () => {
      const source = join(tmpDir, "source", "test-skill");
      mkdirSync(source, { recursive: true }); writeFileSync(join(source, "SKILL.md"), VALID_SKILL_MD, "utf8");
      const { skillCommand } = await import("../../src/commands/skill.js");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "install", [source]);
      const installed = join(projectStateBinding.skillsPath, "test-skill", "SKILL.md");
      writeFileSync(installed, VALID_SKILL_MD.replace("best", "locally modified"), "utf8");
      await skillCommand(TEST_CONFIG, "remove", ["test-skill"]);
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(existsSync(installed)).toBe(true);
      mockExit.mockClear();
      await skillCommand(TEST_CONFIG, "remove", ["test-skill", "--force"]);
      expect(existsSync(installed)).toBe(false);
      expect(existsSync(join(projectStateBinding.backupsPath, "skills", "test-skill"))).toBe(true);
      log.mockRestore(); error.mockRestore();
    });

    it("accepts --force before an update source without treating it as a path", async () => {
      const source = join(tmpDir, "source", "test-skill");
      mkdirSync(source, { recursive: true }); writeFileSync(join(source, "SKILL.md"), VALID_SKILL_MD, "utf8");
      const { skillCommand } = await import("../../src/commands/skill.js");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "install", [source]);
      writeFileSync(join(projectStateBinding.skillsPath, "test-skill", "SKILL.md"), VALID_SKILL_MD.replace("best", "local"), "utf8");
      writeFileSync(join(source, "SKILL.md"), VALID_SKILL_MD.replace("best", "upstream"), "utf8");

      await skillCommand(TEST_CONFIG, "update", ["test-skill", "--force", source]);

      expect(readFileSync(join(projectStateBinding.skillsPath, "test-skill", "SKILL.md"), "utf8")).toContain("upstream practices");
      log.mockRestore();
    });

    it("rejects tampered lifecycle state before resolving any package path", async () => {
      const stateDir = projectStateBinding.projectStateRoot;
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "skill-install-state.json"), JSON.stringify({
        version: 1,
        packages: {
          "../../victim": {
            sourcePath: join(tmpDir, "source"),
            packageDigest: `sha256:${"a".repeat(64)}`,
            installedAt: new Date().toISOString(),
          },
        },
      }), "utf8");
      const victim = join(tmpDir, "victim");
      mkdirSync(victim); writeFileSync(join(victim, "keep.txt"), "keep", "utf8");
      const { skillCommand } = await import("../../src/commands/skill.js");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      await skillCommand(TEST_CONFIG, "remove", ["../../victim", "--force"]);

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(readFileSync(join(victim, "keep.txt"), "utf8")).toBe("keep");
      error.mockRestore();
    });

    it("rejects an otherwise valid operation when any persisted package key is unsafe", async () => {
      const stateDir = projectStateBinding.projectStateRoot;
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "skill-install-state.json"), JSON.stringify({
        version: 1,
        packages: {
          "safe-skill": {
            sourcePath: join(tmpDir, "source"), packageDigest: `sha256:${"a".repeat(64)}`,
            installedAt: new Date().toISOString(),
          },
          "../unsafe": {
            sourcePath: join(tmpDir, "source"), packageDigest: `sha256:${"b".repeat(64)}`,
            installedAt: new Date().toISOString(),
          },
        },
      }), "utf8");
      const { skillCommand } = await import("../../src/commands/skill.js");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      await skillCommand(TEST_CONFIG, "remove", ["safe-skill", "--force"]);

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith("Skill install state is invalid; refusing lifecycle mutation.");
      error.mockRestore();
    });
  });

  describe("publish subcommand", () => {
    it("validates SKILL.md in current directory", async () => {
      writeFileSync(join(tmpDir, "SKILL.md"), VALID_SKILL_MD, "utf-8");

      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "publish", []);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("validated successfully"));
      consoleSpy.mockRestore();
    });

    it("errors when no SKILL.md found", async () => {
      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "publish", []);
      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
    });
  });

  describe("default help", () => {
    it("prints usage for unknown subcommand", async () => {
      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "", []);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
      consoleSpy.mockRestore();
    });
  });
});
