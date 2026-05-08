import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("runs an internal benchmark profile through the supplied session executor", async () => {
    const datasetPath = join(root, "kiln-tool-agent-v1.jsonl");
    const outputPath = join(root, "baseline.json");
    writeFileSync(
      datasetPath,
      [
        JSON.stringify({
          id: "tool-call",
          input: "Call status.",
          expected: "status",
          metadata: {
            expectedAgentId: "kiln-tool-agent",
            expectedToolCalls: [{ name: "status" }],
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    await benchmarkCommand(
      MOCK_APP_CONFIG,
      "run-internal",
      ["--profile", "kiln-tool-agent", "--dataset", datasetPath, "--k", "1", "--output", outputPath],
      {
        now: () => new Date("2026-05-08T12:00:00.000Z"),
        executeItem: async (_input, context) => ({
          output: `completed ${context.item.id}`,
          durationMs: 10,
          costUsd: 0.01,
          inputTokens: 5,
          outputTokens: 3,
          metadata: {
            activeAgentId: context.profile.id,
            toolCalls: [{ name: "status" }],
          },
        }),
      },
    );

    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf-8")) as {
      readonly baseline: { readonly profileId: string; readonly k: number; readonly passAtK: number };
    };
    expect(written.baseline).toMatchObject({
      profileId: "kiln-tool-agent",
      k: 1,
      passAtK: 1,
    });
  });

  it("projects BFCL input rows into Kiln JSONL datasets", async () => {
    const inputPath = join(root, "bfcl.json");
    const outputPath = join(root, "bfcl-kiln.jsonl");
    writeFileSync(
      inputPath,
      JSON.stringify([
        {
          id: "bfcl-1",
          question: "Find a customer.",
          function: [{ name: "find_customer" }],
          ground_truth: [{ name: "find_customer", arguments: { id: "123" } }],
        },
      ]),
      "utf-8",
    );

    await benchmarkCommand(MOCK_APP_CONFIG, "project-bfcl", ["--input", inputPath, "--output", outputPath]);

    const line = readFileSync(outputPath, "utf-8").trim();
    expect(JSON.parse(line)).toMatchObject({
      id: "bfcl-1",
      metadata: {
        benchmark: "bfcl",
        expectedToolCalls: [{ name: "find_customer", args: { id: "123" } }],
      },
    });
  });
});
