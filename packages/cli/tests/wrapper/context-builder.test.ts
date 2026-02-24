import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../src/wrapper/context-builder.js";
import type { KilnAppConfig } from "../../src/config.js";
import type { DomainConfig } from "@kilnai/core";

const MOCK_DOMAIN: DomainConfig = {
  name: "python",
  displayName: "Python",
  toolTags: new Set(["python", "pip"]),
  qualityGates: [
    { name: "ruff", command: "ruff check .", description: "Linter", required: true },
    { name: "mypy", command: "mypy src/", description: "Type checker", required: true },
    { name: "pytest", command: "pytest", description: "Tests", required: true },
  ],
  detectPatterns: ["pyproject.toml", "requirements.txt"],
  multishotExamples: "Use dataclasses for value objects.",
  phaseExamples: "Analyze: read pyproject.toml first.",
};

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => {
    throw new Error("createRegistry not called in context-builder tests");
  },
  buildSystemPrompt: (opts) => {
    const memorySection = opts.memorySnapshot ?? "No prior memory available.";
    return [
      "<kiln-session>",
      "<role>You are a coding assistant.</role>",
      "<phases>analyze, research, architect, implement, verify, synthesize</phases>",
      `<domain name="${opts.domain?.displayName}">`,
      ...(opts.domain?.qualityGates.map((g) => g.name) ?? []),
      "</domain>",
      `<memory>${memorySection}</memory>`,
      `<task>${opts.task}</task>`,
      `<mcp-tools>kiln_memory_save kiln_phase_gate</mcp-tools>`,
      `<path>${opts.projectPath}</path>`,
      "</kiln-session>",
    ].join("\n");
  },
  mcpServerName: "kiln",
};

describe("buildSystemPrompt", () => {
  it("includes the task description", () => {
    const prompt = buildSystemPrompt(MOCK_APP_CONFIG, {
      task: "Fix the login bug",
      domain: MOCK_DOMAIN,
      projectPath: "/home/user/project",
    });
    expect(prompt).toContain("Fix the login bug");
  });

  it("includes the domain display name", () => {
    const prompt = buildSystemPrompt(MOCK_APP_CONFIG, {
      task: "some task",
      domain: MOCK_DOMAIN,
      projectPath: "/home/user/project",
    });
    expect(prompt).toContain('name="Python"');
  });

  it("includes quality gate names", () => {
    const prompt = buildSystemPrompt(MOCK_APP_CONFIG, {
      task: "some task",
      domain: MOCK_DOMAIN,
      projectPath: "/home/user/project",
    });
    expect(prompt).toContain("ruff");
    expect(prompt).toContain("mypy");
    expect(prompt).toContain("pytest");
  });

  it("includes memory snapshot when provided", () => {
    const prompt = buildSystemPrompt(MOCK_APP_CONFIG, {
      task: "some task",
      domain: MOCK_DOMAIN,
      memorySnapshot: "Previous session: fixed auth module",
      projectPath: "/home/user/project",
    });
    expect(prompt).toContain("Previous session: fixed auth module");
  });

  it('says "No prior memory available." when no snapshot', () => {
    const prompt = buildSystemPrompt(MOCK_APP_CONFIG, {
      task: "some task",
      domain: MOCK_DOMAIN,
      projectPath: "/home/user/project",
    });
    expect(prompt).toContain("No prior memory available.");
  });

  it("includes the project path", () => {
    const prompt = buildSystemPrompt(MOCK_APP_CONFIG, {
      task: "some task",
      domain: MOCK_DOMAIN,
      projectPath: "/home/user/project",
    });
    expect(prompt).toContain("/home/user/project");
  });

  it("includes MCP tools section", () => {
    const prompt = buildSystemPrompt(MOCK_APP_CONFIG, {
      task: "some task",
      domain: MOCK_DOMAIN,
      projectPath: "/home/user/project",
    });
    expect(prompt).toContain("<mcp-tools>");
    expect(prompt).toContain("kiln_memory_save");
    expect(prompt).toContain("kiln_phase_gate");
  });
});

