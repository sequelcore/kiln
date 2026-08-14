import { describe, expect, it } from "vitest";
import {
  assertCapabilityCatalogSnapshot,
  buildCapabilityCatalog,
  type CapabilityDescriptorCandidate,
} from "../../src/capabilities/index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const DIGEST_C = `sha256:${"c".repeat(64)}` as const;

function candidate(overrides: Partial<CapabilityDescriptorCandidate> = {}): CapabilityDescriptorCandidate {
  return {
    capabilityId: "kiln.tools.search",
    revision: "1.0.0",
    kind: "portable-tool",
    owner: { kind: "kiln", identityDigest: DIGEST_C },
    inputSchemaDigest: DIGEST_A,
    outputSchemaDigest: DIGEST_B,
    artifacts: [{ mediaType: "application/json", schemaDigest: DIGEST_C }],
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
    supportedCallers: ["kiln-runtime", "codex"],
    freshness: {
      observedAt: "2026-08-14T10:00:00.000Z",
      validUntil: "2026-08-14T12:00:00.000Z",
      status: "available",
    },
    provenance: { sourceType: "kiln", sourceIdentityDigest: DIGEST_A, sourceDigest: DIGEST_C },
    limits: { maxInputBytes: 1024, maxOutputBytes: 4096, maxDurationMs: 30_000, maxArtifacts: 2 },
    implementationReferences: [{
      identityDigest: DIGEST_C,
      kind: "runtime-tool",
      inputSchemaDigest: DIGEST_A,
      outputSchemaDigest: DIGEST_B,
    }],
    ...overrides,
  };
}

const EVALUATED_AT = "2026-08-14T11:00:00.000Z";

