import { describe, expect, it } from "vitest";
import {
  assertCapabilityCatalogContribution,
  compileNormalizedCapabilityJsonSchema,
  discoverVisionAnalyzeCapabilities,
  discoverVisionAnalyzeCapabilityCatalog,
  discoverVisionAnalyzeCapabilityCandidates,
  normalizeAndDigestCapabilityJsonSchema,
  VISION_ANALYZE_CAPABILITY_ID,
  VISION_ANALYZE_CAPABILITY_REVISION,
  VISION_ANALYZE_CONTRACT,
  VISION_ANALYZE_DISCOVERY_SOURCE_ID,
  VISION_ANALYZE_EFFECT,
  VISION_ANALYZE_INPUT_SCHEMA,
  VISION_ANALYZE_INPUT_SCHEMA_DIGEST,
  VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST,
  VISION_ANALYZE_TOOL_NAME,
  VISION_ANALYSIS_OUTPUT_SCHEMA,
  type VisionAnalyzeCapabilityDiscoveryInput,
} from "../../src/capabilities/index.js";
import { parseVisionAnalyzeInput, parseVisionAnalysis } from "../../src/capabilities/vision-analysis-capability.js";

const EVALUATED_AT = "2026-08-30T10:00:00.000Z";
const OBSERVED_AT = "2026-08-30T09:00:00.000Z";
const VALID_UNTIL = "2026-08-30T11:00:00.000Z";
const IMPLEMENTATION_DIGEST = `sha256:${"a".repeat(64)}` as const;
const AGENT_DIGEST = `sha256:${"b".repeat(64)}` as const;
const PROVENANCE_DIGEST = `sha256:${"c".repeat(64)}` as const;
const IMAGE_URI = "kiln://artifacts/inbound-multimodal/image-1";

function availableInput(): VisionAnalyzeCapabilityDiscoveryInput {
  return {
    evaluatedAt: EVALUATED_AT,
    implementation: {
      status: "available",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      implementationIdentityDigest: IMPLEMENTATION_DIGEST,
      agentIdentityDigest: AGENT_DIGEST,
      provenanceDigest: PROVENANCE_DIGEST,
    },
  };
}

