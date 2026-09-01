import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as Record<string, unknown>;
}

describe("context efficiency diagnostic preregistration", () => {
  it("freezes all required task classes and the completed Slice 2 baseline", () => {
    const manifest = readJson("docs/benchmarks/context-efficiency-diagnostic-v1/manifest.json");
    const tasks = manifest.tasks as readonly { readonly id: string; readonly conditions: readonly string[] }[];
    const readiness = manifest.collectionReadiness as { readonly status: string; readonly missing: readonly string[] };

    expect(manifest.schemaVersion).toBe("kiln-context-efficiency-diagnostic-manifest-v1");
    expect(manifest.status).toBe("baseline_frozen");
    expect(tasks.map((task) => task.id)).toEqual([
      "trivial_exact",
      "repository_read_only",
      "bounded_implementation",
      "tool_result_heavy",
      "ordinary_conversation_heavy",
      "managed_agent_enabled",
    ]);
    expect(new Set(tasks.flatMap((task) => task.conditions))).toEqual(
      new Set(["cold", "immediate_warm", "long_session"]),
    );
    expect(readiness).toMatchObject({
      status: "baseline_frozen",
      missing: [],
      lastAttempt: {
        status: "baseline_frozen",
        logicalRows: 33,
        validRows: 33,
        invalidRows: 0,
        completedCells: 11,
        expectedCells: 11,
        physicalModelTransports: 106,
        failureRows: 30,
        verdict: "diagnostic-only",
      },
    });
  });

  it("binds the generated tool-result workload to its declared size and checksum", () => {
    const fixture = readJson(
      "packages/core/evals/fixtures/context-efficiency-diagnostic-v1/tool-result-generation.json",
    );
    const shardCount = fixture.shardCount as number;
    const linesPerShard = fixture.linesPerShard as number;
    let content = "";
    for (let shard = 1; shard <= shardCount; shard += 1) {
      for (let line = 1; line <= linesPerShard; line += 1) {
        content += `shard-${String(shard).padStart(2, "0")}:line-${String(line).padStart(4, "0")}:kiln-context-efficiency-diagnostic-v1\n`;
      }
    }

    expect(Buffer.byteLength(content, "utf8")).toBe(fixture.orderedConcatenationBytes);
    expect(`sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`)
      .toBe(fixture.orderedConcatenationSha256);
  });

  it("freezes an eight-turn no-tool conversation oracle", () => {
    const fixture = readJson(
      "packages/core/evals/fixtures/context-efficiency-diagnostic-v1/conversation-script.json",
    );
    expect(fixture.toolPolicy).toBe("forbidden");
    expect(fixture.turns).toHaveLength(8);
    expect(fixture.finalNonce).toBe("KILN-7F3A");
    expect(fixture.requiredFinalTerms).toHaveLength(6);
  });
});
