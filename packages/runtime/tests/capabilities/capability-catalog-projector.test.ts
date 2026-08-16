import { describe, expect, it } from "vitest";
import {
  buildCapabilityCatalog,
  type CapabilityCatalogSnapshot,
  type CapabilityDescriptorCandidate,
} from "@kilnai/core/capabilities";
import { CapabilityCatalogProjectionSchema } from "@kilnai/gateway-contracts";
import { projectCapabilityCatalog } from "../../src/capabilities/capability-catalog-projector.js";

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const EVALUATED_AT = "2026-08-14T18:00:00.000Z";

function candidate(overrides: Partial<CapabilityDescriptorCandidate> = {}): CapabilityDescriptorCandidate {
  return {
    capabilityId: "web.search",
    revision: "v1",
    kind: "portable-tool",
    owner: { kind: "kiln", identityDigest: digest("d") },
    inputSchemaDigest: digest("a"),
    outputSchemaDigest: digest("b"),
    artifacts: [{ mediaType: "application/json", schemaDigest: digest("b") }],
    effect: {
      operation: "observe",
      boundaries: ["network", "external-system"],
      reversibility: "reversible",
      dataEgress: "metadata",
      identityUse: "none",
      consequences: [],
      idempotency: "conditionally-idempotent",
    },
    permissions: ["network-access", "external-state"],
    approval: "conditional",
    network: "restricted",
    data: { input: "public", output: "internal", retention: "ephemeral" },
    supportedCallers: ["kiln-runtime"],
    freshness: {
      status: "available",
      observedAt: "2026-08-14T17:00:00.000Z",
      validUntil: "2026-08-14T19:00:00.000Z",
    },
    provenance: { sourceType: "kiln", sourceIdentityDigest: digest("e"), sourceDigest: digest("c") },
    limits: { maxInputBytes: 16_384, maxOutputBytes: 1_048_576, maxDurationMs: 30_000, maxArtifacts: 8 },
    implementationReferences: [{
      identityDigest: digest("8"),
      kind: "runtime-tool",
      inputSchemaDigest: digest("a"),
      outputSchemaDigest: digest("b"),
    }],
    ...overrides,
  };
}

describe("projectCapabilityCatalog", () => {
  it("projects admitted descriptors without implementation or dispatch authority", () => {
    const projection = projectCapabilityCatalog(buildCapabilityCatalog([candidate()], EVALUATED_AT));

    expect(CapabilityCatalogProjectionSchema.parse(projection)).toEqual(projection);
    expect(projection).toMatchObject({
      schema: "kiln.capability-catalog/v1",
      observedAt: EVALUATED_AT,
      entries: [{ capabilityId: "web.search", revision: "v1" }],
      rejections: [],
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("implementationReferences");
    expect(serialized).not.toContain(digest("8"));
    expect(serialized).not.toContain("dispatch");
  });

  it("projects only sanitized ineligibility evidence for rejected candidates", () => {
    const projection = projectCapabilityCatalog(buildCapabilityCatalog([
      candidate({ freshness: { ...candidate().freshness, validUntil: EVALUATED_AT } }),
      { ...candidate({ capabilityId: "image.generate" }), apiToken: "synthetic-secret" },
    ], EVALUATED_AT));

    expect(projection.entries).toEqual([]);
    expect(projection.rejections).toEqual([
      { status: "ineligible", reasons: ["secret-bearing-field"] },
      { capabilityId: "web.search", revision: "v1", descriptorDigest: expect.stringMatching(/^sha256:/u), status: "ineligible", reasons: ["stale-evidence"] },
    ]);
    expect(JSON.stringify(projection)).not.toContain("synthetic-secret");
  });

  it("never projects an identity that also has a malformed observation", () => {
    const projection = projectCapabilityCatalog(buildCapabilityCatalog([
      candidate(),
      { ...candidate(), description: "not-admitted" },
    ], EVALUATED_AT));

    expect(projection.entries).toEqual([]);
    expect(projection.rejections).toEqual([{
      capabilityId: "web.search",
      revision: "v1",
      status: "ineligible",
      reasons: ["duplicate-identity"],
    }]);
  });

  it("rejects a structurally plausible snapshot that was not created by Core", () => {
    const genuine = buildCapabilityCatalog([candidate()], EVALUATED_AT);
    const forged = { ...genuine } as CapabilityCatalogSnapshot;

    expect(() => projectCapabilityCatalog(forged)).toThrow(/Core|catalog snapshot/u);
  });
});