describe("vision.analyze capability discovery", () => {
  it("emits one deterministic agent-backed candidate and Core-branded contribution", () => {
    const first = discoverVisionAnalyzeCapabilities(availableInput());
    const second = discoverVisionAnalyzeCapabilities(availableInput());

    expect(first).toEqual(second);
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0]).toMatchObject({
      capabilityId: VISION_ANALYZE_CAPABILITY_ID,
      revision: VISION_ANALYZE_CAPABILITY_REVISION,
      kind: "agent-backed",
      owner: { kind: "agent", identityDigest: AGENT_DIGEST },
      inputSchemaDigest: VISION_ANALYZE_INPUT_SCHEMA_DIGEST,
      outputSchemaDigest: VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST,
      effect: VISION_ANALYZE_EFFECT,
      permissions: ["workspace-read", "machine-execution", "network-access", "credential-use"],
      approval: "none",
      network: "restricted",
      data: { input: "internal", output: "internal", retention: "none" },
      freshness: { observedAt: OBSERVED_AT, validUntil: VALID_UNTIL, status: "available" },
      implementationReferences: [{
        identityDigest: IMPLEMENTATION_DIGEST,
        kind: "agent",
        inputSchemaDigest: VISION_ANALYZE_INPUT_SCHEMA_DIGEST,
        outputSchemaDigest: VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST,
      }],
    });
    expect(VISION_ANALYZE_EFFECT).toMatchObject({
      operation: "observe",
      boundaries: ["process", "workspace", "machine", "network"],
      dataEgress: "project-data",
      identityUse: "authenticated",
      consequences: ["financial"],
      idempotency: "idempotent",
    });
    expect(first.contribution.sourceId).toBe(VISION_ANALYZE_DISCOVERY_SOURCE_ID);
    expect(first.contribution.candidates).toHaveLength(1);
    expect(first.contribution.rejections).toEqual([]);
    expect(() => assertCapabilityCatalogContribution(first.contribution)).not.toThrow();
    expect(first.catalog.descriptors).toHaveLength(1);
    expect(first.catalog.decisions).toEqual([expect.objectContaining({
      capabilityId: VISION_ANALYZE_CAPABILITY_ID,
      revision: VISION_ANALYZE_CAPABILITY_REVISION,
      status: "eligible",
      reasons: ["eligible"],
    })]);
  });

  it("publishes exact vision schemas, contract identity, and matching digests", () => {
    const result = discoverVisionAnalyzeCapabilities(availableInput());
    const toolSchema = result.toolSchemas[0]!;
    const candidate = result.candidates[0]!;

    expect(result.toolSchemas).toHaveLength(1);
    expect(toolSchema).toMatchObject({
      capabilityId: VISION_ANALYZE_CAPABILITY_ID,
      revision: VISION_ANALYZE_CAPABILITY_REVISION,
      contract: VISION_ANALYZE_CONTRACT,
      toolName: VISION_ANALYZE_TOOL_NAME,
      implementationIdentityDigest: IMPLEMENTATION_DIGEST,
      inputSchemaDigest: VISION_ANALYZE_INPUT_SCHEMA_DIGEST,
      outputSchemaDigest: VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST,
      inputSchema: VISION_ANALYZE_INPUT_SCHEMA,
      outputSchema: VISION_ANALYSIS_OUTPUT_SCHEMA,
    });
    expect(toolSchema.inputSchema).toBe(VISION_ANALYZE_INPUT_SCHEMA);
    expect(toolSchema.outputSchema).toBe(VISION_ANALYSIS_OUTPUT_SCHEMA);
    expect(toolSchema.inputSchemaDigest).toBe(candidate.inputSchemaDigest);
    expect(toolSchema.outputSchemaDigest).toBe(candidate.outputSchemaDigest);

    const inputDigest = normalizeAndDigestCapabilityJsonSchema(toolSchema.inputSchema, "input");
    const outputDigest = normalizeAndDigestCapabilityJsonSchema(toolSchema.outputSchema, "output");
    expect(inputDigest).toMatchObject({ ok: true, present: true, digest: VISION_ANALYZE_INPUT_SCHEMA_DIGEST });
    expect(outputDigest).toMatchObject({ ok: true, present: true, digest: VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST });
    if (!inputDigest.ok || !inputDigest.present || !outputDigest.ok || !outputDigest.present) {
      throw new Error("Expected exact vision schemas to normalize.");
    }

    const inputValidator = compileNormalizedCapabilityJsonSchema(
      inputDigest.value,
      "input",
      candidate.inputSchemaDigest,
    );
    const outputValidator = compileNormalizedCapabilityJsonSchema(
      outputDigest.value,
      "output",
      candidate.outputSchemaDigest,
    );
    expect(inputValidator.validate({ resourceUris: [IMAGE_URI], instruction: "Describe it." })).toBe(true);
    expect(outputValidator.validate({
      status: "completed",
      summary: "A bounded fixture image description.",
      uncertainty: 0.1,
      limitations: [],
      evidenceUris: [],
    })).toBe(true);
    expect(inputValidator.validate({ resourceUris: ["https://example.invalid/image"], instruction: "Describe it." })).toBe(false);
    expect(outputValidator.validate({ status: "failed" })).toBe(false);
  });

  it("preserves parser ownership for the exact request and result contracts", () => {
    const input = parseVisionAnalyzeInput({ resourceUris: [IMAGE_URI], instruction: "Describe it." });
    const output = parseVisionAnalysis({
      status: "completed",
      summary: "A bounded fixture image description.",
      uncertainty: 0.1,
      limitations: [],
      evidenceUris: [],
    });

    expect(input.resourceUris).toEqual([IMAGE_URI]);
    expect(output.status).toBe("completed");
  });

  it.each([
    ["unavailable", { status: "unavailable" as const, diagnostic: { code: "implementation_unavailable" as const } }],
    ["invalid", { status: "invalid" as const, diagnostic: { code: "invalid_declaration" as const } }],
    ["configured unavailable", { status: "configured_unavailable" as const }],
  ])("fails closed for %s implementation evidence without duplicating the semantic candidate", (_label, implementation) => {
    const result = discoverVisionAnalyzeCapabilities({ evaluatedAt: EVALUATED_AT, implementation });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.kind).toBe("agent-backed");
    expect(result.candidates[0]?.freshness.status).toBe("unavailable");
    expect(result.catalog.descriptors).toEqual([]);
    expect(result.catalog.decisions).toEqual([expect.objectContaining({
      capabilityId: VISION_ANALYZE_CAPABILITY_ID,
      status: "ineligible",
      reasons: ["unavailable-evidence"],
    })]);
  });

  it("marks stale or contradictory available evidence ineligible", () => {
    const stale = discoverVisionAnalyzeCapabilities({
      evaluatedAt: EVALUATED_AT,
      implementation: {
        ...availableInput().implementation,
        validUntil: "2026-08-30T10:00:00.000Z",
      },
    });
    const future = discoverVisionAnalyzeCapabilities({
      evaluatedAt: EVALUATED_AT,
      implementation: {
        ...availableInput().implementation,
        observedAt: "2026-08-30T10:00:00.001Z",
      },
    });

    expect(stale.catalog.descriptors).toEqual([]);
    expect(stale.catalog.decisions[0]).toMatchObject({ status: "ineligible", reasons: ["stale-evidence"] });
    expect(future.catalog.descriptors).toEqual([]);
    expect(future.catalog.decisions[0]).toMatchObject({ status: "ineligible", reasons: ["contradictory-evidence"] });
  });

  it("does not invoke accessors or accept executable declarations", () => {
    let invoked = false;
    const implementation = {
      status: "available",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      implementationIdentityDigest: IMPLEMENTATION_DIGEST,
      provenanceDigest: PROVENANCE_DIGEST,
    } as Record<string, unknown>;
    Object.defineProperty(implementation, "implementationIdentityDigest", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("must not execute");
      },
    });

    const result = discoverVisionAnalyzeCapabilities({
      evaluatedAt: EVALUATED_AT,
      implementation: implementation as unknown as VisionAnalyzeCapabilityDiscoveryInput["implementation"],
    });

    expect(invoked).toBe(false);
    expect(result.catalog.descriptors).toEqual([]);
    expect(result.catalog.decisions[0]).toMatchObject({ status: "ineligible", reasons: ["unavailable-evidence"] });
    expect(() => discoverVisionAnalyzeCapabilities({
      evaluatedAt: EVALUATED_AT,
      implementation: {
        ...availableInput().implementation,
        callback: () => "forbidden",
      } as VisionAnalyzeCapabilityDiscoveryInput["implementation"],
    })).not.toThrow();
  });

  it("provides stable catalog and candidate convenience projections", () => {
    const input = availableInput();
    expect(discoverVisionAnalyzeCapabilityCatalog(input)).toEqual(discoverVisionAnalyzeCapabilities(input).catalog);
    expect(discoverVisionAnalyzeCapabilityCandidates(input)).toEqual(discoverVisionAnalyzeCapabilities(input).candidates);
  });
});
