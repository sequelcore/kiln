import { describe, expect, it } from "vitest";
import {
  DefaultContextGovernor,
  MemoryArtifactResourceStore,
  ReversibleContextProjectionService,
  type LogArtifact,
} from "../../src/index.js";

function criticalLog(): LogArtifact {
  return {
    kind: "log",
    exitStatus: 1,
    warnings: ["one hidden critical event"],
    entries: Array.from({ length: 16 }, (_, index) => ({
      id: `event-${index}`,
      severity: index === 15 ? "fatal" : "info",
      message: index === 15 ? "HIDDEN_CRITICAL_ITEM" : `routine event ${index}`,
      timestamp: `2026-07-14T09:00:${String(index).padStart(2, "0")}.000Z`,
      source: "runtime/session.ts",
      line: 200 + index,
    })),
  };
}

describe("reversible context projection", () => {
  it("lets ContextGovernor choose a disclosed reversible projection and retrieve exact protected evidence", () => {
    const store = new MemoryArtifactResourceStore({ maxArtifactsPerNamespace: 2 });
    const service = new ReversibleContextProjectionService({ store });
    const candidate = service.createContextCandidate({
      artifact: criticalLog(),
      source: "tool:runtime-log",
      score: 0.8,
    });
    const governor = new DefaultContextGovernor();

    const projected = governor.project({
      artifacts: [candidate],
      artifactProjectionPreference: "reversible",
      tokenBudget: 200,
    });

    expect(projected.blocks).toHaveLength(1);
    expect(projected.blocks[0]?.content).toContain("Canonical evidence is omitted from active context");
    expect(projected.blocks[0]?.content).toContain("Retrieval handle: kiln://artifacts/context-evidence/");
    expect(projected.blocks[0]?.content).not.toContain("HIDDEN_CRITICAL_ITEM");
    expect(projected.blocks[0]?.projectionEvidence).toMatchObject({
      mode: "reversible",
      transformationMode: "reversible",
      omissionDisclosed: true,
    });
    const handle = projected.blocks[0]?.projectionEvidence?.retrievalHandle;
    if (!handle) throw new Error("Expected retrieval handle.");

    const retrieved = service.retrieve(handle);
    expect(retrieved).toMatchObject({ status: "available", artifact: criticalLog() });

    store.put({
      namespace: "context-evidence",
      title: "Transient evidence one",
      mimeType: "text/plain",
      content: { type: "text", text: "one" },
      producer: { kind: "test", name: "unit" },
      retention: { scope: "session", maxArtifacts: 1 },
    });
    store.put({
      namespace: "context-evidence",
      title: "Transient evidence two",
      mimeType: "text/plain",
      content: { type: "text", text: "two" },
      producer: { kind: "test", name: "unit" },
      retention: { scope: "session", maxArtifacts: 1 },
    });
    expect(service.retrieve(handle)).toMatchObject({ status: "available", artifact: criticalLog() });
    expect(service.audit()).toMatchObject({
      retrievalOpportunities: 1,
      attemptedRetrievals: 2,
      successfulRetrievals: 2,
      missedAbsenceFailures: 0,
    });
  });

  it("keeps required evidence full and records absent-evidence probes without fabricating content", () => {
    const service = new ReversibleContextProjectionService({ store: new MemoryArtifactResourceStore() });
    const required = service.createContextCandidate({
      artifact: criticalLog(),
      source: "authority:verification",
      score: 1,
      required: true,
    });
    const governor = new DefaultContextGovernor();
    const projected = governor.project({
      artifacts: [required],
      artifactProjectionPreference: "reversible",
      tokenBudget: 1,
    });

    expect(projected.blocks[0]?.content).toContain("HIDDEN_CRITICAL_ITEM");
    expect(projected.blocks[0]?.projectionEvidence?.mode).toBe("full");
    expect(projected.overflow).toBe(true);

    expect(service.retrieve("kiln://artifacts/context-evidence/artifact_999/content")).toEqual({
      status: "missing",
      retrievalHandle: "kiln://artifacts/context-evidence/artifact_999/content",
      reason: "artifact-not-found",
    });
    expect(service.audit()).toMatchObject({ attemptedRetrievals: 1, missedAbsenceFailures: 1 });
  });

  it("gates citations and sensitive actions on canonical source identity", () => {
    const service = new ReversibleContextProjectionService({ store: new MemoryArtifactResourceStore() });
    const candidate = service.createContextCandidate({ artifact: criticalLog(), source: "tool:log" });
    const reversible = candidate.projectionOptions?.find((option) => option.mode === "reversible");
    if (!reversible?.retrievalHandle) throw new Error("Expected reversible evidence.");

    expect(service.verifyCanonicalEvidence({
      retrievalHandle: reversible.retrievalHandle,
      expectedSourceHash: reversible.sourceHash,
      purpose: "citation",
    })).toEqual({
      verified: true,
      purpose: "citation",
      retrievalHandle: reversible.retrievalHandle,
      sourceHash: reversible.sourceHash,
    });
    expect(service.verifyCanonicalEvidence({
      retrievalHandle: reversible.retrievalHandle,
      expectedSourceHash: "sha256:tampered",
      purpose: "sensitive-action",
    })).toMatchObject({
      verified: false,
      purpose: "sensitive-action",
      reason: "source-hash-mismatch",
    });
  });
});
