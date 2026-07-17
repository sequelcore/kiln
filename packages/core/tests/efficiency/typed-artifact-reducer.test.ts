import { describe, expect, it } from "vitest";
import {
  reduceTypedArtifact,
  restoreTypedArtifact,
  type TypedArtifact,
} from "../../src/efficiency/index.js";

const COMMON = {
  exitStatus: 1,
  warnings: ["rare warning must survive"],
} as const;

const ARTIFACTS: readonly TypedArtifact[] = [
  {
    kind: "search",
    ...COMMON,
    entries: Array.from({ length: 12 }, (_, index) => ({
      id: `match-${index}`,
      path: `src/module-${index}.ts`,
      line: index + 1,
      column: 3,
      match: index === 11 ? "RARE_CRITICAL_SIGNAL" : `ordinary match ${index}`,
    })),
  },
  {
    kind: "tree",
    ...COMMON,
    entries: Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index}`,
      path: `packages/pkg-${index}/src/index.ts`,
      entryKind: "file" as const,
      sizeBytes: 100 + index,
    })),
  },
  {
    kind: "table",
    ...COMMON,
    columns: ["id", "status", "source"],
    rows: Array.from({ length: 12 }, (_, index) => [
      `row-${index}`,
      index === 11 ? "critical" : "ok",
      `fixture:${index + 1}`,
    ]),
  },
  {
    kind: "json",
    ...COMMON,
    value: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
      `field${index}`,
      { id: `json-${index}`, value: index, enabled: index % 2 === 0 },
    ])),
  },
  {
    kind: "test",
    ...COMMON,
    entries: Array.from({ length: 12 }, (_, index) => ({
      id: `test-${index}`,
      name: `preserves behavior ${index}`,
      status: index === 10 ? "skipped" as const : index === 11 ? "failed" as const : "passed" as const,
      durationMs: index + 0.5,
      file: "tests/adversarial.test.ts",
      line: 20 + index,
      warning: index === 11 ? "failure warning" : null,
    })),
  },
  {
    kind: "log",
    ...COMMON,
    entries: Array.from({ length: 12 }, (_, index) => ({
      id: `log-${index}`,
      severity: index === 11 ? "fatal" as const : "info" as const,
      message: index === 11 ? "RARE_CRITICAL_SIGNAL" : `routine event ${index}`,
      timestamp: `2026-07-14T08:00:${String(index).padStart(2, "0")}.000Z`,
      source: "runtime/session.ts",
      line: 100 + index,
    })),
  },
  {
    kind: "repository",
    ...COMMON,
    entries: Array.from({ length: 12 }, (_, index) => ({
      id: `change-${index}`,
      path: `packages/core/src/file-${index}.ts`,
      changeType: index === 11 ? "deleted" as const : "modified" as const,
      status: index === 11 ? "conflicted" as const : "tracked" as const,
      linesAdded: index,
      linesDeleted: index + 1,
      warning: index === 11 ? "conflict marker detected" : null,
    })),
  },
];

describe("typed lossless artifact reduction", () => {
  it.each(ARTIFACTS.map((artifact) => [artifact.kind, artifact] as const))(
    "round-trips %s artifacts while retaining preservation-critical signals",
    (_kind, artifact) => {
      const result = reduceTypedArtifact({
        artifact,
        canonicalArtifactUri: `kiln://artifacts/raw/${artifact.kind}/content`,
      });

      expect(result.mode).toBe("lossless");
      if (result.mode !== "lossless") throw new Error(`Expected lossless projection, got ${result.reason}.`);
      expect(result).toMatchObject({
        transformationMode: "lossless",
        encoding: "kiln-columnar-json-v1",
        artifactKind: artifact.kind,
        omittedCount: 0,
      });
      expect(result.projectedBytes).toBeLessThan(result.sourceBytes);
      expect(result.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(result.projectionHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(restoreTypedArtifact(result)).toEqual(artifact);
    },
  );

  it("fails open to the canonical artifact for unknown, malformed, or non-beneficial inputs", () => {
    const unknown = { kind: "binary", bytes: [1, 2, 3] };
    expect(reduceTypedArtifact({
      artifact: unknown,
      canonicalArtifactUri: "kiln://artifacts/raw/binary/content",
    })).toEqual({
      mode: "canonical",
      reason: "unknown-artifact-type",
      canonicalArtifactUri: "kiln://artifacts/raw/binary/content",
      canonicalArtifact: unknown,
    });

    const malformed = { kind: "log", ...COMMON, entries: [{ severity: "panic", message: "lost id" }] };
    expect(reduceTypedArtifact({
      artifact: malformed,
      canonicalArtifactUri: "kiln://artifacts/raw/log/content",
    })).toMatchObject({ mode: "canonical", reason: "malformed-artifact", canonicalArtifact: malformed });

    const tiny: TypedArtifact = { kind: "json", exitStatus: 0, warnings: [], value: 1 };
    expect(reduceTypedArtifact({
      artifact: tiny,
      canonicalArtifactUri: "kiln://artifacts/raw/json/content",
    })).toMatchObject({ mode: "canonical", reason: "projection-not-beneficial", canonicalArtifact: tiny });
  });

  it("rejects projection tampering instead of restoring unverifiable evidence", () => {
    const result = reduceTypedArtifact({
      artifact: ARTIFACTS[0],
      canonicalArtifactUri: "kiln://artifacts/raw/search/content",
    });
    if (result.mode !== "lossless") throw new Error("Expected fixture to reduce.");

    expect(() => restoreTypedArtifact({ ...result, projection: `${result.projection} ` }))
      .toThrow("Lossless artifact projection hash mismatch.");
  });
});