describe("buildCapabilityCatalog", () => {
  it("admits a canonical descriptor with a separate deterministic content digest", () => {
    const first = buildCapabilityCatalog([candidate()], EVALUATED_AT);
    const reordered = buildCapabilityCatalog([
      candidate({
        supportedCallers: ["codex", "kiln-runtime"],
        permissions: ["workspace-read"],
      }),
    ], EVALUATED_AT);

    expect(first).toEqual(reordered);
    expect(first.descriptors).toHaveLength(1);
    expect(first.descriptors[0]).toMatchObject({
      capabilityId: "kiln.tools.search",
      revision: "1.0.0",
      descriptorDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      supportedCallers: ["kiln-runtime", "codex"],
    });
    expect(first.catalogDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.decisions).toEqual([{
      capabilityId: "kiln.tools.search",
      revision: "1.0.0",
      descriptorDigest: first.descriptors[0]?.descriptorDigest,
      status: "eligible",
      reasons: ["eligible"],
    }]);
  });

  it("is independent of candidate input order and deeply immutable", () => {
    const second = candidate({ capabilityId: "kiln.tools.read", implementationReferences: [{
      identityDigest: DIGEST_A, kind: "runtime-tool", inputSchemaDigest: DIGEST_A, outputSchemaDigest: DIGEST_B,
    }] });
    const left = buildCapabilityCatalog([candidate(), second], EVALUATED_AT);
    const right = buildCapabilityCatalog([second, candidate()], EVALUATED_AT);

    expect(left).toEqual(right);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.descriptors)).toBe(true);
    expect(Object.isFrozen(left.descriptors[0]?.effect.boundaries)).toBe(true);
    expect(Object.isFrozen(left.descriptors[0]?.implementationReferences[0])).toBe(true);
    expect(assertCapabilityCatalogSnapshot(left)).toBe(left);
    expect(() => assertCapabilityCatalogSnapshot({ ...left })).toThrowError(/Core-built/u);
  });

  it("orders allowed punctuation by ordinal UTF-16 code units", () => {
    const hyphen = candidate({
      capabilityId: "kiln.tools.a-a",
      artifacts: [
        { mediaType: "application/a_a", schemaDigest: DIGEST_C },
        { mediaType: "application/a-a", schemaDigest: DIGEST_C },
      ],
    });
    const underscore = candidate({ capabilityId: "kiln.tools.a_a" });

    const snapshot = buildCapabilityCatalog([underscore, hyphen], EVALUATED_AT);
    const reversed = buildCapabilityCatalog([hyphen, underscore], EVALUATED_AT);

    expect(snapshot).toEqual(reversed);
    expect(snapshot.descriptors.map((descriptor) => descriptor.capabilityId))
      .toEqual(["kiln.tools.a-a", "kiln.tools.a_a"]);
    expect(snapshot.decisions.map((decision) => decision.capabilityId))
      .toEqual(["kiln.tools.a-a", "kiln.tools.a_a"]);
    expect(snapshot.descriptors[0]?.artifacts.map((artifact) => artifact.mediaType))
      .toEqual(["application/a-a", "application/a_a"]);
  });

  it("accepts bounded portable revision forms", () => {
    const snapshot = buildCapabilityCatalog([
      candidate({ revision: "v7" }),
      candidate({
        capabilityId: "kiln.tools.read",
        revision: DIGEST_A,
        implementationReferences: [{
          identityDigest: DIGEST_A,
          kind: "runtime-tool",
          inputSchemaDigest: DIGEST_A,
          outputSchemaDigest: DIGEST_B,
        }],
      }),
    ], EVALUATED_AT);

    expect(snapshot.descriptors.map((descriptor) => descriptor.revision)).toEqual([DIGEST_A, "v7"]);
  });

  it("rejects duplicate identities and revision drift without admitting either candidate", () => {
    const duplicate = buildCapabilityCatalog([candidate(), candidate()], EVALUATED_AT);
    const drift = buildCapabilityCatalog([
      candidate(),
      candidate({ limits: { maxInputBytes: 2048, maxOutputBytes: 4096, maxDurationMs: 30_000, maxArtifacts: 2 } }),
    ], EVALUATED_AT);

    expect(duplicate.descriptors).toEqual([]);
    expect(duplicate.decisions).toEqual([{
      capabilityId: "kiln.tools.search",
      revision: "1.0.0",
      status: "ineligible",
      reasons: ["duplicate-identity"],
    }]);
    expect(drift.descriptors).toEqual([]);
    expect(drift.decisions).toEqual([{
      capabilityId: "kiln.tools.search",
      revision: "1.0.0",
      status: "ineligible",
      reasons: ["revision-drift"],
    }]);
  });

  it("rejects an identity when another observation is malformed or secret-bearing", () => {
    const malformed = buildCapabilityCatalog([
      candidate(),
      { ...candidate(), description: "unknown-field" },
    ], EVALUATED_AT);
    const secret = buildCapabilityCatalog([
      candidate(),
      { ...candidate(), apiToken: "synthetic-secret" },
    ], EVALUATED_AT);
    const malformedReversed = buildCapabilityCatalog([
      { ...candidate(), description: "unknown-field" },
      candidate(),
    ], EVALUATED_AT);
    const secretReversed = buildCapabilityCatalog([
      { ...candidate(), apiToken: "synthetic-secret" },
      candidate(),
    ], EVALUATED_AT);

    expect(malformed.descriptors).toEqual([]);
    expect(malformed.decisions).toEqual([{
      capabilityId: "kiln.tools.search",
      revision: "1.0.0",
      status: "ineligible",
      reasons: ["duplicate-identity"],
    }]);
    expect(malformedReversed).toEqual(malformed);
    expect(secret.descriptors).toEqual([]);
    expect(secret.decisions).toEqual([{
      status: "ineligible",
      reasons: ["duplicate-identity"],
    }]);
    expect(secretReversed).toEqual(secret);
    expect(JSON.stringify(secret)).not.toContain("synthetic-secret");
  });

  it("uses canonical action-effect authority derivation for approval consistency", () => {
    const privileged = buildCapabilityCatalog([candidate({
      effect: { ...candidate().effect, identityUse: "privileged" },
      permissions: ["workspace-read", "credential-use"],
      approval: "none",
    })], EVALUATED_AT);
    const authenticated = buildCapabilityCatalog([candidate({
      capabilityId: "kiln.tools.authenticated-read",
      effect: { ...candidate().effect, identityUse: "authenticated" },
      permissions: ["workspace-read", "credential-use"],
      approval: "none",
    })], EVALUATED_AT);
    const reversibleConsequential = buildCapabilityCatalog([candidate({
      capabilityId: "kiln.tools.reversible-security-update",
      effect: {
        ...candidate().effect,
        operation: "mutate",
        consequences: ["security"],
      },
      permissions: ["workspace-write"],
      approval: "none",
    })], EVALUATED_AT);

    expect(privileged.descriptors).toEqual([]);
    expect(privileged.decisions[0]).toMatchObject({
      status: "ineligible",
      reasons: ["contradictory-evidence"],
    });
    expect(authenticated.decisions[0]?.status).toBe("eligible");
    expect(reversibleConsequential.decisions[0]?.status).toBe("eligible");
  });

  it.each([
    ["implementation schema drift", candidate({ implementationReferences: [{ identityDigest: DIGEST_C, kind: "runtime-tool", inputSchemaDigest: DIGEST_C, outputSchemaDigest: DIGEST_B }] }), "schema-mismatch"],
    ["unknown effect", candidate({ effect: { ...candidate().effect, dataEgress: "unknown" } }), "unsupported-effect"],
    ["duplicate effect value", candidate({ effect: { ...candidate().effect, boundaries: ["workspace", "workspace"] } }), "unsupported-effect"],
    ["expired evidence", candidate({ freshness: { observedAt: "2026-08-14T09:00:00.000Z", validUntil: EVALUATED_AT, status: "available" } }), "stale-evidence"],
    ["future evidence", candidate({ freshness: { observedAt: "2026-08-14T11:01:00.000Z", validUntil: "2026-08-14T12:00:00.000Z", status: "available" } }), "contradictory-evidence"],
    ["unavailable evidence", candidate({ freshness: { ...candidate().freshness, status: "unavailable" } }), "unavailable-evidence"],
    ["contradictory network posture", candidate({ effect: { ...candidate().effect, boundaries: ["network"] }, permissions: ["network-access"], network: "none" }), "contradictory-evidence"],
    ["approval too weak", candidate({ effect: { ...candidate().effect, operation: "mutate", reversibility: "irreversible", consequences: ["security"] }, approval: "none" }), "contradictory-evidence"],
  ] as const)("fails closed for %s", (_label, input, reason) => {
    const snapshot = buildCapabilityCatalog([input], EVALUATED_AT);
    expect(snapshot.descriptors).toEqual([]);
    expect(snapshot.decisions[0]).toMatchObject({ status: "ineligible", reasons: [reason] });
  });

  it.each([
    ["unknown field", { ...candidate(), description: "not admitted" }],
    ["malformed id", candidate({ capabilityId: "../private/tool" })],
    ["non-namespaced id", candidate({ capabilityId: "search" })],
    ["uppercase id", candidate({ capabilityId: "Kiln.search" })],
    ["malformed revision", candidate({ revision: "release candidate" })],
    ["invalid digest", candidate({ inputSchemaDigest: "sha256:nope" as `sha256:${string}` })],
    ["unbounded limit", candidate({ limits: { ...candidate().limits, maxOutputBytes: Number.MAX_SAFE_INTEGER } })],
    ["duplicate caller", candidate({ supportedCallers: ["kiln-runtime", "kiln-runtime"] })],
  ] as const)("rejects a malformed descriptor: %s", (_label, input) => {
    const snapshot = buildCapabilityCatalog([input], EVALUATED_AT);
    expect(snapshot.descriptors).toEqual([]);
    expect(snapshot.decisions[0]).toMatchObject({ status: "ineligible", reasons: ["malformed-descriptor"] });
  });

  it.each([
    ["secret field", { ...candidate(), apiToken: "synthetic-secret" }],
    ["bearer value", candidate({ owner: "Bearer synthetic-value" as unknown as CapabilityDescriptorCandidate["owner"] })],
    ["OpenAI-style value", candidate({ owner: "sk-proj-synthetic123456789" as unknown as CapabilityDescriptorCandidate["owner"] })],
    ["GitHub-style value", candidate({ owner: "github_pat_synthetic123456789" as unknown as CapabilityDescriptorCandidate["owner"] })],
    ["credential URL", candidate({ implementationReferences: [{
      identityDigest: "https://user:pass@example.invalid/tool" as `sha256:${string}`,
      kind: "runtime-tool",
      inputSchemaDigest: DIGEST_A,
      outputSchemaDigest: DIGEST_B,
    }] })],
  ] as const)("rejects and sanitizes a secret-bearing descriptor: %s", (_label, input) => {
    const snapshot = buildCapabilityCatalog([input], EVALUATED_AT);
    expect(snapshot.descriptors).toEqual([]);
    expect(snapshot.decisions).toEqual([{ status: "ineligible", reasons: ["secret-bearing-field"] }]);
    expect(JSON.stringify(snapshot)).not.toContain("synthetic");
    expect(JSON.stringify(snapshot)).not.toContain("user:pass");
  });

  it.each([
    ["owner", candidate({ owner: "AIzaSySyntheticCredential123456789" as unknown as CapabilityDescriptorCandidate["owner"] }), "AIzaSySyntheticCredential123456789"],
    ["caller", candidate({ supportedCallers: ["glpat-syntheticCredential123" as unknown as "codex"] }), "glpat-syntheticCredential123"],
    ["provenance", candidate({ provenance: {
      sourceType: "provider",
      sourceIdentityDigest: "xoxb-syntheticCredential123" as `sha256:${string}`,
      sourceDigest: DIGEST_C,
    } }), "xoxb-syntheticCredential123"],
    ["implementation", candidate({ implementationReferences: [{
      identityDigest: "AKIAABCDEFGHIJKLMNOP" as `sha256:${string}`,
      kind: "runtime-tool",
      inputSchemaDigest: DIGEST_A,
      outputSchemaDigest: DIGEST_B,
    }] }), "AKIAABCDEFGHIJKLMNOP"],
    ["JWT-like owner", candidate({ owner: "eyJhbGciOiJIUzI1NiJ9.c3ludGhldGlj.c2lnbmF0dXJl" as unknown as CapabilityDescriptorCandidate["owner"] }), "eyJhbGciOiJIUzI1NiJ9"],
  ] as const)("never retains credential-shaped data in the former raw %s identity field", (_field, input, secret) => {
    const snapshot = buildCapabilityCatalog([input], EVALUATED_AT);
    expect(snapshot.descriptors).toEqual([]);
    expect(snapshot.decisions).toEqual([{ status: "ineligible", reasons: ["secret-bearing-field"] }]);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it.each([
    ["capability id", candidate({ capabilityId: "web.xoxb-example-redacted-fixture" }), "xoxb-example-redacted-fixture"],
    ["artifact media subtype", candidate({ artifacts: [{
      mediaType: "application/xoxb-example-redacted-fixture",
      schemaDigest: DIGEST_C,
    }] }), "xoxb-example-redacted-fixture"],
    ["capability component with suffix", candidate({
      capabilityId: "web.xoxb-example-redacted-fixture.search",
    }), "xoxb-example-redacted-fixture.search"],
    ["artifact subtype with structured suffix", candidate({ artifacts: [{
      mediaType: "application/xoxb-example-redacted-fixture+json",
      schemaDigest: DIGEST_C,
    }] }), "xoxb-example-redacted-fixture+json"],
  ] as const)("rejects an embedded credential signature at a semantic %s boundary", (_field, input, secret) => {
    const snapshot = buildCapabilityCatalog([input], EVALUATED_AT);
    expect(snapshot.descriptors).toEqual([]);
    expect(snapshot.decisions).toEqual([{ status: "ineligible", reasons: ["secret-bearing-field"] }]);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it("does not treat a credential-like substring without a semantic boundary as a secret", () => {
    const snapshot = buildCapabilityCatalog([candidate({ artifacts: [{
      mediaType: "application/prefixxoxb-example-redacted-fixture",
      schemaDigest: DIGEST_C,
    }] })], EVALUATED_AT);

    expect(snapshot.decisions[0]?.status).toBe("eligible");
  });

  it("rejects accessors without invoking them and sanitizes proxy failures", () => {
    let accessorInvoked = false;
    const accessorCandidate = { ...candidate() } as Record<string, unknown>;
    Object.defineProperty(accessorCandidate, "owner", {
      enumerable: true,
      get() {
        accessorInvoked = true;
        throw new Error("raw-accessor-secret");
      },
    });
    const hostileProxy = new Proxy(candidate(), {
      ownKeys() {
        throw new Error("raw-proxy-secret");
      },
    });

    const accessorSnapshot = buildCapabilityCatalog([accessorCandidate], EVALUATED_AT);
    const accessorDuplicate = buildCapabilityCatalog([candidate(), accessorCandidate], EVALUATED_AT);
    const proxySnapshot = buildCapabilityCatalog([hostileProxy], EVALUATED_AT);
    expect(accessorInvoked).toBe(false);
    expect(accessorSnapshot.decisions[0]).toMatchObject({ status: "ineligible", reasons: ["malformed-descriptor"] });
    expect(accessorDuplicate.descriptors).toEqual([]);
    expect(accessorDuplicate.decisions).toEqual([{
      capabilityId: "kiln.tools.search",
      revision: "1.0.0",
      status: "ineligible",
      reasons: ["duplicate-identity"],
    }]);
    expect(proxySnapshot.decisions).toEqual([{ status: "ineligible", reasons: ["malformed-descriptor"] }]);
    expect(JSON.stringify([accessorSnapshot, accessorDuplicate, proxySnapshot])).not.toContain("raw-");
  });

  it("fails closed for cyclic, deeply nested, and aggregate oversized candidate data", () => {
    const cyclic: Record<string, unknown> = { ...candidate() };
    cyclic.extra = cyclic;
    let deep: unknown = "leaf";
    for (let depth = 0; depth < 64; depth++) deep = { nested: deep };
    const deeplyNested = { ...candidate(), extra: deep };

    expect(buildCapabilityCatalog([cyclic], EVALUATED_AT).decisions[0])
      .toMatchObject({ status: "ineligible", reasons: ["malformed-descriptor"] });
    expect(buildCapabilityCatalog([deeplyNested], EVALUATED_AT).decisions[0])
      .toMatchObject({ status: "ineligible", reasons: ["malformed-descriptor"] });

    const oversized = Array.from({ length: 2_000 }, () => ({ payload: Array.from({ length: 512 }, () => 0) }));
    expect(() => buildCapabilityCatalog(oversized, EVALUATED_AT))
      .toThrowError("Capability catalog inspection budget exceeded.");
  });

  it("sanitizes malformed candidate payloads and validates evaluatedAt", () => {
    const snapshot = buildCapabilityCatalog([null, "raw-token", { capabilityId: "safe.id", revision: 3 }], EVALUATED_AT);
    expect(snapshot.decisions).toEqual([
      { status: "ineligible", reasons: ["malformed-descriptor"] },
      { status: "ineligible", reasons: ["malformed-descriptor"] },
      { capabilityId: "safe.id", status: "ineligible", reasons: ["malformed-descriptor"] },
    ]);
    expect(() => buildCapabilityCatalog([], "not-a-time")).toThrowError(/evaluatedAt/u);
  });
});
