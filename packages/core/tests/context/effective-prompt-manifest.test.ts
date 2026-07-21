import { describe, expect, it } from "vitest";
import {
  buildEffectivePromptManifest,
  estimateTextTokens,
  sha256ContentIdentity,
  toEffectivePromptEvidence,
} from "../../src/index.js";

describe("buildEffectivePromptManifest", () => {
  it("preserves component ordering and produces a deterministic sha256 prompt hash", () => {
    const input = {
      components: [
        {
          id: "system-policy",
          revision: "policy-v1",
          scope: "static" as const,
          content: "System policy.",
          provenance: { source: "policy" },
        },
        {
          id: "retrieved-memory",
          revision: "memory-v2",
          scope: "dynamic" as const,
          content: "Retrieved memory.",
          provenance: { source: "memory" },
        },
      ],
    };

    const first = buildEffectivePromptManifest(input);
    const second = buildEffectivePromptManifest(input);

    expect(first.components.map((component) => component.id)).toEqual([
      "system-policy",
      "retrieved-memory",
    ]);
    expect(first.finalPrompt).toBe("System policy.Retrieved memory.");
    expect(first.finalPromptHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.finalPromptHash).toBe(second.finalPromptHash);
    expect(first).toEqual(second);
  });

  it("preserves temporal-only explicit fragments without adding governed-context framing", () => {
    const temporalFragment = "\n\n--- Turn Temporal Context ---\n2026-07-21T00:00:00Z";
    const manifest = buildEffectivePromptManifest({
      components: [{
        id: "turn-temporal-context",
        revision: "turn-1",
        scope: "dynamic",
        content: temporalFragment,
        provenance: { source: "turn-temporal-context" },
      }],
    });

    expect(manifest.finalPrompt).toBe(temporalFragment);
    expect(manifest.finalPrompt).not.toContain("Governed Context");
  });

  it("preserves admitted and deferred provenance while omitting deferred content", () => {
    const manifest = buildEffectivePromptManifest({
      components: [
        {
          id: "context:admitted",
          revision: "memory-v1",
          scope: "dynamic",
          content: "Admitted context.",
          provenance: {
            source: "projected-context",
            contextBlockId: "context:admitted",
            contextSource: "memory-store",
            auditDecision: "admitted",
          },
        },
        {
          id: "context:deferred",
          revision: "artifact-v1",
          scope: "deferred",
          estimatedTokens: 4,
          provenance: {
            source: "projected-context",
            contextBlockId: "context:deferred",
            contextSource: "artifact-store",
            auditDecision: "deferred",
          },
        },
      ],
    });

    expect(manifest.components[0]).toMatchObject({
      scope: "dynamic",
      content: "Admitted context.",
      provenance: { auditDecision: "admitted" },
    });
    expect(manifest.components[1]).toEqual(expect.objectContaining({
      scope: "deferred",
      estimatedTokens: 4,
      provenance: expect.objectContaining({ auditDecision: "deferred" }),
    }));
    expect(manifest.components[1]).not.toHaveProperty("content");
  });

  it("does not include deferred components in the final prompt or hash", () => {
    const admittedOnly = buildEffectivePromptManifest({
      components: [{
        id: "base",
        revision: "v1",
        scope: "static",
        content: "Base prompt.",
        provenance: { source: "base" },
      }],
    });
    const withDeferred = buildEffectivePromptManifest({
      components: [
        {
          id: "base",
          revision: "v1",
          scope: "static",
          content: "Base prompt.",
          provenance: { source: "base" },
        },
        {
          id: "deferred",
          revision: "v1",
          scope: "deferred",
          provenance: { source: "context" },
        },
      ],
    });

    expect(withDeferred.finalPrompt).toBe(admittedOnly.finalPrompt);
    expect(withDeferred.finalPromptHash).toBe(admittedOnly.finalPromptHash);
  });

  it("redacts all raw prompt content from evidence", () => {
    const manifest = buildEffectivePromptManifest({
      components: [{
        id: "private-component-id",
        revision: "private-revision",
        scope: "static",
        content: "Private base instructions.",
        provenance: {
          source: "private-policy-source",
          contextBlockId: "private-context-block",
          contextSource: "private-context-source",
          auditDecision: "admitted",
        },
      }],
    });
    const evidence = toEffectivePromptEvidence(manifest);
    const serialized = JSON.stringify(evidence);

    expect(evidence).not.toHaveProperty("finalPrompt");
    expect(serialized).not.toContain("Private base instructions.");
    expect(serialized).not.toContain("private-component-id");
    expect(serialized).not.toContain("private-revision");
    expect(serialized).not.toContain("private-policy-source");
    expect(serialized).not.toContain("private-context-block");
    expect(serialized).not.toContain("private-context-source");
    expect(evidence.components[0]).toMatchObject({
      id: sha256ContentIdentity("private-component-id"),
      revision: sha256ContentIdentity("private-revision"),
      provenance: {
        source: sha256ContentIdentity("private-policy-source"),
        contextBlockId: sha256ContentIdentity("private-context-block"),
        contextSource: sha256ContentIdentity("private-context-source"),
        auditDecision: "admitted",
      },
    });
  });

  it("uses valid estimates for final prompt and every component", () => {
    const manifest = buildEffectivePromptManifest({
      components: [{
        id: "base",
        revision: "v1",
        scope: "static",
        content: "Base instructions.",
        provenance: { source: "base" },
      }],
    });

    expect(manifest.estimatedTokens).toBe(estimateTextTokens(manifest.finalPrompt));
    expect(manifest.components.every((component) => (
      Number.isInteger(component.estimatedTokens) && component.estimatedTokens >= 0
    ))).toBe(true);
  });

  it.each([
    ["empty ids", [{ id: "", revision: "v1", scope: "static", content: "x", provenance: { source: "test" } }], "id"],
    ["blank revisions", [{ id: "component", revision: " ", scope: "static", content: "x", provenance: { source: "test" } }], "revision"],
    ["duplicate ids", [
      { id: "component", revision: "v1", scope: "static", content: "x", provenance: { source: "test" } },
      { id: "component", revision: "v2", scope: "dynamic", content: "y", provenance: { source: "test" } },
    ], "duplicate"],
    ["negative supplied estimates", [{ id: "component", revision: "v1", scope: "static", content: "x", estimatedTokens: -1, provenance: { source: "test" } }], "estimatedTokens"],
    ["fractional supplied estimates", [{ id: "component", revision: "v1", scope: "static", content: "x", estimatedTokens: 1.5, provenance: { source: "test" } }], "estimatedTokens"],
  ])("rejects %s", (_label, components, expectedMessage) => {
    expect(() => buildEffectivePromptManifest({
      components: components as never,
    })).toThrow(expectedMessage);
  });
});
