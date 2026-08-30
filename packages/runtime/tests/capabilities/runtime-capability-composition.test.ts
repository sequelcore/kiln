import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
  buildCapabilityCatalog,
  normalizeAndDigestCapabilityJsonSchema,
  type CapabilityDescriptorCandidate,
  type CapabilityImplementationReference,
} from "@kilnai/core/capabilities";
import { deriveAuthorityFromEffect, type ActionEffectEnvelope } from "@kilnai/core/engine";
import type { ToolDefinition } from "@kilnai/core/agents";
import {
  RuntimeCapabilityCompositionFactory,
  createRuntimeCapabilityCompositionFactory,
  linkEffectiveAuthorityAdmissionBundleToRuntimeCapabilityGeneration,
  projectRuntimeCapabilityDiscoveryTools,
  RUNTIME_CAPABILITY_SEARCH_TOOL,
  type RuntimeCapabilityMaterializationRecord,
} from "../../src/capabilities/runtime-capability-composition.js";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import type { EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const DIGEST_C = `sha256:${"c".repeat(64)}` as const;
const EVALUATED_AT = "2026-08-30T10:00:00.000Z";

const INPUT_SCHEMA = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
  additionalProperties: false,
} as const;
const OUTPUT_SCHEMA = {
  type: "object",
  properties: { result: { type: "string" } },
  required: ["result"],
  additionalProperties: false,
} as const;
function schemaDigest(schema: unknown, direction: "input" | "output"): `sha256:${string}` {
  const result = normalizeAndDigestCapabilityJsonSchema(schema, direction, {
    requireObjectType: true,
  });
  if (!result.ok || !result.present) throw new Error("Fixture schema must be canonicalizable.");
  return result.digest;
}

const INPUT_DIGEST = schemaDigest(INPUT_SCHEMA, "input");
const OUTPUT_DIGEST = schemaDigest(OUTPUT_SCHEMA, "output");

