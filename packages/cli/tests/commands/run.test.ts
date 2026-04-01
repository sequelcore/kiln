import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import type { KilnAppConfig } from "../../src/config.js";

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

import { printReport, computeEvalScore } from "../../src/commands/run.js";
import { SessionManager } from "../../src/wrapper/session-manager.js";
import type { WrapperConfig, SessionReport } from "../../src/wrapper/index.js";
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

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => new DomainRegistry({
    builtinConfigs: [PYTHON_CONFIG],
    domainsDir: ".kiln/domains",
  }),
  buildSystemPrompt: (opts) =>
    `<kiln-session><task>${opts.task}</task></kiln-session>`,
  mcpServerName: "kiln",
};

function makeConfig(overrides: Partial<WrapperConfig> = {}): WrapperConfig {
  return {
    mode: "api-key",
    permissionPolicy: { approval: "ask", sandbox: "none" },
    ...overrides,
  };
}

function makeReport(overrides: Partial<SessionReport> = {}): SessionReport {
  return {
    sessionId: "test-id",
    task: "Fix the login bug",
    domain: "Python",
    phaseReached: "implement",
    cost: {
      total: 0.42,
      byRoleModel: { "architect:claude-opus-4-6": 0.25, "worker:claude-sonnet-4-6": 0.17 },
    },
    duration: 45000,
    ...overrides,
  };
}

describe("run command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("session mode resolution", () => {
    it("determines api-key mode with --api-key", async () => {
      const config = makeConfig({ mode: "api-key", apiKey: "sk-ant-test" });
      const manager = new SessionManager(config, MOCK_APP_CONFIG);
      const ctx = await manager.prepare("Fix bug", "/project");

      expect(ctx.mode).toBe("api-key");
    });

    it("determines byok mode with --api-key + --provider", async () => {
      const config = makeConfig({
        mode: "byok",
        apiKey: "sk-test",
        provider: "openai",
      });
      const manager = new SessionManager(config, MOCK_APP_CONFIG);
      const ctx = await manager.prepare("Fix bug", "/project");

      expect(ctx.mode).toBe("byok");
    });
  });

  describe("session lifecycle", () => {
    it("calls prepare -> cleanup in order", async () => {
      const config = makeConfig();
      const manager = new SessionManager(config, MOCK_APP_CONFIG);

      const ctx = await manager.prepare("Add tests", "/project");
      expect(ctx.task).toBe("Add tests");
      expect(ctx.domain).toBeTruthy();
      expect(ctx.mcpServerEntryPath).toBeTruthy();

      const report = manager.cleanup("session-123");
      expect(report.sessionId).toBe("session-123");
    });
  });

  describe("printReport()", () => {
    it("prints report with correct format", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printReport(makeReport(), "kiln");

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("--- Kiln Session Complete ---");
      expect(output).toContain("Task:     Fix the login bug");
      expect(output).toContain("Domain:   Python");
      expect(output).toContain("Phase:    implement");
      expect(output).toContain("Cost:     $0.42");
      expect(output).toContain("architect:claude-opus-4-6: $0.25");
      expect(output).toContain("worker:claude-sonnet-4-6: $0.17");
      expect(output).toContain("Duration: 45.0s");

      consoleSpy.mockRestore();
    });

    it("prints report without cost breakdown when no roles", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printReport(makeReport({ cost: { total: 0, byRoleModel: {} } }), "kiln");

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Cost:     $0.00");
      expect(output).not.toContain("architect");

      consoleSpy.mockRestore();
    });

    it("capitalizes appName in header", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printReport(makeReport(), "myapp");

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("--- Myapp Session Complete ---");

      consoleSpy.mockRestore();
    });

    it("prints verification gates when present and passed", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printReport(
        makeReport({
          verificationResult: {
            passed: true,
            checks: [
              { name: "lint", passed: true, output: "no issues", duration: 120 },
            ],
          },
        }),
        "kiln",
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Gates:    all passed");
      expect(output).toContain("✓ lint (120ms)");

      consoleSpy.mockRestore();
    });

    it("prints failed gate output truncated to 300 chars", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printReport(
        makeReport({
          verificationResult: {
            passed: false,
            checks: [
              {
                name: "lint",
                passed: false,
                output: "E501 line too long (100 chars, 80 expected)\n".repeat(10),
                duration: 85,
              },
            ],
          },
        }),
        "kiln",
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Gates:    FAILED");
      expect(output).toContain("✗ lint (85ms)");
      expect(output).toContain("E501 line too long");

      consoleSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("handles missing task string", async () => {
      const config = makeConfig();
      const manager = new SessionManager(config, MOCK_APP_CONFIG);

      const ctx = await manager.prepare("", "/project");
      expect(ctx.task).toBe("");
    });
  });

  describe("computeEvalScore()", () => {
    it('returns "excellent" for succeeded + gates passed + cheap + fast', () => {
      const result = computeEvalScore({
        succeeded: true,
        durationMs: 30_000,
        costUsd: 0.1,
        verificationPassed: true,
        toolCallCount: 5,
      });
      expect(result.label).toBe("excellent");
      expect(result.score).toBeCloseTo(0.9);
      expect(result.signals).toContain("session succeeded");
      expect(result.signals).toContain("gates passed");
      expect(result.signals).toContain("agent used tools");
    });

    it('returns "poor" for failed + expensive + slow', () => {
      const result = computeEvalScore({
        succeeded: false,
        durationMs: 200_000,
        costUsd: 1.5,
        verificationPassed: false,
        toolCallCount: 1,
      });
      expect(result.label).toBe("poor");
      expect(result.score).toBeLessThan(0.4);
      expect(result.signals).toContain("gates failed");
      expect(result.signals).toContain("high cost");
      expect(result.signals).toContain("slow session");
    });

    it("clamps score to [0, 1]", () => {
      const result = computeEvalScore({
        succeeded: true,
        durationMs: 30_000,
        costUsd: 0.1,
        verificationPassed: true,
        toolCallCount: 5,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.label).toBe("excellent");
    });

    it("prints eval score in report when present", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printReport(makeReport({ evalScore: { score: 0.85, label: "excellent", signals: ["session succeeded"] } }), "kiln");

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Score:    excellent (85%)");

      consoleSpy.mockRestore();
    });
  });
});
