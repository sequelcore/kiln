import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "../../src/wrapper/session-manager.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";
import type { WrapperConfig } from "../../src/wrapper/index.js";
import type { KilnAppConfig } from "../../src/config.js";
import { type DomainConfig, DomainRegistry } from "@kilnai/core/domain";
import { type ContextArtifactCache, InMemoryContextArtifactCache } from "@kilnai/core/memory";

const PYTHON_CONFIG: DomainConfig = {
  name: "python",
  displayName: "Python",
  detectPatterns: ["pyproject.toml", "setup.py", "requirements.txt"],
  toolTags: new Set(["python", "testing", "linting"]),
  qualityGates: [{ name: "lint", command: "ruff check .", description: "Lint", required: true }],
  multishotExamples: "",
  phaseExamples: "",
};

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(() => ""),
  };
});

vi.mock("@kilnai/runtime", () => ({
  getProjectContextArtifactCache: vi.fn().mockResolvedValue(new InMemoryContextArtifactCache()),
}));

const MOCK_CACHE: ContextArtifactCache = new InMemoryContextArtifactCache();

const MOCK_CONFIG: WrapperConfig = {
  mode: "api-key",
  permissionPolicy: { approval: "on-request", sandbox: "read-only" },
};

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () => new DomainRegistry({
    builtinConfigs: [PYTHON_CONFIG],
    discovery: {
      exists: (projectPath, relativePath) => existsSync(join(projectPath, relativePath)),
      readYamlFiles: () => [],
    },
  }),
  buildSystemPrompt: (opts) => {
    const mem = opts.projectedContext?.blocks?.[0]?.content ?? "No prior memory available.";
    return `<kiln-session><task>${opts.task}</task><memory>${mem}</memory></kiln-session>`;
  },
};

describe("SessionManager", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    projectRoot = resolveProjectRoot({ cwd: process.cwd() }).rootPath;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("prepare()", () => {
    it("returns a valid SessionContext", async () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      const ctx = await manager.prepare("Fix the bug", projectRoot);

      expect(ctx.mode).toBe("api-key");
      expect(ctx.task).toBe("Fix the bug");
      expect(ctx.workingDirectory).toBe(projectRoot);
      expect(ctx.systemPrompt).toBeTruthy();
      expect(ctx.mcpServerEntryPath).toBeTruthy();
      expect(ctx.domain).toBeTruthy();
    });

    it("resolves MCP server entry path", async () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      const ctx = await manager.prepare("task", projectRoot);

      expect(ctx.mcpServerEntryPath).toContain("mcp");
      expect(ctx.mcpServerEntryPath).toContain("index.js");
    });

    it("detects domain via DomainRegistry", async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p) => {
        return typeof p === "string" && p.includes("pyproject.toml");
      });

      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      const pythonProject = projectRoot;
      const ctx = await manager.prepare("Add tests", pythonProject);

      expect(ctx.domain.name).toBe("python");
      expect(ctx.domain.displayName).toBe("Python");
    });

    it("falls back to generic domain when nothing detected", async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      const ctx = await manager.prepare("Do something", projectRoot);

      expect(ctx.domain.name).toBe("generic");
    });

    it("generates system prompt via buildSystemPrompt from app config", async () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      const ctx = await manager.prepare("task", projectRoot);

      expect(ctx.systemPrompt).toContain("<kiln-session>");
      expect(ctx.systemPrompt).toContain("task");
    });
  });

  describe("cleanup()", () => {
    it("returns a SessionReport", async () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      await manager.prepare("Fix the login bug", projectRoot);
      const report = manager.cleanup({
        sessionId: "test-session-id",
        terminalPhase: "completed",
      });

      expect(report.sessionId).toBe("test-session-id");
      expect(report.phaseReached).toBe("completed");
      expect(report.domain).toBeTruthy();
      expect(report.cost).toHaveProperty("total");
      expect(report.cost).toHaveProperty("byRoleModel");
      expect(report.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
