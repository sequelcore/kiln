import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/wrapper/session-manager.js";
import type { WrapperConfig } from "../../src/wrapper/index.js";
import type { KilnAppConfig } from "../../src/config.js";
import { DomainRegistry } from "@kilnai/core";
import type { QualityGate, VerificationResult } from "@kilnai/core";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
}));

const MOCK_WRAPPER_CONFIG: WrapperConfig = {
  mode: "api-key",
  permissionPolicy: { approval: "ask", sandbox: "none" },
};

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () =>
    new DomainRegistry({ builtinConfigs: [], domainsDir: ".kiln/domains" }),
  buildSystemPrompt: () => "<kiln-session/>",
  mcpServerName: "kiln",
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
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG);
      await manager.prepare("task", "/project");

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
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG);
      await manager.prepare("task", "/project");

      const gates: readonly QualityGate[] = [
        { name: "lint", command: 'node -e "process.exit(1)"', description: "Lint", required: true },
      ];

      const result = await manager.runVerification(gates, process.cwd());

      expect(result.passed).toBe(false);
      expect(result.checks[0]!.passed).toBe(false);
      expect(result.checks[0]!.name).toBe("lint");
    });

    it("returns empty checks when gates array is empty", async () => {
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG);
      await manager.prepare("task", "/project");

      const result = await manager.runVerification([], process.cwd());

      expect(result.checks.length).toBe(0);
    });
  });

  describe("cleanup() with verification result", () => {
    it("includes verification result in report when provided", async () => {
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG);
      await manager.prepare("task", "/project");

      const verificationResult: VerificationResult = {
        passed: true,
        checks: [
          { name: "lint", passed: true, output: "ok", duration: 120 },
        ],
        iteration: 1,
        maxIterations: 1,
      };

      const report = manager.cleanup("session-1", 0, verificationResult);

      expect(report.verificationResult).toBeDefined();
      expect(report.verificationResult!.passed).toBe(true);
      expect(report.verificationResult!.checks.length).toBe(1);
      expect(report.verificationResult!.checks[0]!.name).toBe("lint");
    });

    it("omits verification result when not provided", async () => {
      const manager = new SessionManager(MOCK_WRAPPER_CONFIG, MOCK_APP_CONFIG);
      await manager.prepare("task", "/project");

      const report = manager.cleanup("session-1", 0);

      expect(report.verificationResult).toBeUndefined();
    });
  });
});
