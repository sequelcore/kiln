import { describe, expect, it } from "vitest";
import {
  compileNormalizedCapabilityJsonSchema,
  discoverVerificationCapabilities,
  discoverVerificationCapabilityCatalog,
  normalizeAndDigestCapabilityJsonSchema,
  type VerificationCapabilityDiscoveryInput,
  type VerificationProducerResolution,
  VERIFICATION_CAPABILITY_IDS,
  VERIFICATION_PRODUCER_ORDER,
} from "../../src/capabilities/index.js";
import {
  FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
  formalVerificationObservation,
} from "../../src/verification/formal/observation.js";
import {
  GENTLE_REVIEW_CAPABILITIES_SCHEMA,
  GENTLE_REVIEW_CONTRACT,
  GENTLE_REVIEW_STATUS_SCHEMA,
  gentleReviewObservation,
} from "../../src/verification/inferential/gentle-review-observation.js";
import {
  QUALITY_ANALYSIS_OBSERVATION_SCHEMA,
  QUALITY_PROFILE_ORDER,
  qualityAnalysisObservation,
  rulesForQualityProfile,
} from "../../src/verification/static/quality-observation.js";
import {
  STATIC_ANALYSIS_PROFILE,
  staticAnalysisObservation,
} from "../../src/verification/static/observation.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const DIGEST_C = `sha256:${"c".repeat(64)}` as const;
const EVALUATED_AT = "2026-08-28T12:00:00.000Z";
const OBSERVED_AT = "2026-08-28T11:00:00.000Z";
const VALID_UNTIL = "2026-08-28T13:00:00.000Z";
const CONTENT_DIGEST = `sha256:${"d".repeat(64)}`;

function resolution(
  version: string,
  profile: string | readonly string[],
  implementationDigest: `sha256:${string}` = DIGEST_A,
  provenanceDigest: `sha256:${string}` = DIGEST_B,
): VerificationCapabilityDiscoveryInput["producers"]["formal_verify"] {
  return {
    status: "available",
    observedAt: OBSERVED_AT,
    validUntil: VALID_UNTIL,
    version,
    profile,
    implementationDigest,
    provenanceDigest,
  };
}

function availableInput(): VerificationCapabilityDiscoveryInput {
  return {
    evaluatedAt: EVALUATED_AT,
    producers: {
      formal_verify: resolution("4.11.0", "kiln.formal-verification-observation/v3", DIGEST_A, DIGEST_B),
      static_analyze: resolution("1.80.0", STATIC_ANALYSIS_PROFILE, DIGEST_B, DIGEST_C),
      quality_analyze: resolution(
        "3.0.0",
        ["type-integrity", "complexity", "test-integrity"],
        DIGEST_C,
        DIGEST_A,
      ),
      gentle_review: resolution("2.5.0-rc.1", "gentle-ai.review-integration/v2", DIGEST_A, DIGEST_C),
    },
  };
}

function verificationObservations() {
  return {
    formal_verify: formalVerificationObservation({
      verifier: { name: "dafny", version: "4.11.0" },
      artifact: { contentDigest: CONTENT_DIGEST },
      subjects: [{ path: "src/Proof.dfy", contentDigest: CONTENT_DIGEST }],
      checks: [{ symbol: "Proof.valid", check: "correctness", outcome: "proved", durationMs: 0, resourceCount: 0 }],
    }),
    static_analyze: staticAnalysisObservation({
      analyzer: { name: "oxlint", version: "1.80.0" },
      profile: { id: STATIC_ANALYSIS_PROFILE, rulesAnalyzed: 3 },
      outcome: "clean",
      subjects: [{ path: "src/index.ts", contentDigest: CONTENT_DIGEST }],
      diagnostics: [],
    }),
    quality_analyze: qualityAnalysisObservation({
      analyzer: {
        name: "kiln-quality",
        version: "3.0.0",
        parser: { name: "@typescript/typescript6", version: "6.0.2" },
      },
      artifact: { kind: "typescript", path: "src/index.ts", contentDigest: CONTENT_DIGEST },
      outcome: "no_diagnostics",
      profiles: QUALITY_PROFILE_ORDER.map((name) => ({
        name,
        revision: "v1" as const,
        rules: rulesForQualityProfile(name),
        diagnostics: [],
      })),
    }),
    gentle_review: gentleReviewObservation({
      engine: {
        name: "gentle-ai",
        version: "2.5.0-rc.1",
        releaseChannel: "prerelease",
        executableDigest: CONTENT_DIGEST,
      },
      candidate: {
        targetIdentity: CONTENT_DIGEST,
        projection: "workspace",
        baseTree: "a".repeat(40),
        candidateTree: "b".repeat(40),
        pathsDigest: CONTENT_DIGEST,
        paths: ["src/index.ts"],
      },
      authority: {
        lineageId: "lineage-1",
        state: "observed",
        generation: 1,
        revision: CONTENT_DIGEST,
      },
      outcome: {
        applicability: "applicable",
        action: "observe",
        replayability: "replayable",
      },
    }),
  };
}

