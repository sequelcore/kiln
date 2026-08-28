import { describe, expect, it, vi } from "vitest";
import { win32 } from "node:path";
import {
  buildHarnessDoctorReport,
  renderHarnessDoctorText,
  type HarnessDoctorModelDiscovery,
} from "../../src/application/harness-doctor.js";
import type { TrustedExecutionIntegrity } from "@kilnai/gateway-contracts";

const { delimiter, join } = win32;

function createDiscovery(overrides: Partial<HarnessDoctorModelDiscovery> = {}): HarnessDoctorModelDiscovery {
  return {
    claudeModels: ["claude-fable-5[1m]"],
    claudeDiscovery: {
      models: ["claude-fable-5[1m]"],
      status: "available",
      reason: "Claude Code models discovered.",
      authState: "authenticated",
    },
    codexModels: ["gpt-5.4-mini"],
    codexDiscovery: {
      models: ["gpt-5.4-mini"],
      status: "available",
      reason: "Codex models discovered.",
      authState: "authenticated",
    },
    opencodeModels: ["opencode/minimax-m2.5-free"],
    opencodeDiscovery: {
      models: ["opencode/minimax-m2.5-free"],
      status: "available",
      reason: "OpenCode models discovered.",
      authState: "authenticated",
    },
    ...overrides,
  };
}

function permissionIntegrity(): TrustedExecutionIntegrity {
  return {
    harness: "codex",
    desired: {
      profile: "trusted-full-access",
      source: "operator-local-config",
      observedAt: "2026-07-01T15:00:00.000Z",
      verifiedAt: "2026-07-01T15:00:01.000Z",
      freshness: "current",
      proof: "proven",
    },
    persistedNative: {
      profile: "restricted",
      source: "native-config",
      observedAt: "2026-07-01T15:01:00.000Z",
      verifiedAt: "2026-07-01T15:01:01.000Z",
      freshness: "current",
      proof: "proven",
      projectionOwnership: "kiln-managed",
    },
    effectiveRuntime: {
      profile: "workspace-write",
      source: "runtime-observation",
      observedAt: "2026-07-01T15:02:00.000Z",
      verifiedAt: "2026-07-01T15:02:01.000Z",
      freshness: "current",
      proof: "proven",
    },
    enforcement: {
      approvalControl: "enforced",
      filesystemSandbox: "enforced",
      networkBoundary: "enforced",
      strength: "strong",
    },
    authorization: {
      status: "authorized",
      scope: "operator-local",
      authorizedBy: "operator",
      authorizedAt: "2026-07-01T14:59:00.000Z",
      revocable: true,
    },
    semanticLoss: [],
    semanticLimitations: [],
    limitationAcceptances: [],
    classification: "runtime-policy-mismatch",
    recommendation: "Restart the child with a proven Full Access runtime or choose a narrower trusted profile.",
    remediationRequiresApproval: true,
    lastVerifiedAt: "2026-07-01T15:02:01.000Z",
  };
}

