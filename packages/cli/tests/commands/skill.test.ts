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

const VALID_SKILL_YAML = `
name: test-skill
description: A test skill
instructions: Follow best practices
tools:
  - read_file
tags:
  - testing
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
    it("lists skills without errors", async () => {
      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "list", []);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("install subcommand", () => {
    it("installs a valid skill file", async () => {
      const skillPath = join(tmpDir, "test-skill.yaml");
      writeFileSync(skillPath, VALID_SKILL_YAML, "utf-8");

      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "install", [skillPath]);

      const installed = join(tmpDir, ".kiln", "skills", "test-skill.yaml");
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
  });

  describe("publish subcommand", () => {
    it("validates SKILL.yaml in current directory", async () => {
      writeFileSync(join(tmpDir, "SKILL.yaml"), VALID_SKILL_YAML, "utf-8");

      const { skillCommand } = await import("../../src/commands/skill.js");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await skillCommand(TEST_CONFIG, "publish", []);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("validated successfully"));
      consoleSpy.mockRestore();
    });

    it("errors when no SKILL.yaml found", async () => {
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
