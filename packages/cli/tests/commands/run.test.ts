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

import { printReport, computeEvalScore } from "../../src/application/session-report.js";
import { SessionManager } from "../../src/wrapper/session-manager.js";
import type { WrapperConfig, SessionReport } from "../../src/wrapper/index.js";
import { type DomainConfig, DomainRegistry } from "@kilnai/core/domain";
import { type ContextArtifactCache, InMemoryContextArtifactCache } from "@kilnai/core/memory";
import { createCli } from "../../src/cli.js";

const runCommandMock = vi.hoisted(() => vi.fn());
const managedAgentCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/commands/run.js", () => ({
  runCommand: runCommandMock,
}));

vi.mock("../../src/commands/managed-agent.js", () => ({
  managedAgentCommand: managedAgentCommandMock,
}));

const PYTHON_CONFIG: DomainConfig = {
  name: "python",
  displayName: "Python",
  detectPatterns: ["pyproject.toml", "setup.py", "requirements.txt"],
  toolTags: new Set(["python", "testing", "linting"]),
  qualityGates: [{ name: "lint", command: "ruff check .", description: "Lint", required: true }],
  multishotExamples: "",
  phaseExamples: "",
};

const MOCK_CACHE: ContextArtifactCache = new InMemoryContextArtifactCache();

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () => new DomainRegistry({
    builtinConfigs: [PYTHON_CONFIG],
  }),
  buildSystemPrompt: (opts) =>
    `<kiln-session><task>${opts.task}</task></kiln-session>`,
};