const SEARCH_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["network"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

function candidate(
  capabilityId = "web.search",
  overrides: Partial<CapabilityDescriptorCandidate> = {},
): CapabilityDescriptorCandidate {
  return {
    capabilityId,
    revision: "v1",
    kind: "hosted-tool",
    owner: { kind: "service", identityDigest: DIGEST_C },
    inputSchemaDigest: INPUT_DIGEST,
    outputSchemaDigest: OUTPUT_DIGEST,
    artifacts: [],
    effect: SEARCH_EFFECT,
    permissions: ["network-access"],
    approval: "conditional",
    network: "restricted",
    data: { input: "public", output: "internal", retention: "none" },
    supportedCallers: ["kiln-runtime"],
    freshness: {
      observedAt: "2026-08-30T09:00:00.000Z",
      validUntil: "2026-08-30T11:00:00.000Z",
      status: "available",
    },
    provenance: { sourceType: "provider", sourceIdentityDigest: DIGEST_A, sourceDigest: DIGEST_C },
    limits: { maxInputBytes: 16_384, maxOutputBytes: 65_536, maxDurationMs: 30_000, maxArtifacts: 0 },
    implementationReferences: [{
      identityDigest: DIGEST_C,
      kind: "provider-tool",
      inputSchemaDigest: INPUT_DIGEST,
      outputSchemaDigest: OUTPUT_DIGEST,
    }],
    ...overrides,
  };
}

function tool(name = "web_search", inputSchema: Record<string, unknown> = INPUT_SCHEMA): ToolDefinition {
  return {
    name,
    description: "Searches the web.",
    inputSchema,
    outputSchema: OUTPUT_SCHEMA,
    tags: new Set(["search"]),
  };
}

function record(
  descriptor: {
    readonly capabilityId: string;
    readonly revision: string;
    readonly descriptorDigest: `sha256:${string}`;
    readonly inputSchemaDigest: `sha256:${string}`;
    readonly outputSchemaDigest: `sha256:${string}`;
    readonly implementationReferences: readonly CapabilityImplementationReference[];
    readonly data: CapabilityDescriptorCandidate["data"];
    readonly network: CapabilityDescriptorCandidate["network"];
    readonly artifacts: CapabilityDescriptorCandidate["artifacts"];
    readonly freshness: CapabilityDescriptorCandidate["freshness"];
  },
  overrides: Partial<RuntimeCapabilityMaterializationRecord> = {},
): RuntimeCapabilityMaterializationRecord {
  return {
    capabilityId: descriptor.capabilityId,
    revision: descriptor.revision,
    descriptorDigest: descriptor.descriptorDigest,
    inputSchemaDigest: descriptor.inputSchemaDigest,
    outputSchemaDigest: descriptor.outputSchemaDigest,
    implementationIdentityDigest: descriptor.implementationReferences[0]!.identityDigest,
    implementationReference: descriptor.implementationReferences[0]!,
    toolName: "web_search",
    tool: tool(),
    executor: vi.fn(async () => ({ output: "ok", isError: false, metadata: {} })),
    requirements: {
      data: descriptor.data,
      network: descriptor.network,
      artifacts: descriptor.artifacts,
    },
    freshness: {
      observedAt: descriptor.freshness.observedAt,
      validUntil: descriptor.freshness.validUntil,
      status: descriptor.freshness.status,
    },
    ...overrides,
  };
}

function admission(toolName = "web_search", overrides: {
  readonly maximumClassification?: "public" | "internal" | "confidential" | "restricted";
  readonly netPolicy?: "none" | "package-managers" | "documentation" | "full";
} = {}): EffectiveAuthorityAdmissionBundle {
  const revision = { revisionSetId: DIGEST_A, revisions: { fixture: "runtime-capability-composition-test" } } as const;
  const authority = deriveAuthorityFromEffect(SEARCH_EFFECT);
  const maximumClassification = overrides.maximumClassification ?? "restricted";
  const netPolicy = overrides.netPolicy ?? "full";
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-capability-composition",
    turnId: "session-capability-composition:turn:1",
    admittedAt: EVALUATED_AT,
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "runtime-capability-composition-test", revision: "v1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "Capability composition fixture" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: "destructive",
        admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection",
        reason: "Capability composition fixture",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{ toolName, authority, effectEnvelope: SEARCH_EFFECT }],
        deniedToolNames: [],
        hostEnforcement: {
          schemaRevision: 1,
          sandboxId: DIGEST_B,
          leaseId: "fixture-lease",
          configurationRevisionId: DIGEST_A,
          permissionPolicyDigest: DIGEST_C,
          policyDigest: DIGEST_B,
          fsPolicy: "read-only",
          netPolicy,
          allowedPathCount: 0,
          deniedPathCount: 0,
          allowedDomainCount: 0,
        },
      },
      effectCeiling: SEARCH_EFFECT,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: "fixture-route",
          providerId: "mock",
          providerModelId: "fixture-model",
          accountSelection: { kind: "operator-override", accountPolicyId: "fixture-policy", accountId: "fixture-account" },
        },
        dataPolicy: {
          decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
          evidence: {
            providerId: "mock",
            providerModelId: "fixture-model",
            sourceIdentity: "fixture-source",
            sourceRevision: "v1",
            sourceDigest: DIGEST_C,
            trainingPosture: "prohibited",
            retentionPosture: "zero",
            retentionDays: 0,
            maximumClassification,
            observedAt: "2026-08-30T09:00:00.000Z",
            expiresAt: "2026-08-30T11:00:00.000Z",
          },
        },
        binding: {
          status: "bound",
          routeId: "fixture-route",
          accountId: "fixture-account",
          credentialId: "fixture-credential",
          credentialRevision: DIGEST_A,
        },
      },
    },
  });
}

function prepared(overrides: Partial<Parameters<typeof createRuntimeCapabilityCompositionFactory>[0]> = {}) {
  const catalog = buildCapabilityCatalog([candidate()], EVALUATED_AT);
  const descriptor = catalog.descriptors[0]!;
  const factory = createRuntimeCapabilityCompositionFactory({
    catalog,
    evaluatedAt: EVALUATED_AT,
    projectId: "project-fixture",
    appId: "app-fixture",
    surfaceId: "cli-direct",
    caller: "kiln-runtime",
    materializations: [record(descriptor)],
    ...overrides,
  });
  return { catalog, descriptor, factory, generation: factory.prepare() };
}

function linkedAdmission(
  generation: ReturnType<RuntimeCapabilityCompositionFactory["prepare"]>,
  authorityAdmission = admission(),
): EffectiveAuthorityAdmissionBundle {
  return linkEffectiveAuthorityAdmissionBundleToRuntimeCapabilityGeneration({
    generation,
    authorityAdmission,
    caller: "kiln-runtime",
  });
}

