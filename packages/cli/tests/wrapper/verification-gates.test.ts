import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/wrapper/session-manager.js";
import type { WrapperConfig } from "../../src/wrapper/index.js";
import type { KilnAppConfig } from "../../src/config.js";
import { DomainRegistry, type QualityGate } from "@kilnai/core/domain";
import { type ContextArtifactCache, InMemoryContextArtifactCache } from "@kilnai/core/memory";
import type { VerificationResult } from "@kilnai/core/quality-gates";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(() => ""),
  };
});

const MOCK_CACHE: ContextArtifactCache = new InMemoryContextArtifactCache();

const MOCK_WRAPPER_CONFIG: WrapperConfig = {
  mode: "api-key",
  permissionPolicy: { approval: "on-request", sandbox: "read-only" },
};

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () =>
    new DomainRegistry({ builtinConfigs: [] }),
  buildSystemPrompt: () => "<kiln-session/>",
};

describe("verification-gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runVerification()", () => {
    it("returns passed:true when all gate commands succeed", async () => {
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      await manager.prepare("task", process.cwd());

      const gates: readonly QualityGate[] = [
        { name: "lint", command: 'node -e "process.exit(0)"', description: "Lint", required: true },
      ];

      const result = await manager.runVerification(gates, process.cwd());

      expect(result.passed).toBe(true);
      expect(result.checks.length).toBe(1);
      expect(result.checks[0]!.name).toBe("lint");
      expect(result.checks[0]!.passed).toBe(true);
    });

    it("returns passed:false when a required gate fails", async () => {
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      await manager.prepare("task", process.cwd());

      const gates: readonly QualityGate[] = [
        { name: "lint", command: 'node -e "process.exit(1)"', description: "Lint", required: true },
      ];

      const result = await manager.runVerification(gates, process.cwd());

      expect(result.passed).toBe(false);
      expect(result.checks[0]!.passed).toBe(false);
      expect(result.checks[0]!.name).toBe("lint");
    });

    it("returns empty checks when gates array is empty", async () => {
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      await manager.prepare("task", process.cwd());

      const result = await manager.runVerification([], process.cwd());

      expect(result.checks.length).toBe(0);
    });
  });

  describe("cleanup() with verification result", () => {
    it("includes verification result in report when provided", async () => {
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      await manager.prepare("task", process.cwd());

      const verificationResult: VerificationResult = {
        passed: true,
        checks: [
          { name: "lint", passed: true, output: "ok", duration: 120 },
        ],
        iteration: 1,
        maxIterations: 1,
      };

      const report = manager.cleanup({ sessionId: "session-1", terminalPhase: "completed", totalCostUsd: 0, verificationResult });

      expect(report.verificationResult).toBeDefined();
      expect(report.verificationResult!.passed).toBe(true);
      expect(report.verificationResult!.checks.length).toBe(1);
      expect(report.verificationResult!.checks[0]!.name).toBe("lint");
    });

    it("omits verification result when not provided", async () => {
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG, MOCK_CACHE);
      await manager.prepare("task", process.cwd());

      const report = manager.cleanup({ sessionId: "session-1", terminalPhase: "completed", totalCostUsd: 0 });

      expect(report.verificationResult).toBeUndefined();
    });
  });
});
