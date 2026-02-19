import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { SessionManager } from "../../src/wrapper/session-manager.js";
import type { WrapperConfig } from "../../src/wrapper/index.js";
import type { KilnAppConfig } from "../../src/config.js";
import { DomainRegistry } from "@kilnai/core";
import type { DomainConfig } from "@kilnai/core";

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

const MOCK_CONFIG: WrapperConfig = {
  mode: "api-key",
  claudeCodePath: "claude",
  dangerouslySkipPermissions: false,
  sandbox: true,
  autoApprove: false,
  autoApproveTimeout: 30000,
};

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => new DomainRegistry({
    builtinConfigs: [PYTHON_CONFIG],
    domainsDir: ".kiln/domains",
  }),
  buildSystemPrompt: (opts) => {
    const mem = opts.memorySnapshot ?? "No prior memory available.";
    return `<kiln-session><task>${opts.task}</task><memory>${mem}</memory></kiln-session>`;
  },
  mcpServerName: "kiln",
};

describe("SessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("prepare()", () => {
    it("returns a valid SessionContext", () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG);
      const ctx = manager.prepare("Fix the bug", "/home/user/project");

      expect(ctx.mode).toBe("api-key");
      expect(ctx.task).toBe("Fix the bug");
      expect(ctx.workingDirectory).toBe("/home/user/project");
      expect(ctx.systemPrompt).toBeTruthy();
      expect(ctx.mcpServerEntryPath).toBeTruthy();
      expect(ctx.domain).toBeTruthy();
    });

    it("resolves MCP server entry path", () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG);
      const ctx = manager.prepare("task", "/home/user/project");

      expect(ctx.mcpServerEntryPath).toContain("mcp");
      expect(ctx.mcpServerEntryPath).toContain("index.ts");
    });

    it("detects domain via DomainRegistry", () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        return typeof p === "string" && p.includes("pyproject.toml");
      });

      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG);
      const ctx = manager.prepare("Add tests", "/home/user/python-project");

      expect(ctx.domain.name).toBe("python");
      expect(ctx.domain.displayName).toBe("Python");
    });

    it("falls back to generic domain when nothing detected", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG);
      const ctx = manager.prepare("Do something", "/home/user/unknown");

      expect(ctx.domain.name).toBe("generic");
    });

    it("includes memory snapshot in system prompt when provided", () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG);
      const ctx = manager.prepare(
        "task",
        "/home/user/project",
        "Remember: use strict mode",
      );

      expect(ctx.systemPrompt).toContain("Remember: use strict mode");
      expect(ctx.memorySnapshot).toBe("Remember: use strict mode");
    });

    it("sets empty memorySnapshot when none provided", () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG);
      const ctx = manager.prepare("task", "/home/user/project");

      expect(ctx.memorySnapshot).toBe("");
    });
  });

  describe("cleanup()", () => {
    it("returns a SessionReport", () => {
      const manager = new SessionManager(MOCK_CONFIG, MOCK_APP_CONFIG);
      manager.prepare("Fix the login bug", "/home/user/project");
      const report = manager.cleanup("test-session-id");

      expect(report.sessionId).toBe("test-session-id");
      expect(report.totalPhases).toBe(6);
      expect(report.domain).toBeTruthy();
      expect(report.cost).toHaveProperty("total");
      expect(report.cost).toHaveProperty("byRole");
      expect(report.qualityGates).toHaveProperty("passed");
      expect(report.qualityGates).toHaveProperty("failed");
      expect(report.qualityGates).toHaveProperty("violations");
      expect(report.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
