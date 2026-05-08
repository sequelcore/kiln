import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DomainRegistry } from "@kilnai/core";
import type { KilnAppConfig } from "../../src/config.js";

// Mock the process.exit to prevent test runner from dying
const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

const TEST_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.0.0-test",
  description: "Test",
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
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
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-skill-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    mockExit.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
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

      const installed = join(tmpDir, ".kiln", "skills", "test-skill.md");
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
