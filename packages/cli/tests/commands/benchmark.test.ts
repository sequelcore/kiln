import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KILN_BENCHMARK_PROFILES } from "@kilnai/core";
import { benchmarkCommand } from "../../src/commands/benchmark.js";

const MOCK_APP_CONFIG = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Test",
  createRegistry: () => {
    throw new Error("createRegistry not called in benchmark tests");
  },
  mcpServerName: "kiln",
};

describe("benchmarkCommand", () => {
  let root: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kiln-benchmark-command-"));
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it("prints benchmark-facing profiles", async () => {
    await benchmarkCommand(MOCK_APP_CONFIG, "profiles", []);

    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as unknown[];
    expect(printed).toHaveLength(KILN_BENCHMARK_PROFILES.length);
    expect(printed[0]).toMatchObject({
      id: "kiln-tool-agent",
      version: "1",
    });
  });

  it("prints readiness from baseline file", async () => {
    const profile = KILN_BENCHMARK_PROFILES[0]!;
    const baselinePath = join(root, "baseline.json");
    writeFileSync(
      baselinePath,
      JSON.stringify({
        baselines: [{
          profileId: profile.id,
          profileVersion: profile.version,
          datasetName: "tool-internal",
          datasetVersion: "2026-05-08",
          k: profile.minimumK,
          passAtK: profile.minimumPassAtK,
          scorers: profile.requiredScorers,
          artifactUris: ["kiln://artifacts/eval/tool-internal/result"],
          configHash: "sha256:test",
        }],
      }),
      "utf-8",
    );

    await benchmarkCommand(MOCK_APP_CONFIG, "readiness", ["--baseline", baselinePath]);

    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as {
      readonly profileReadiness: readonly { readonly profileId: string; readonly status: string }[];
    };
    expect(printed.profileReadiness[0]).toMatchObject({
      profileId: "kiln-tool-agent",
      status: "internal-baseline-ready",
    });
  });

  it("fails closed when readiness has no baseline file", async () => {
    await expect(benchmarkCommand(MOCK_APP_CONFIG, "readiness", [])).rejects.toThrow(
      "benchmark readiness requires --baseline <path>.",
    );
  });
});
