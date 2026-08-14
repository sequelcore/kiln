import { describe, expect, it } from "vitest";
import { CapabilityCatalogProjectionSchema } from "../src/capability-catalog.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const catalog = {
  schema: "kiln.capability-catalog/v1",
  observedAt: "2026-08-14T18:00:00.000Z",
  catalogDigest: digest("e"),
  entries: [{
    capabilityId: "web.search",
    revision: "v1",
    descriptorDigest: digest("a"),
    kind: "portable-tool",
    owner: { kind: "kiln", identityDigest: digest("f") },
    inputSchemaDigest: digest("b"),
    outputSchemaDigest: digest("c"),
    artifacts: [{ mediaType: "application/json", schemaDigest: digest("c") }],
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
    provenance: { sourceType: "kiln", sourceIdentityDigest: digest("9"), sourceDigest: digest("d") },
    limits: { maxInputBytes: 16_384, maxOutputBytes: 1_048_576, maxDurationMs: 30_000, maxArtifacts: 8 },
  }],
  rejections: [],
} as const;

describe("CapabilityCatalogProjectionSchema", () => {
  it("accepts the bounded secret-free capability projection", () => {
    expect(CapabilityCatalogProjectionSchema.parse(catalog)).toEqual(catalog);
  });

  it.each([
    { field: "credentialId", value: "credential-ref" },
    { field: "dispatch", value: { command: "run" } },
    { field: "implementationReferences", value: ["runtime:web-search"] },
    { field: "endpoint", value: "https://service.example.test" },
  ])("rejects non-public $field material", ({ field, value }) => {
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], [field]: value }],
    })).toThrow();
  });

  it("rejects credential material in every opaque public identity field", () => {
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{
        ...catalog.entries[0],
        owner: { ...catalog.entries[0].owner, identityDigest: "AIzaSyntheticCredentialMaterial" },
      }],
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{
        ...catalog.entries[0],
        provenance: { ...catalog.entries[0].provenance, sourceIdentityDigest: "glpat-synthetic-credential" },
      }],
    })).toThrow();
  });

  it("rejects credential signatures embedded at semantic string boundaries", () => {
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], capabilityId: "web.xoxb-example-redacted-fixture" }],
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{
        ...catalog.entries[0],
        artifacts: [{ mediaType: "application/xoxb-example-redacted-fixture" }],
      }],
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], capabilityId: "web.xoxb-example-redacted-fixture.search" }],
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{
        ...catalog.entries[0],
        artifacts: [{ mediaType: "application/xoxb-example-redacted-fixture+json" }],
      }],
    })).toThrow();
    expect(CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{
        ...catalog.entries[0],
        artifacts: [{ mediaType: "application/prefixxoxb-example-redacted-fixture" }],
      }],
    }).entries).toHaveLength(1);
  });

  it("rejects malformed identities, digests, timestamps, and unbounded values", () => {
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], capabilityId: "Web Search" }],
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], descriptorDigest: "sha256:short" }],
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({ ...catalog, observedAt: "yesterday" })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], supportedCallers: Array.from({ length: 10 }, () => "kiln-runtime") }],
    })).toThrow();
  });

  it("accepts the same bounded revision forms as Core", () => {
    for (const revision of ["v12", "1.2.3", "v1.2.3-rc.1+build.7", digest("7")]) {
      expect(CapabilityCatalogProjectionSchema.parse({
        ...catalog,
        entries: [{ ...catalog.entries[0], revision }],
      }).entries[0]?.revision).toBe(revision);
    }
  });

  it("rejects admitted entries with unavailable evidence or unknown effects", () => {
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], freshness: { ...catalog.entries[0].freshness, status: "unavailable" } }],
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [{
        ...catalog.entries[0],
        effect: { ...catalog.entries[0].effect, identityUse: "unknown" },
      }],
    })).toThrow();
  });

  it("requires an explicit sanitized reason for every rejected candidate", () => {
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      rejections: [{ capabilityId: "web.search", revision: "v1", status: "ineligible", reasons: [] }],
    })).toThrow();
    expect(CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [],
      rejections: [{ capabilityId: "web.search", revision: "v1", status: "ineligible", reasons: ["stale-evidence"] }],
    }).rejections[0]?.status).toBe("ineligible");
  });

  it("rejects duplicate public identities and entries expired at catalog observation", () => {
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      entries: [catalog.entries[0], catalog.entries[0]],
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      observedAt: "2026-08-14T20:00:00.000Z",
    })).toThrow();
    expect(() => CapabilityCatalogProjectionSchema.parse({
      ...catalog,
      rejections: [{ capabilityId: "web.search", revision: "v1", status: "ineligible", reasons: ["malformed-descriptor"] }],
    })).toThrow();
  });
});