describe("verification capability discovery", () => {
  it("emits deterministic candidates and a Core-built catalog from inert evidence", () => {
    const first = discoverVerificationCapabilities(availableInput());
    const reordered: VerificationCapabilityDiscoveryInput = {
      evaluatedAt: EVALUATED_AT,
      producers: {
        gentle_review: availableInput().producers.gentle_review,
        quality_analyze: availableInput().producers.quality_analyze,
        static_analyze: availableInput().producers.static_analyze,
        formal_verify: availableInput().producers.formal_verify,
      },
    };
    const second = discoverVerificationCapabilities(reordered);

    expect(first).toEqual(second);
    expect(first.candidates.map((candidate) => candidate.capabilityId)).toEqual([
      VERIFICATION_CAPABILITY_IDS.formal_verify,
      VERIFICATION_CAPABILITY_IDS.static_analyze,
      VERIFICATION_CAPABILITY_IDS.quality_analyze,
      VERIFICATION_CAPABILITY_IDS.gentle_review,
    ]);
    expect(first.catalog.descriptors).toHaveLength(4);
    expect(first.catalog.decisions.every((decision) => decision.status === "eligible")).toBe(true);
    expect(first.candidates.every((candidate) => /^sha256:[a-f0-9]{64}$/u.test(candidate.inputSchemaDigest))).toBe(true);
    expect(first.candidates.every((candidate) => /^sha256:[a-f0-9]{64}$/u.test(candidate.outputSchemaDigest))).toBe(true);
    expect(first.candidates.every((candidate) => candidate.supportedCallers.length === 1 && candidate.supportedCallers[0] === "kiln-runtime")).toBe(true);
    expect(first.candidates.some((candidate) => candidate.supportedCallers.includes("codex"))).toBe(false);
    expect(first.candidates.some((candidate) => candidate.supportedCallers.includes("claude"))).toBe(false);
    expect(first.candidates.some((candidate) => candidate.supportedCallers.includes("opencode-v2"))).toBe(false);
  });

  it("publishes exact implementation bindings, empty artifact declarations, and strict result schemas", () => {
    const result = discoverVerificationCapabilities(availableInput());
    const observations = verificationObservations();
    const candidateById = new Map(result.candidates.map((candidate) => [candidate.capabilityId, candidate]));

    for (const toolSchema of result.toolSchemas) {
      const candidate = candidateById.get(toolSchema.capabilityId);
      expect(candidate).toBeDefined();
      expect(toolSchema.implementationIdentityDigest).toBe(candidate?.implementationReferences[0]?.identityDigest);
      expect(candidate?.artifacts).toEqual([]);

      const normalized = normalizeAndDigestCapabilityJsonSchema(toolSchema.outputSchema, "output");
      expect(normalized.ok && normalized.present ? normalized.digest : undefined).toBe(candidate?.outputSchemaDigest);
      if (!normalized.ok || !normalized.present) throw new Error("verification output schema was not normalized");
      const validator = compileNormalizedCapabilityJsonSchema(normalized.value, "output", candidate?.outputSchemaDigest);
      const validResult = validator.validate({ output: "observation", isError: false, metadata: observations[toolSchema.toolName] });
      expect(validResult, toolSchema.toolName).toBe(true);
      expect(validator.validate({ output: "failed", isError: true })).toBe(true);
      expect(validator.validate({ output: "observation", isError: false, metadata: { schema: "wrong" } })).toBe(false);
      expect(validator.validate({ output: "observation", isError: false, metadata: observations[toolSchema.toolName], extra: true })).toBe(false);
    }
  });

  it("keeps formal, static, quality, and inferential observation invariants distinct", () => {
    const result = discoverVerificationCapabilities(availableInput());
    const byTool = new Map(result.toolSchemas.map((schema) => [schema.toolName, schema]));
    const observations = verificationObservations();

    const validate = (toolName: keyof typeof observations, value: unknown): boolean => {
      const schema = byTool.get(toolName)!;
      const candidate = result.candidates.find((entry) => entry.capabilityId === schema.capabilityId)!;
      const normalized = normalizeAndDigestCapabilityJsonSchema(schema.outputSchema, "output");
      if (!normalized.ok || !normalized.present) throw new Error("verification output schema was not normalized");
      return compileNormalizedCapabilityJsonSchema(normalized.value, "output", candidate.outputSchemaDigest)
        .validate({ output: "observation", isError: false, metadata: value });
    };

    const formalWithDetail = structuredClone(observations.formal_verify) as unknown as Record<string, unknown>;
    (formalWithDetail.checks as Array<Record<string, unknown>>)[0]!.detail = "proved detail is forbidden";
    expect(validate("formal_verify", formalWithDetail)).toBe(false);

    const staticWithDiagnostic = structuredClone(observations.static_analyze) as unknown as Record<string, unknown>;
    staticWithDiagnostic.outcome = "clean";
    staticWithDiagnostic.diagnostics = [{ severity: "warning", message: "unexpected", file: "src/index.ts" }];
    expect(validate("static_analyze", staticWithDiagnostic)).toBe(false);

    const qualityWithDiagnostic = structuredClone(observations.quality_analyze) as unknown as Record<string, unknown>;
    (qualityWithDiagnostic.profiles as Array<Record<string, unknown>>)[1]!.diagnostics = [{
      rule: { name: "high-cyclomatic-complexity", revision: "v1" },
      message: "complexity",
      line: 1,
      column: 1,
    }];
    expect(validate("quality_analyze", qualityWithDiagnostic)).toBe(false);

    const gentleWithFinding = structuredClone(observations.gentle_review) as unknown as Record<string, unknown>;
    gentleWithFinding.findings = [{ message: "not allowed" }];
    expect(validate("gentle_review", gentleWithFinding)).toBe(false);

    expect(FORMAL_VERIFICATION_OBSERVATION_SCHEMA).not.toBe(QUALITY_ANALYSIS_OBSERVATION_SCHEMA);
    expect(GENTLE_REVIEW_CONTRACT).not.toBe(GENTLE_REVIEW_CAPABILITIES_SCHEMA);
    expect(GENTLE_REVIEW_STATUS_SCHEMA).not.toBe(STATIC_ANALYSIS_PROFILE);
  });

  it("never invokes callbacks or accessors while inspecting producer declarations", () => {
    let invoked = false;
    const producer = {
      ...availableInput().producers.formal_verify,
    } as Record<string, unknown>;
    Object.defineProperty(producer, "implementationDigest", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("must not execute");
      },
    });
    const result = discoverVerificationCapabilities({
      evaluatedAt: EVALUATED_AT,
      producers: { formal_verify: producer as unknown as VerificationProducerResolution },
    });

    expect(invoked).toBe(false);
    expect(result.catalog.decisions.find((decision) => decision.capabilityId === VERIFICATION_CAPABILITY_IDS.formal_verify)).toMatchObject({
      status: "ineligible",
      reasons: ["unavailable-evidence"],
    });
  });

  it("returns deeply immutable candidates and a Core-branded catalog", () => {
    const result = discoverVerificationCapabilities(availableInput());
    const candidate = result.candidates[0]!;
    const descriptor = result.catalog.descriptors[0]!;

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.effect)).toBe(true);
    expect(Object.isFrozen(candidate.effect.boundaries)).toBe(true);
    expect(Object.isFrozen(candidate.implementationReferences)).toBe(true);
    expect(Object.isFrozen(result.catalog)).toBe(true);
    expect(Object.isFrozen(result.catalog.descriptors)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(result.catalog.decisions)).toBe(true);
  });

  it("keeps the four producer semantics distinct", () => {
    const { candidates } = discoverVerificationCapabilities(availableInput());
    const byId = new Map(candidates.map((candidate) => [candidate.capabilityId, candidate]));
    const formal = byId.get(VERIFICATION_CAPABILITY_IDS.formal_verify)!;
    const staticAnalysis = byId.get(VERIFICATION_CAPABILITY_IDS.static_analyze)!;
    const quality = byId.get(VERIFICATION_CAPABILITY_IDS.quality_analyze)!;
    const gentle = byId.get(VERIFICATION_CAPABILITY_IDS.gentle_review)!;

    expect(new Set(candidates.map((candidate) => candidate.capabilityId)).size).toBe(4);
    expect(new Set(candidates.map((candidate) => candidate.outputSchemaDigest)).size).toBe(4);
    expect(formal.implementationReferences[0]?.kind).toBe("runtime-tool");
    expect(staticAnalysis.implementationReferences[0]?.kind).toBe("runtime-tool");
    expect(quality.implementationReferences[0]?.kind).toBe("runtime-tool");
    expect(gentle.kind).toBe("hosted-tool");
    expect(gentle.owner.kind).toBe("provider");
    expect(gentle.implementationReferences[0]?.kind).toBe("provider-tool");
    expect(quality.effect.operation).toBe("observe");
    expect(formal.effect.operation).toBe("mutate");
    expect(gentle.effect.boundaries).toEqual(["process", "workspace", "machine"]);
    expect(gentle.limits.maxInputBytes).toBeGreaterThanOrEqual(new TextEncoder().encode("{}").byteLength);
    expect(quality.permissions).toEqual(["workspace-read"]);
  });

  it("keeps unavailable and invalid producers visible as unavailable catalog decisions", () => {
    const input = availableInput();
    const result = discoverVerificationCapabilities({
      ...input,
      producers: {
        ...input.producers,
        static_analyze: {
          status: "validation_failed",
          diagnostic: {
            code: "managed_artifact_unavailable",
          },
        },
        quality_analyze: {
          status: "available",
          observedAt: OBSERVED_AT,
          validUntil: VALID_UNTIL,
          version: "3.0.0",
          profile: ["test-integrity", "complexity"],
          implementationDigest: DIGEST_A,
          provenanceDigest: DIGEST_B,
        },
      },
    });

    expect(result.catalog.descriptors.map((descriptor) => descriptor.capabilityId)).toEqual([
      VERIFICATION_CAPABILITY_IDS.formal_verify,
      VERIFICATION_CAPABILITY_IDS.gentle_review,
    ]);
    expect(result.catalog.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capabilityId: VERIFICATION_CAPABILITY_IDS.static_analyze,
        status: "ineligible",
        reasons: ["unavailable-evidence"],
      }),
      expect.objectContaining({
        capabilityId: VERIFICATION_CAPABILITY_IDS.quality_analyze,
        status: "ineligible",
        reasons: ["unavailable-evidence"],
      }),
    ]));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        producer: "static_analyze",
        status: "validation_failed",
        diagnostic: { code: "managed_artifact_unavailable" },
      }),
      expect.objectContaining({ producer: "quality_analyze", status: "invalid" }),
    ]));
  });

  it("does not import acceptance authority into discovery", () => {
    const result = discoverVerificationCapabilities(availableInput());
    expect(result.catalog).not.toHaveProperty("establishes");
    expect(result.candidates.every((candidate) => !Object.hasOwn(candidate, "establishes"))).toBe(true);
    expect(discoverVerificationCapabilityCatalog(availableInput())).toEqual(result.catalog);
  });

  it("returns all four unavailable candidates when no producer is resolved", () => {
    const result = discoverVerificationCapabilities({ evaluatedAt: EVALUATED_AT, producers: {} });
    expect(result.candidates).toHaveLength(VERIFICATION_PRODUCER_ORDER.length);
    expect(result.catalog.descriptors).toEqual([]);
    expect(result.catalog.decisions.map((decision) => decision.capabilityId)).toEqual([
      VERIFICATION_CAPABILITY_IDS.quality_analyze,
      VERIFICATION_CAPABILITY_IDS.formal_verify,
      VERIFICATION_CAPABILITY_IDS.gentle_review,
      VERIFICATION_CAPABILITY_IDS.static_analyze,
    ]);
    expect(result.catalog.decisions.every((decision) => decision.reasons[0] === "unavailable-evidence")).toBe(true);
  });
});