function makeConfig(overrides: Partial<WrapperConfig> = {}): WrapperConfig {
  return {
    mode: "api-key",
    permissionPolicy: { approval: "on-request", sandbox: "read-only" },
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
  const originalArgv = [...process.argv];

  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
  });

  describe("CLI run flag parsing", () => {
    it("forwards --ephemeral to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--ephemeral",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          ephemeral: true,
        }),
      );
    });

    it("forwards --profile to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--profile",
        "fast-lane",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          profile: "fast-lane",
        }),
      );
    });

    it("forwards --continue to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "continue",
        "work",
        "--target",
        "test-route",
        "--continue",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "continue work",
        expect.objectContaining({
          target: "test-route",
          continuation: true,
        }),
      );
    });

    it("forwards --continue-session to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "continue",
        "work",
        "--target",
        "test-route",
        "--continue-session",
        "a04d3014-2770-41e1-a98e-f1d4cc578b30",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "continue work",
        expect.objectContaining({
          target: "test-route",
          continuationSessionId: "a04d3014-2770-41e1-a98e-f1d4cc578b30",
        }),
      );
    });

    it("forwards --skip-git-repo-check to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--skip-git-repo-check",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          skipGitRepoCheck: true,
        }),
      );
    });

    it("forwards --output-schema to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--output-schema",
        ".kiln/schemas/result.json",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          outputSchema: ".kiln/schemas/result.json",
        }),
      );
    });

    it("forwards --output answer to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--output",
        "answer",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          output: "answer",
        }),
      );
    });

    it("forwards --output json to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--output",
        "json",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          output: "json",
        }),
      );
    });

    it("rejects unsupported --output values", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--output",
        "raw",
      ];

      await expect(createCli(MOCK_APP_CONFIG)).rejects.toThrow("Unknown run output mode");
      expect(runCommandMock).not.toHaveBeenCalled();
    });

    it("forwards --add-dir to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--add-dir",
        "C:/workspace/shared",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          addDir: "C:/workspace/shared",
        }),
      );
    });

    it("forwards --local-provider to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--local-provider",
        "ollama",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          localProvider: "ollama",
        }),
      );
    });

    it("forwards --target to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
        }),
      );
    });

    it("forwards --agent to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--agent",
        "planner",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          agent: "planner",
        }),
      );
    });

    it("forwards supported --authority values to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--authority",
        "audited",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          requestedAuthority: "audited",
        }),
      );
    });

    it("forwards destructive --authority to runCommand flags", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "ship",
        "it",
        "--target",
        "test-route",
        "--authority",
        "destructive",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(runCommandMock).toHaveBeenCalledTimes(1);
      expect(runCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "ship it",
        expect.objectContaining({
          target: "test-route",
          requestedAuthority: "destructive",
        }),
      );
    });

    it("dispatches managed-agent commands through the CLI entrypoint", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "managed-agent",
        "list",
        "--session",
        "session-1",
        "--json",
      ];

      await createCli(MOCK_APP_CONFIG);

      expect(managedAgentCommandMock).toHaveBeenCalledTimes(1);
      expect(managedAgentCommandMock).toHaveBeenCalledWith(
        MOCK_APP_CONFIG,
        "list",
        ["--session", "session-1", "--json"],
      );
    });
  });

  describe("help output", () => {
    it("includes direct providers and run options", async () => {
      const output: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        output.push(String(msg));
      });
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "--help",
      ];

      await expect(createCli(MOCK_APP_CONFIG)).rejects.toThrow("process.exit called");

      const text = output.join("\n");
      expect(text).toContain("--target");
      expect(text).toContain("--agent");
      expect(text).not.toContain("--model");
      expect(text).not.toContain("--api-key");

      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it("prints run help without starting a session", async () => {
      const output: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        output.push(String(msg));
      });
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "--help",
      ];

      await expect(createCli(MOCK_APP_CONFIG)).rejects.toThrow("process.exit called");

      const text = output.join("\n");
      expect(text).toContain("Usage: kiln run");
      expect(text).toContain("--target");
      expect(text).not.toContain("--provider");
      expect(text).not.toContain("--api-key");
      expect(text).toContain("--continue");
      expect(text).toContain("--continue-session");
      expect(text).not.toContain("Kiln session starting");

      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it("rejects retired credential overrides instead of treating them as task text", async () => {
      process.argv = [
        process.argv[0] ?? "bun",
        process.argv[1] ?? "kiln",
        "run",
        "--api-key",
        "secret",
        "do work",
      ];

      await expect(createCli(MOCK_APP_CONFIG)).rejects.toThrow(
        "Operator execution accepts target identity, not provider, model, or credential overrides",
      );
      expect(runCommandMock).not.toHaveBeenCalled();
    });
  });

  describe("session mode resolution", () => {
    it("determines api-key mode with --api-key", async () => {
      const config = makeConfig({ mode: "api-key", apiKey: "sk-ant-test" });
      const manager = new SessionManager(config, MOCK_APP_CONFIG, MOCK_CACHE);
      const ctx = await manager.prepare("Fix bug", process.cwd());

      expect(ctx.mode).toBe("api-key");
    });

    it("determines byok mode with --api-key + --provider", async () => {
      const config = makeConfig({
        mode: "byok",
        apiKey: "sk-test",
        provider: "openai",
      });
      const manager = new SessionManager(config, MOCK_APP_CONFIG, MOCK_CACHE);
      const ctx = await manager.prepare("Fix bug", process.cwd());

      expect(ctx.mode).toBe("byok");
    });
  });

  describe("session lifecycle", () => {
    it("calls prepare -> cleanup in order", async () => {
      const config = makeConfig();
      const manager = new SessionManager(config, MOCK_APP_CONFIG, MOCK_CACHE);

      const ctx = await manager.prepare("Add tests", process.cwd());
      expect(ctx.task).toBe("Add tests");
      expect(ctx.domain).toBeTruthy();
      expect(ctx.mcpServerEntryPath).toBeTruthy();

      const report = manager.cleanup({ sessionId: "session-123", terminalPhase: "completed" });
      expect(report.sessionId).toBe("session-123");
      expect(report.task).toBe("Add tests");
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
      const manager = new SessionManager(config, MOCK_APP_CONFIG, MOCK_CACHE);

      const ctx = await manager.prepare("", process.cwd());
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
