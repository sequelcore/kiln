import { describe, expect, it, vi } from "vitest";
import { join, delimiter } from "node:path";
import {
  buildHarnessDoctorReport,
  renderHarnessDoctorText,
  type HarnessDoctorModelDiscovery,
} from "../../src/application/harness-doctor.js";

function createDiscovery(overrides: Partial<HarnessDoctorModelDiscovery> = {}): HarnessDoctorModelDiscovery {
  return {
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

describe("harness doctor", () => {
  it("reports canonical executable, version, auth, models, and competing PATH entries", async () => {
    const npmDir = "C:\\Users\\R3XED\\AppData\\Roaming\\npm";
    const wingetDir = "C:\\Users\\R3XED\\AppData\\Local\\Microsoft\\WinGet\\Links";
    const env = {
      USERPROFILE: "C:\\Users\\R3XED",
      PATH: [npmDir, wingetDir].join(delimiter),
    };
    const existing = new Set([
      join(npmDir, "codex.cmd"),
      join(wingetDir, "codex.exe"),
    ]);

    const report = await buildHarnessDoctorReport({
      env,
      fileExists: (path) => existing.has(path),
      runVersion: vi.fn(async (path) => path.endsWith("codex.cmd") ? "codex-cli 0.142.0" : "codex app 0.140.0"),
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
  });

  it("does not treat a globally installed old kiln command as a repair action", async () => {
    const npmDir = "C:\\Users\\R3XED\\.bun\\bin";
    const sourceBin = "C:\\Proyectos\\Sequel\\kiln\\packages\\cli\\src";
    const env = {
      USERPROFILE: "C:\\Users\\R3XED",
      PATH: [npmDir, sourceBin].join(delimiter),
    };
    const existing = new Set([
      join(npmDir, "kiln.exe"),
    ]);

    const report = await buildHarnessDoctorReport({
      env,
      projectRoot: "C:\\Proyectos\\Sequel\\kiln",
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
    expect(report.kilnCli.warnings).toContain(
      "Global kiln may not include local source changes until a release installs a new build.",
    );
  });

  it("renders a read-only human report", async () => {
    const report = await buildHarnessDoctorReport({
      env: { USERPROFILE: "C:\\Users\\R3XED", PATH: "" },
      fileExists: () => false,
      runVersion: vi.fn(async () => undefined),
      readConfigProjections: vi.fn(async () => [{
        targetId: "repo-shim:agents",
        kind: "repo-shim",
        status: "current",
        path: "C:\\repo\\AGENTS.md",
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
    expect(output).toContain("Codex CLI executable was not found.");
    expect(output).toContain("Config projections:");
    expect(output).toContain("repo-shim:agents: current");
    expect(output).not.toContain("repair:");
  });
});
