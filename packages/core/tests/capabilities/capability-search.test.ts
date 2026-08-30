import { describe, expect, it } from "vitest";
import {
  buildCapabilityCatalog,
  capabilityDescribe,
  capabilitySearch,
  type CapabilityDescriptorCandidate,
} from "../../src/capabilities/index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const DIGEST_C = `sha256:${"c".repeat(64)}` as const;
const EVALUATED_AT = "2026-08-30T10:00:00.000Z";

function candidate(overrides: Partial<CapabilityDescriptorCandidate> = {}): CapabilityDescriptorCandidate {
  return {
    capabilityId: "web.search",
    revision: "v1",
    kind: "hosted-tool",
    owner: { kind: "service", identityDigest: DIGEST_C },
    inputSchemaDigest: DIGEST_A,
    outputSchemaDigest: DIGEST_B,
    artifacts: [{ mediaType: "application/json", schemaDigest: DIGEST_C }],
    effect: {
      operation: "observe",
      boundaries: ["network"],
      reversibility: "reversible",
      dataEgress: "metadata",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    },
    permissions: ["network-access"],
    approval: "conditional",
    network: "restricted",
    data: { input: "public", output: "internal", retention: "ephemeral" },
    supportedCallers: ["kiln-runtime", "codex"],
    freshness: {
      observedAt: "2026-08-30T09:00:00.000Z",
      validUntil: "2026-08-30T11:00:00.000Z",
      status: "available",
    },
    provenance: { sourceType: "provider", sourceIdentityDigest: DIGEST_A, sourceDigest: DIGEST_C },
    limits: { maxInputBytes: 16_384, maxOutputBytes: 65_536, maxDurationMs: 30_000, maxArtifacts: 2 },
    implementationReferences: [{
      identityDigest: DIGEST_C,
      kind: "provider-tool",
      inputSchemaDigest: DIGEST_A,
      outputSchemaDigest: DIGEST_B,
    }],
    ...overrides,
  };
}

describe("capability.search and capability.describe", () => {
  it("returns a deterministic bounded disclosure independent of catalog tail size", () => {
    const selected = candidate({ capabilityId: "web.search" });
    const small = buildCapabilityCatalog([selected], EVALUATED_AT);
    const large = buildCapabilityCatalog([
      selected,
      ...Array.from({ length: 200 }, (_, index) => candidate({
        capabilityId: `service.tool-${String(index).padStart(3, "0")}`,
      })),
    ], EVALUATED_AT);

    const first = capabilitySearch(small, {
      caller: "kiln-runtime",
      query: "web search",
      evaluatedAt: EVALUATED_AT,
      limit: 1,
    });
    const second = capabilitySearch(large, {
      caller: "kiln-runtime",
      query: "web search",
      evaluatedAt: EVALUATED_AT,
      limit: 1,
    });

    expect(first.descriptors).toEqual(second.descriptors);
    expect(first.descriptors).toHaveLength(1);
    expect(first.descriptors[0]).not.toHaveProperty("implementationReferences");
    expect(first.evidence).toEqual({
      contract: "capability.search/v1",
      catalogDigest: small.catalogDigest,
      requestScopeDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      decision: "selected",
      descriptorDigests: [first.descriptors[0]?.descriptorDigest],
    });
    expect(first.evidence.requestScopeDigest).toBe(
      capabilitySearch(small, {
        caller: "kiln-runtime",
        query: "web search",
        evaluatedAt: EVALUATED_AT,
        limit: 1,
      }).evidence.requestScopeDigest,
    );
    expect(JSON.stringify(first.descriptors)).not.toContain("provider-tool");
  });

  it("filters unsupported callers and stale descriptors before disclosure", () => {
    const catalog = buildCapabilityCatalog([
      candidate({
        capabilityId: "stale.search",
        freshness: {
          observedAt: "2026-08-30T08:00:00.000Z",
          validUntil: EVALUATED_AT,
          status: "available",
        },
      }),
      candidate({ capabilityId: "claude.only", supportedCallers: ["claude"] }),
    ], EVALUATED_AT);

    const result = capabilitySearch(catalog, {
      caller: "codex",
      evaluatedAt: EVALUATED_AT,
      limit: 10,
    });

    expect(result.descriptors).toEqual([]);
    expect(result.evidence.decision).toBe("no-match");
  });

  it("describes only an exact current digest and preserves safety metadata", () => {
    const catalog = buildCapabilityCatalog([candidate()], EVALUATED_AT);
    const descriptor = catalog.descriptors[0]!;

    const described = capabilityDescribe(catalog, {
      caller: "kiln-runtime",
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
      evaluatedAt: EVALUATED_AT,
    });
    const replay = capabilityDescribe(catalog, {
      caller: "kiln-runtime",
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
      evaluatedAt: EVALUATED_AT,
    });

    expect(described).toEqual(replay);
    expect(described.decision).toBe("selected");
    expect(described.descriptor).toMatchObject({
      capabilityId: "web.search",
      descriptorDigest: descriptor.descriptorDigest,
      effect: descriptor.effect,
      permissions: ["network-access"],
      approval: "conditional",
    });
    expect(described.descriptor).not.toHaveProperty("implementationReferences");
    expect(described.evidence).toMatchObject({
      contract: "capability.describe/v1",
      catalogDigest: catalog.catalogDigest,
      decision: "selected",
      descriptorDigests: [descriptor.descriptorDigest],
    });
  });

  it.each([
    ["missing descriptor", { capabilityId: "missing.capability", revision: "v1" }, "not-found"],
    ["wrong digest", { capabilityId: "web.search", revision: "v1", descriptorDigest: DIGEST_A }, "descriptor-mismatch"],
    ["unsupported caller", { capabilityId: "web.search", revision: "v1", caller: "claude" }, "unsupported-caller"],
  ] as const)("fails closed for %s", (_label, request, decision) => {
    const catalog = buildCapabilityCatalog([candidate()], EVALUATED_AT);
    const caller = "caller" in request && request.caller !== undefined
      ? request.caller
      : "kiln-runtime";
    const descriptorDigest = "descriptorDigest" in request
      ? request.descriptorDigest
      : undefined;
    const result = capabilityDescribe(catalog, {
      caller,
      capabilityId: request.capabilityId,
      revision: request.revision,
      ...(descriptorDigest ? { descriptorDigest } : {}),
      evaluatedAt: EVALUATED_AT,
    });

    expect(result.decision).toBe(decision);
    expect(result.descriptor).toBeUndefined();
    expect(result.evidence.descriptorDigests).toEqual([]);
  });
});
