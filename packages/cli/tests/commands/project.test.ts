import { beforeEach, describe, expect, it, vi } from "vitest";

const projectMocks = vi.hoisted(() => ({
  resolveProjectRoot: vi.fn(),
  collectProjectContextEvidence: vi.fn(),
  renderProjectContextMarkdown: vi.fn(),
  writeProjectContextAdoption: vi.fn(),
}));

vi.mock("../../src/application/project-root-resolver.js", () => ({
  resolveProjectRoot: projectMocks.resolveProjectRoot,
}));

vi.mock("../../src/application/project-context.js", () => ({
  collectProjectContextEvidence: projectMocks.collectProjectContextEvidence,
  renderProjectContextMarkdown: projectMocks.renderProjectContextMarkdown,
  writeProjectContextAdoption: projectMocks.writeProjectContextAdoption,
}));

import { projectCommand } from "../../src/commands/project.js";

const MOCK_APP_CONFIG = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Test",
  createRegistry: () => {
    throw new Error("createRegistry not called in project tests");
  },
  mcpServerName: "kiln",
};

describe("projectCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectMocks.resolveProjectRoot.mockReturnValue({
      rootPath: "C:/project",
      source: "git",
      hasKilnYaml: false,
      hasGitRoot: true,
      projectName: "project",
    });
    projectMocks.collectProjectContextEvidence.mockReturnValue({
      projectName: "project",
      packageManager: "bun",
      scripts: [["test", "bun run test"]],
      workspacePackages: ["packages/*"],
      docs: ["README.md"],
    });
    projectMocks.renderProjectContextMarkdown.mockReturnValue("# Project Context");
    projectMocks.writeProjectContextAdoption.mockReturnValue({
      written: true,
      path: "C:/project/.kiln/project-context.md",
      status: "written",
      errors: [],
    });
  });

  it("prints markdown scout evidence", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await projectCommand(MOCK_APP_CONFIG, "scout", ["--project", "C:/project/packages/api"]);
      expect(consoleLogSpy).toHaveBeenCalledWith("# Project Context");
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(projectMocks.resolveProjectRoot).toHaveBeenCalledWith({ explicitPath: "C:/project/packages/api" });
    expect(projectMocks.collectProjectContextEvidence).toHaveBeenCalledWith("C:/project");
  });

  it("writes project context adoption", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await projectCommand(MOCK_APP_CONFIG, "adopt", ["--force"]);
      expect(consoleLogSpy).toHaveBeenCalledWith("C:/project/.kiln/project-context.md: written");
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(projectMocks.writeProjectContextAdoption).toHaveBeenCalledWith("C:/project", { force: true });
  });

  it("fails closed when project root is unresolved", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    projectMocks.resolveProjectRoot.mockReturnValue({
      rootPath: "C:/loose",
      source: "cwd",
      hasKilnYaml: false,
      hasGitRoot: false,
      projectName: "loose",
    });

    try {
      await expect(projectCommand(MOCK_APP_CONFIG, "adopt", [])).rejects.toThrow("process.exit:1");
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(projectMocks.writeProjectContextAdoption).not.toHaveBeenCalled();
  });
});