describe("RuntimeCapabilityCompositionFactory", () => {
  it("preserves Core absent output-schema semantics through materialization", () => {
    const absentOutputCandidate = candidate("web.no-output", {
      outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
      implementationReferences: [{
        ...candidate().implementationReferences[0]!,
        outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
      }],
    });
    const catalog = buildCapabilityCatalog([absentOutputCandidate], EVALUATED_AT);
    const descriptor = catalog.descriptors[0]!;
    const implementationReference = descriptor.implementationReferences[0]!;
    const materialized = record(descriptor, {
      toolName: "web_no_output",
      tool: {
        name: "web_no_output",
        description: "Searches the web without a structured output schema.",
        inputSchema: INPUT_SCHEMA,
        tags: new Set(["search"]),
      },
      outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
      implementationReference,
    });
    const generation = createRuntimeCapabilityCompositionFactory({
      catalog,
      evaluatedAt: EVALUATED_AT,
      projectId: "project-fixture",
      appId: "app-fixture",
      surfaceId: "cli-direct",
      caller: "kiln-runtime",
      materializations: [materialized],
    }).prepare();
    const authorityAdmission = linkedAdmission(generation, admission("web_no_output"));
    const binding = generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission,
    });

    const described = binding.describe({
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
    });
    const selected = binding.materialize({
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
    });

    expect(described.decision).toBe("selected");
    expect(described.tool).not.toHaveProperty("outputSchema");
    expect(selected?.tool).not.toHaveProperty("outputSchema");
    expect(generation.authorityCandidates[0]?.outputSchemaDigest).toBe(CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST);
  });

  it("prepares a bounded immutable generation and complete authority candidates", () => {
    const { generation, descriptor } = prepared();

    expect(generation.generationId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(generation.catalogDigest).toBe(descriptor.descriptorDigest === undefined ? "" : generation.catalogDigest);
    expect(generation.discoveryTools.map((entry) => entry.name)).toEqual([
      "capability.search",
      "capability.describe",
    ]);
    expect(generation.authorityCandidates).toHaveLength(1);
    expect(generation.authorityCandidates[0]).toMatchObject({
      capabilityId: "web.search",
      materializationStatus: "materializable",
      inputSchemaDigest: INPUT_DIGEST,
      outputSchemaDigest: OUTPUT_DIGEST,
    });
    expect(generation.authorityCandidates[0]).not.toHaveProperty("implementationReferences");
    expect(generation.authorityCandidates[0]).not.toHaveProperty("inputSchema");
    expect(generation.discoveryTools[0]!.inputSchema).not.toBe(generation.discoveryTools[1]!.inputSchema);
    expect(Object.isFrozen(generation)).toBe(true);
    expect(Object.isFrozen(generation.discoveryTools[0])).toBe(true);
    expect(Object.isFrozen(generation.authorityCandidates[0])).toBe(true);
  });

  it("keeps the initial discovery-tool projection constant as the catalog grows", () => {
    const smallGeneration = prepared().generation;
    const largeCatalog = buildCapabilityCatalog(
      Array.from({ length: 512 }, (_, index) => candidate(`catalog.tool${index}`)),
      EVALUATED_AT,
    );
    const largeGeneration = createRuntimeCapabilityCompositionFactory({
      catalog: largeCatalog,
      evaluatedAt: EVALUATED_AT,
      projectId: "project-fixture",
      appId: "app-fixture",
      surfaceId: "cli-direct",
      caller: "kiln-runtime",
      materializations: [],
    }).prepare();

    expect(largeGeneration.authorityCandidates).toHaveLength(512);
    expect(JSON.stringify(largeGeneration.discoveryTools))
      .toBe(JSON.stringify(smallGeneration.discoveryTools));
  });

  it("replaces a caller shadow of the reserved discovery contract with the canonical definition", () => {
    const { generation } = prepared();
    const authorityAdmission = linkedAdmission(generation);
    const binding = generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission,
    });
    const shadow = {
      ...RUNTIME_CAPABILITY_SEARCH_TOOL,
      description: "caller shadow",
      inputSchema: { type: "object", additionalProperties: true },
    };
    const projected = projectRuntimeCapabilityDiscoveryTools([shadow], binding);
    expect(projected?.filter((tool) => tool.name === "capability.search")).toHaveLength(1);
    expect(projected?.find((tool) => tool.name === "capability.search")).toBe(RUNTIME_CAPABILITY_SEARCH_TOOL);
  });

  it("rejects actual-schema, implementation, executor, and collision mismatches", () => {
    const { catalog, descriptor } = prepared();
    expect(() => createRuntimeCapabilityCompositionFactory({
      catalog,
      evaluatedAt: EVALUATED_AT,
      projectId: "project-fixture",
      appId: "app-fixture",
      surfaceId: "cli-direct",
      caller: "kiln-runtime",
      materializations: [record(descriptor, { inputSchemaDigest: DIGEST_A })],
    })).toThrow(/schema digest/u);

    expect(() => createRuntimeCapabilityCompositionFactory({
      catalog,
      evaluatedAt: EVALUATED_AT,
      projectId: "project-fixture",
      appId: "app-fixture",
      surfaceId: "cli-direct",
      caller: "kiln-runtime",
      materializations: [record(descriptor, {
        implementationIdentityDigest: DIGEST_A,
        implementationReference: { ...descriptor.implementationReferences[0]!, identityDigest: DIGEST_A },
      })],
    })).toThrow(/implementation/u);

    expect(() => createRuntimeCapabilityCompositionFactory({
      catalog,
      evaluatedAt: EVALUATED_AT,
      projectId: "project-fixture",
      appId: "app-fixture",
      surfaceId: "cli-direct",
      caller: "kiln-runtime",
      materializations: [record(descriptor, { executor: undefined as unknown as RuntimeCapabilityMaterializationRecord["executor"] })],
    })).toThrow(/executor/u);

    const collisionCatalog = buildCapabilityCatalog([
      candidate(),
      candidate("image.generate"),
    ], EVALUATED_AT);
    expect(() => createRuntimeCapabilityCompositionFactory({
      catalog: collisionCatalog,
      evaluatedAt: EVALUATED_AT,
      projectId: "project-fixture",
      appId: "app-fixture",
      surfaceId: "cli-direct",
      caller: "kiln-runtime",
      materializations: [
        record(collisionCatalog.descriptors[0]!),
        record(collisionCatalog.descriptors[1]!, { toolName: "web_search", tool: tool("web_search") }),
      ],
    })).toThrow(/shadow|tool name|collision/u);
  });

  it("detaches source objects and keeps selection tied to one private materialization", async () => {
    const { generation, descriptor } = prepared();
    const authorityAdmission = linkedAdmission(generation);
    const binding = generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission,
    });
    const described = binding.describe({
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
    });
    const selected = binding.materialize({
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
    });

    expect(described.decision).toBe("selected");
    expect(selected?.tool).toBe(described.tool);
    expect(binding.materialize({ capabilityId: descriptor.capabilityId, revision: descriptor.revision })).toBe(selected);
    await selected!.invoke({ query: "web" });
    expect(Object.isFrozen(selected?.tool)).toBe(true);
    expect(() => {
      (selected!.tool.inputSchema as Record<string, unknown>).properties = {};
    }).toThrow();
  });

  it("fails closed when authority linkage or route evidence is missing or contradictory", () => {
    const { generation, descriptor } = prepared();
    const authorityAdmission = admission();
    expect(() => generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission,
    })).toThrow(/linkage|generation evidence|authority/u);

    const otherGeneration = prepared({ surfaceId: "other-surface" }).generation;
    const linkedToOtherGeneration = linkedAdmission(otherGeneration, authorityAdmission);
    expect(() => generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission: linkedToOtherGeneration,
    })).toThrow(/generation|surface/u);

    const linkedAuthorityAdmission = linkedAdmission(generation, authorityAdmission);
    const bound = generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission: linkedAuthorityAdmission,
    });
    expect(bound.describe({
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
    }).decision).toBe("selected");
    const narrowData = admission("web_search", { maximumClassification: "public" });
    const narrowBound = generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission: linkedAdmission(generation, narrowData),
    });
    expect(narrowBound.describe({ capabilityId: descriptor.capabilityId, revision: descriptor.revision }).decision)
      .toBe("outside-authority");
  });

  it.each([
    ["generationId", DIGEST_A],
    ["catalogDigest", DIGEST_A],
    ["candidateProjectionDigest", DIGEST_A],
    ["surfaceDigest", DIGEST_A],
    ["routeDigest", DIGEST_A],
    ["caller", "kiln-cli"],
  ] as const)("rejects tampered durable capability linkage field %s", (field, value) => {
    const { generation } = prepared();
    const linked = linkedAdmission(generation);
    if (linked.turn.capabilityParticipation.status !== "generation-linked") throw new Error("invalid fixture");
    const tampered = structuredClone(linked);
    (tampered.turn.capabilityParticipation as unknown as Record<string, unknown>)[field] = value;

    expect(() => defineEffectiveAuthorityAdmissionBundle(tampered)).toThrow(/capability|digest|route|linkage/iu);
  });

  it("rejects the previous bundle schema and capability-linkage revisions", () => {
    const { generation } = prepared();
    const linked = structuredClone(linkedAdmission(generation));
    (linked as unknown as { schemaRevision: number }).schemaRevision = 1;
    expect(() => defineEffectiveAuthorityAdmissionBundle(linked)).toThrow(/schema revision/iu);

    const oldLinkage = structuredClone(linkedAdmission(generation));
    (oldLinkage.turn.capabilityParticipation as unknown as { schemaRevision: number }).schemaRevision = 0;
    expect(() => defineEffectiveAuthorityAdmissionBundle(oldLinkage)).toThrow(/capability.*malformed|schema/iu);
  });

  it("marks retention, budget, and artifact requirements unresolved instead of inventing authority", () => {
    const artifactCandidate = candidate("web.export", {
      artifacts: [{ mediaType: "application/json", schemaDigest: OUTPUT_DIGEST }],
      data: { input: "public", output: "internal", retention: "persistent" },
    });
    const catalog = buildCapabilityCatalog([artifactCandidate], EVALUATED_AT);
    const descriptor = catalog.descriptors[0]!;
    const generation = createRuntimeCapabilityCompositionFactory({
      catalog,
      evaluatedAt: EVALUATED_AT,
      projectId: "project-fixture",
      appId: "app-fixture",
      surfaceId: "cli-direct",
      caller: "kiln-runtime",
      materializations: [record(descriptor, {
        toolName: "web_export",
        tool: tool("web_export"),
        requirements: {
          data: descriptor.data,
          network: descriptor.network,
          artifacts: descriptor.artifacts,
          budget: { status: "unresolved", reason: "budget-authority-not-configured" },
        },
      })],
    }).prepare();
    expect(generation.authorityCandidates[0]?.requirements).toMatchObject({
      retention: { status: "unresolved" },
      artifacts: { status: "unresolved" },
      budget: { status: "unresolved" },
    });
    expect(generation.authorityCandidates[0]?.materializationStatus).toBe("not-materializable");
    const authorityAdmission = linkedAdmission(generation, admission("web_export"));
    const binding = generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission,
    });
    expect(binding.describe({ capabilityId: descriptor.capabilityId, revision: descriptor.revision }).decision)
      .toBe("outside-authority");
  });

  it("invalidates monotonically and refuses stale or revoked operations", () => {
    let revoked = false;
    const { catalog, descriptor, generation } = prepared({
      materializations: [record(buildCapabilityCatalog([candidate()], EVALUATED_AT).descriptors[0]!, {
        freshness: {
          observedAt: "2026-08-30T09:00:00.000Z",
          validUntil: "2026-08-30T11:00:00.000Z",
          status: "available",
          revocationGuard: () => revoked,
        },
      })],
    });
    const authorityAdmission = linkedAdmission(generation);
    const binding = generation.bindToExistingEffectiveAuthorityAdmissionBundle({
      authorityAdmission,
    });
    revoked = true;
    expect(binding.describe({ capabilityId: descriptor.capabilityId, revision: descriptor.revision }).decision)
      .toBe("stale");
    void catalog;
    expect(generation.isInvalidated()).toBe(false);
    generation.invalidate();
    expect(generation.isInvalidated()).toBe(true);
    generation.invalidate();
    expect(generation.isInvalidated()).toBe(true);
    expect(binding.describe({ capabilityId: descriptor.capabilityId, revision: descriptor.revision }).decision)
      .toBe("stale");
  });
});
