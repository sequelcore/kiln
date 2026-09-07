import { expect, test } from "vitest";
import { DefaultContextGovernor } from "../../packages/core/src/context/index.js";
import { ReversibleContextProjectionService } from "../../packages/core/src/efficiency/index.js";
import { MemoryArtifactResourceStore } from "../../packages/core/src/tools/index.js";
import type { CodeIntelligenceRequest } from "../../packages/core/src/tools/domain/code-intelligence.js";
import type { ReferenceEvidence } from "./reference-adapter.js";
import { createReferenceProjection, verifyCurrentReferenceEvidence } from "./reference-projection.js";

const request: CodeIntelligenceRequest = { operation: "references", workspaceRoot: "fixture", path: "a.ts", limit: 10 };
function evidence(disposition: ReferenceEvidence["disposition"] = "complete"): ReferenceEvidence {
  return {
    operation: "references",
    disposition,
    reasons: disposition === "complete" ? [] : ["fixture-reason"],
    entries: [
      {
        kind: "location",
        path: "a.ts",
        sourceHash: "source",
        symbol: "f",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
    ],
    scope: "configured-project-only",
    workspaceId: "fixture",
    revision: "revision",
    sourceDigest: "sources",
    dirtyStateDigest: "dirty",
    compilerVersion: "fixture",
    compilerInputDigest: "compiler",
    capabilities: ["references"],
    omittedCount: disposition === "partial" ? 2 : 0,
    diagnosticCodes: disposition === "partial" ? [2307] : [],
    elapsedMs: 1,
    cacheState: "cold",
    project: {
      configPath: "tsconfig.json",
      rootFiles: ["a.ts"],
      compilerOptionsDigest: "options",
      inputDigest: "inputs",
      options: { strict: true },
      inputs: Array.from({ length: 100 }, (_, i) => ({ path: `input-${i}.ts`, hash: "a".repeat(64) })),
    },
  };
}
function setup() {
  return new ReversibleContextProjectionService({ store: new MemoryArtifactResourceStore() });
}
function reversible(service: ReversibleContextProjectionService, value: ReferenceEvidence) {
  const projection = createReferenceProjection(service, request, value, () => true);
  const option = projection.candidate.projectionOptions?.find((entry) => entry.mode === "reversible");
  if (!option?.retrievalHandle) throw new Error("missing-reversible-option");
  return { ...projection, option, handle: option.retrievalHandle };
}

test("governor admits compact references with every location, and retrieval restores exact response", () => {
  const service = setup();
  const value = evidence();
  const projection = reversible(service, value);
  const selected = new DefaultContextGovernor().project({
    artifacts: [projection.candidate],
    artifactProjectionPreference: "reversible",
    tokenBudget: 10000,
  });
  expect(selected.blocks[0]?.content).toBe(projection.option.content);
  expect(projection.option.content).toContain("Canonical evidence is omitted");
  expect(projection.summary.entries).toEqual(value.entries);
  expect(projection.summary.project?.deferredInputCount).toBe(100);
  expect(projection.option.content).not.toContain("input-99.ts");
  expect(Buffer.byteLength(projection.option.content)).toBeLessThan(Buffer.byteLength(JSON.stringify(value)));
  expect(service.retrieve(projection.handle)).toMatchObject({ status: "available", artifact: projection.artifact });
  expect(projection.referenceEvidenceJson).toBe(JSON.stringify(value));
});

test.each(["partial", "failed", "unsupported"] as const)("%s state is never disguised by compaction", (state) => {
  const value = evidence(state);
  const projection = reversible(setup(), value);
  expect(projection.summary).toMatchObject({
    disposition: state,
    reasons: value.reasons,
    omittedCount: value.omittedCount,
    diagnosticCodes: value.diagnosticCodes,
  });
  expect(projection.artifact.exitStatus).toBe(1);
  expect(projection.option.content).toContain(JSON.stringify(value.reasons));
});

test("canonical integrity and workspace freshness must both verify", () => {
  const service = setup();
  const projection = reversible(service, evidence());
  expect(
    verifyCurrentReferenceEvidence(service, projection.handle, projection.option.sourceHash, () => true).verified,
  ).toBe(true);
  expect(verifyCurrentReferenceEvidence(service, projection.handle, projection.option.sourceHash, () => false)).toEqual(
    { verified: false, reason: "stale-workspace" },
  );
  expect(verifyCurrentReferenceEvidence(service, projection.handle, "wrong-hash", () => true)).toMatchObject({
    verified: false,
    reason: "source-hash-mismatch",
  });
  expect(
    verifyCurrentReferenceEvidence(setup(), projection.handle, projection.option.sourceHash, () => true),
  ).toMatchObject({ verified: false, reason: "canonical-evidence-unavailable" });
});

test("staleness is visible at projection and required evidence stays full on overflow", () => {
  const projection = createReferenceProjection(setup(), request, evidence(), () => false, true);
  expect(projection.summary.currentAtProjection).toBe(false);
  expect(projection.artifact.warnings).toContain("stale-workspace-at-projection");
  expect(projection.artifact.exitStatus).toBe(1);
  const selected = new DefaultContextGovernor().project({
    artifacts: [projection.candidate],
    artifactProjectionPreference: "reversible",
    tokenBudget: 1,
  });
  expect(selected.overflow).toBe(true);
  expect(selected.blocks[0]?.projectionEvidence?.mode).toBe("full");
  expect(selected.blocks[0]?.content).toContain("input-99.ts");
});
