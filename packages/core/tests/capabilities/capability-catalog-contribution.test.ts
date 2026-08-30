import { describe, expect, it } from "vitest";
import {
  buildAggregateCapabilityCatalog,
  createCapabilityCatalogContribution,
  type CapabilityDescriptorCandidate,
} from "../../src/capabilities/capability-catalog.js";
import {
  CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST,
  CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
  normalizeAndDigestCapabilityJsonSchema,
  validateJsonSchemaSafety,
} from "../../src/capabilities/capability-json-schema-safety.js";

const EVALUATED_AT = "2026-08-30T10:00:00.000Z";
const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const DIGEST_C = `sha256:${"c".repeat(64)}` as const;

function candidate(overrides: Partial<CapabilityDescriptorCandidate> = {}): CapabilityDescriptorCandidate {
  return {
    capabilityId: "documents.list",
    revision: "v1",
    kind: "portable-tool",
    owner: { kind: "kiln", identityDigest: DIGEST_A },
    inputSchemaDigest: DIGEST_A,
    outputSchemaDigest: DIGEST_B,
    artifacts: [{ mediaType: "application/json", schemaDigest: DIGEST_B }],
    effect: {
      operation: "observe",
      boundaries: ["workspace"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    },
    permissions: ["workspace-read"],
    approval: "none",
    network: "none",
    data: { input: "internal", output: "internal", retention: "none" },
    supportedCallers: ["kiln-runtime"],
    freshness: {
      observedAt: "2026-08-30T09:00:00.000Z",
      validUntil: "2026-08-30T11:00:00.000Z",
      status: "available",
    },
    provenance: { sourceType: "kiln", sourceIdentityDigest: DIGEST_A, sourceDigest: DIGEST_C },
    limits: { maxInputBytes: 8_192, maxOutputBytes: 65_536, maxDurationMs: 30_000, maxArtifacts: 1 },
    implementationReferences: [{
      identityDigest: DIGEST_C,
      kind: "runtime-tool",
      inputSchemaDigest: DIGEST_A,
      outputSchemaDigest: DIGEST_B,
    }],
    ...overrides,
  };
}

describe("capability catalog contributions", () => {
  it("aggregates all sources before deciding cross-source duplicate identity", () => {
    const first = createCapabilityCatalogContribution({
      sourceId: "verification",
      candidates: [candidate()],
      rejections: [],
    });
    const second = createCapabilityCatalogContribution({
      sourceId: "mcp",
      candidates: [candidate()],
      rejections: [],
    });

    const aggregate = buildAggregateCapabilityCatalog([second, first], EVALUATED_AT);

    expect(aggregate.descriptors).toEqual([]);
    expect(aggregate.decisions).toEqual([{
      capabilityId: "documents.list",
      revision: "v1",
      status: "ineligible",
      reasons: ["duplicate-identity"],
    }]);
  });

  it("detects revision drift independent of contribution order", () => {
    const first = createCapabilityCatalogContribution({
      sourceId: "openapi",
      candidates: [candidate()],
      rejections: [],
    });
    const second = createCapabilityCatalogContribution({
      sourceId: "graphql",
      candidates: [candidate({ outputSchemaDigest: DIGEST_C, implementationReferences: [{
        identityDigest: DIGEST_C,
        kind: "runtime-tool",
        inputSchemaDigest: DIGEST_A,
        outputSchemaDigest: DIGEST_C,
      }] })],
      rejections: [],
    });

    const left = buildAggregateCapabilityCatalog([first, second], EVALUATED_AT);
    const right = buildAggregateCapabilityCatalog([second, first], EVALUATED_AT);

    expect(left).toEqual(right);
    expect(left.descriptors).toEqual([]);
    expect(left.decisions[0]).toMatchObject({
      capabilityId: "documents.list",
      revision: "v1",
      status: "ineligible",
      reasons: ["revision-drift"],
    });
  });

  it("retains safe rejection evidence while redacting malformed identity", () => {
    const contribution = createCapabilityCatalogContribution({
      sourceId: "harness",
      candidates: [],
      rejections: [
        { capabilityId: "documents.list", revision: "v1", reason: "unavailable-evidence" },
        { token: "synthetic-secret" },
      ],
    });

    const aggregate = buildAggregateCapabilityCatalog([contribution], EVALUATED_AT);

    expect(aggregate.descriptors).toEqual([]);
    expect(aggregate.decisions).toEqual(expect.arrayContaining([
      {
        capabilityId: "documents.list",
        revision: "v1",
        status: "ineligible",
        reasons: ["unavailable-evidence"],
      },
      { status: "ineligible", reasons: ["secret-bearing-field"] },
    ]));
  });

  it("redacts secret-bearing candidate content before branding the contribution", () => {
    const contribution = createCapabilityCatalogContribution({
      sourceId: "provider",
      candidates: [{
        ...candidate(),
        provenance: {
          sourceType: "provider",
          sourceIdentityDigest: DIGEST_A,
          sourceDigest: DIGEST_C,
        },
        description: "token=synthetic-secret-value",
      }],
      rejections: [],
    });

    expect(contribution.candidates).toEqual([]);
    expect(contribution.rejections).toEqual([{ reason: "secret-bearing-field" }]);
    expect(JSON.stringify(contribution)).not.toContain("synthetic-secret-value");
  });

  it("requires a Core brand and deeply freezes a contribution copy", () => {
    const source = {
      sourceId: "verification",
      candidates: [candidate()],
      rejections: [],
    };
    const contribution = createCapabilityCatalogContribution(source);

    expect(Object.isFrozen(contribution)).toBe(true);
    expect(Object.isFrozen(contribution.candidates)).toBe(true);
    expect(Object.isFrozen(contribution.candidates[0])).toBe(true);
    expect(() => buildAggregateCapabilityCatalog([{ ...contribution }], EVALUATED_AT)).toThrow(/Core-built contribution/u);
  });

  it.each([1_025, 10_000])("accepts %s inert candidate entries within the contribution collection bound", (count) => {
    const contribution = createCapabilityCatalogContribution({
      sourceId: `bulk-${count}`,
      candidates: Array.from({ length: count }, () => ({})),
      rejections: [],
    });

    expect(contribution.candidates).toHaveLength(count);
    expect(buildAggregateCapabilityCatalog([contribution], EVALUATED_AT).decisions).toHaveLength(count);
  });

  it("rejects contributions beyond the collection and combined entry bounds", () => {
    expect(() => createCapabilityCatalogContribution({
      sourceId: "too-many-candidates",
      candidates: Array.from({ length: 10_001 }, () => ({})),
      rejections: [],
    })).toThrow(/bounded/u);

    expect(() => createCapabilityCatalogContribution({
      sourceId: "too-many-entries",
      candidates: Array.from({ length: 5_000 }, () => ({})),
      rejections: Array.from({ length: 5_001 }, () => ({ reason: "malformed-descriptor" })),
    })).toThrow(/bounded maximum/u);
  });

  it("rejects aggregate candidates and rejections beyond the combined catalog bound", () => {
    const first = createCapabilityCatalogContribution({
      sourceId: "aggregate-a",
      candidates: Array.from({ length: 10_000 }, () => ({})),
      rejections: [],
    });
    const second = createCapabilityCatalogContribution({
      sourceId: "aggregate-b",
      candidates: [],
      rejections: [{ reason: "malformed-descriptor" }, { reason: "malformed-descriptor" }],
    });

    expect(() => buildAggregateCapabilityCatalog([first, second], EVALUATED_AT))
      .toThrow("Capability catalog contributions exceed the bounded maximum.");
  });

  it("rejects duplicate contribution source IDs independently of input order", () => {
    const first = createCapabilityCatalogContribution({ sourceId: "duplicate-source", candidates: [], rejections: [] });
    const second = createCapabilityCatalogContribution({ sourceId: "duplicate-source", candidates: [], rejections: [] });

    expect(() => buildAggregateCapabilityCatalog([first, second], EVALUATED_AT))
      .toThrowError("Capability catalog contributions contain duplicate sourceId.");
    expect(() => buildAggregateCapabilityCatalog([second, first], EVALUATED_AT))
      .toThrowError("Capability catalog contributions contain duplicate sourceId.");
  });
});

describe("canonical capability JSON Schema digests", () => {
  it("uses explicit absent sentinels and ignores descriptions and tags", () => {
    const absentInput = normalizeAndDigestCapabilityJsonSchema(undefined, "input");
    const absentOutput = normalizeAndDigestCapabilityJsonSchema(undefined, "output");
    const emptyObject = normalizeAndDigestCapabilityJsonSchema({}, "output");
    const described = normalizeAndDigestCapabilityJsonSchema({
      type: "object",
      description: "one",
      tags: ["first"],
      properties: { query: { type: "string" } },
    }, "input");
    const differentlyDescribed = normalizeAndDigestCapabilityJsonSchema({
      tags: ["second"],
      properties: { query: { type: "string" } },
      description: "two",
      type: "object",
    }, "input");

    expect(absentInput).toMatchObject({ ok: true, present: false, digest: CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST });
    expect(absentOutput).toMatchObject({ ok: true, present: false, digest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST });
    expect(CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST).not.toBe(CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST);
    expect(absentOutput).not.toEqual(emptyObject);
    expect(described).toMatchObject({ ok: true, present: true });
    expect(differentlyDescribed).toMatchObject({ ok: true, present: true });
    if (described.ok && described.present && differentlyDescribed.ok && differentlyDescribed.present) {
      expect(described.digest).toBe(differentlyDescribed.digest);
    }
  });

  it("preserves schema property names and actual values while ignoring node annotations", () => {
    const withValues = {
      type: "object",
      description: "root annotation",
      tags: ["root"],
      properties: {
        description: { type: "string", description: "property annotation", tags: ["property"] },
      },
      patternProperties: {
        description: { type: "string", description: "pattern annotation" },
      },
      dependentSchemas: {
        description: { type: "string", description: "dependent annotation" },
      },
      default: { description: "default value", tags: ["default"] },
      examples: [{ description: "example value", tags: ["example"] }],
      const: { description: "const value", tags: ["const"] },
    };
    const withDifferentAnnotations = {
      ...withValues,
      description: "different root annotation",
      tags: ["different-root"],
      properties: {
        description: { type: "string", description: "different property annotation", tags: ["different-property"] },
      },
      patternProperties: {
        description: { type: "string", description: "different pattern annotation" },
      },
      dependentSchemas: {
        description: { type: "string", description: "different dependent annotation" },
      },
    };

    const digest = (schema: unknown): string => {
      const result = normalizeAndDigestCapabilityJsonSchema(schema, "input");
      if (!result.ok || !result.present) throw new Error("Expected a present safe schema.");
      return result.digest;
    };

    expect(digest(withValues)).toBe(digest(withDifferentAnnotations));
    expect(digest({ type: "object", properties: { description: { type: "string" } } }))
      .not.toBe(digest({ type: "object", properties: {} }));
    expect(digest({ type: "object", patternProperties: { description: { type: "string" } } }))
      .not.toBe(digest({ type: "object", patternProperties: {} }));
    expect(digest({ type: "object", dependentSchemas: { description: { type: "string" } } }))
      .not.toBe(digest({ type: "object", dependentSchemas: {} }));
    expect(digest({ type: "object", default: { description: "value" } }))
      .not.toBe(digest({ type: "object", default: {} }));
    expect(digest({ type: "object", examples: [{ tags: ["value"] }] }))
      .not.toBe(digest({ type: "object", examples: [{}] }));
    expect(digest({ type: "object", const: { description: "value" } }))
      .not.toBe(digest({ type: "object", const: {} }));
  });

  it("reuses the existing safety validator and fails closed for unsafe schemas", () => {
    const unsafe = normalizeAndDigestCapabilityJsonSchema({
      type: "object",
      properties: { value: { $ref: "https://example.invalid/schema" } },
    }, "input", { referencePolicy: "none" });

    expect(unsafe).toEqual({ ok: false, reason: "reference" });
    expect(validateJsonSchemaSafety({ type: "object", properties: { token: { type: "string", default: "secret" } } })).toEqual({
      ok: false,
      reason: "secret",
    });
  });
});