describe("harness doctor", () => {
  it("reports canonical executable, version, auth, models, and competing PATH entries", async () => {
    const npmDir = "C:\\Users\\ExampleUser\\AppData\\Roaming\\npm";
    const wingetDir = "C:\\Users\\ExampleUser\\AppData\\Local\\Microsoft\\WinGet\\Links";
    const env = {
      USERPROFILE: "C:\\Users\\ExampleUser",
      PATH: [npmDir, wingetDir].join(delimiter),
    };
    const existing = new Set([
      join("C:\\Users\\ExampleUser", ".local", "bin", "claude.exe"),
      join(npmDir, "codex.cmd"),
      join(wingetDir, "codex.exe"),
    ]);

    const report = await buildHarnessDoctorReport({
      env,
      platform: "win32",
      fileExists: (path) => existing.has(path),
      runVersion: vi.fn(async (path) => {
        if (path.endsWith("claude.exe")) return "2.1.220 (Claude Code)";
        return path.endsWith("codex.cmd") ? "codex-cli 0.142.0" : "codex app 0.140.0";
      }),
      discoverModels: vi.fn(async () => createDiscovery()),
      readConfigProjections: vi.fn(async () => []),
    });

    expect(report.harnesses.codex).toMatchObject({
      harnessId: "codex",
      status: "available",
      canonicalExecutable: join(npmDir, "codex.cmd"),
      version: "codex-cli 0.142.0",
      authState: "authenticated",
      models: ["gpt-5.4-mini"],
    });
    expect(report.harnesses.codex.competingExecutables).toEqual([join(wingetDir, "codex.exe")]);
    expect(report.harnesses.codex.warnings).toContain(
      `Competing codex executable on PATH: ${join(wingetDir, "codex.exe")}`,
    );
    expect(report.harnesses.claude).toMatchObject({
      harnessId: "claude",
      status: "available",
      version: "2.1.220 (Claude Code)",
      authState: "authenticated",
      models: ["claude-fable-5[1m]"],
    });
  });

  it("does not treat a globally installed old kiln command as a repair action", async () => {
    const npmDir = "C:\\Users\\ExampleUser\\.bun\\bin";
    const sourceBin = "C:\\workspace\\kiln\\packages\\cli\\src";
    const env = {
      USERPROFILE: "C:\\Users\\ExampleUser",
      PATH: [npmDir, sourceBin].join(delimiter),
    };
    const existing = new Set([
      join(npmDir, "kiln.exe"),
    ]);

    const report = await buildHarnessDoctorReport({
      env,
      platform: "win32",
      projectRoot: "C:\\workspace\\kiln",
      fileExists: (path) => existing.has(path),
      runVersion: vi.fn(async () => "kiln 0.1.0"),
      discoverModels: vi.fn(async () => createDiscovery()),
      readConfigProjections: vi.fn(async () => []),
    });

    expect(report.kilnCli).toMatchObject({
      canonicalExecutable: join(npmDir, "kiln.exe"),
      status: "available",
      version: "kiln 0.1.0",
    });
    expect(report.kilnCli.repairActions).toEqual([]);
  });

  describe("kiln CLI source linkage", () => {
    const npmDir = "C:\\Users\\ExampleUser\\.bun\\bin";
    const checkout = "C:\\workspace\\kiln";

    async function reportFor(overrides: {
      readonly projectRoot?: string;
      readonly runningModulePath: string;
      readonly readPackageName?: (manifestPath: string) => string | undefined;
    }) {
      return buildHarnessDoctorReport({
        env: { USERPROFILE: "C:\\Users\\ExampleUser", PATH: npmDir },
        platform: "win32",
        projectRoot: overrides.projectRoot,
        runningModulePath: overrides.runningModulePath,
        readPackageName: overrides.readPackageName
          ?? ((manifestPath) =>
            manifestPath === join(checkout, "packages", "cli", "package.json")
              ? "@kilnai/cli"
              : undefined),
        fileExists: (path) => path === join(npmDir, "kiln.exe"),
        runVersion: vi.fn(async () => "kiln 3.0.0"),
        discoverModels: vi.fn(async () => createDiscovery()),
        readConfigProjections: vi.fn(async () => []),
      });
    }

    it("reports a detached build when the running entrypoint is outside the checkout", async () => {
      const entrypoint = "C:\\Users\\ExampleUser\\.bun\\install\\global\\node_modules\\@kilnai\\cli\\dist\\index.js";
      const report = await reportFor({ projectRoot: checkout, runningModulePath: entrypoint });

      expect(report.kilnCli.sourceLinkage).toBe("detached-from-checkout");
      expect(report.kilnCli.runningModulePath).toBe(entrypoint);
      expect(report.kilnCli.warnings).toContainEqual(expect.stringContaining("outside this kiln checkout"));
      expect(report.kilnCli.repairActions).toContainEqual(
        expect.stringContaining(join(checkout, "packages", "cli")),
      );
    });

    it("reports a linked build when the running entrypoint is inside the checkout", async () => {
      const report = await reportFor({
        projectRoot: checkout,
        runningModulePath: join(checkout, "packages", "cli", "dist", "index.js"),
      });

      expect(report.kilnCli.sourceLinkage).toBe("linked-to-checkout");
      expect(report.kilnCli.warnings).toEqual([]);
      expect(report.kilnCli.repairActions).toEqual([]);
    });

    it("stays silent outside a kiln checkout, where an installed build is correct", async () => {
      const report = await reportFor({
        projectRoot: "C:\\workspace\\unrelated-app",
        runningModulePath: "C:\\Users\\ExampleUser\\.bun\\install\\global\\node_modules\\@kilnai\\cli\\dist\\index.js",
      });

      expect(report.kilnCli.sourceLinkage).toBe("not-a-kiln-checkout");
      expect(report.kilnCli.warnings).toEqual([]);
      expect(report.kilnCli.repairActions).toEqual([]);
    });

    it("identifies a checkout by its CLI manifest, not by folder name", async () => {
      const report = await reportFor({
        projectRoot: checkout,
        runningModulePath: "C:\\elsewhere\\dist\\index.js",
        readPackageName: () => "some-other-package",
      });

      expect(report.kilnCli.sourceLinkage).toBe("not-a-kiln-checkout");
      expect(report.kilnCli.warnings).toEqual([]);
    });
  });

  it("renders a read-only human report", async () => {
    const integrity = permissionIntegrity();
    const report = await buildHarnessDoctorReport({
      env: { USERPROFILE: "C:\\Users\\ExampleUser", PATH: "" },
      platform: "win32",
      fileExists: () => false,
      runVersion: vi.fn(async () => undefined),
      readConfigProjections: vi.fn(async () => [{
        targetId: "workflow-snapshot:manifest",
        kind: "workflow-snapshot" as const,
        status: "current",
        path: "C:\\Users\\ExampleUser\\.kiln\\projects\\id\\projections\\workflow-snapshot-manifest.json",
      }, {
        targetId: "codex-config",
        kind: "native" as const,
        status: "managed",
        path: "C:\\Users\\ExampleUser\\.codex\\config.toml",
        permissionIntegrity: integrity,
      }]),
      discoverModels: vi.fn(async () => createDiscovery({
        codexDiscovery: {
          models: [],
          status: "cli_missing",
          reason: "Codex CLI executable was not found.",
          authState: "not_required",
        },
      })),
    });

    const output = renderHarnessDoctorText(report);

    expect(output).toContain("Kiln Harness Doctor");
    expect(output).toContain("Mode: read-only diagnostics");
    expect(output).toContain("codex");
    expect(output).toContain("Claude Code");
    expect(output).toContain("Codex CLI executable was not found.");
    expect(output).toContain("Config projections:");
    expect(output).toContain("workflow-snapshot:manifest: current");
    expect(output).toContain("Permission integrity:");
    expect(output).toContain("codex: runtime-policy-mismatch");
    expect(output).toContain("desired=trusted-full-access");
    expect(output).toContain("persisted=restricted");
    expect(output).toContain("effective=workspace-write");
    expect(output).toContain("enforcement=strong");
    expect(output).toContain("approval required=yes");
    expect(output).toContain("Restart the child with a proven Full Access runtime");
    expect(output).not.toContain("repair:");
  });
});
