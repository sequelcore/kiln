import { describe, expect, it, vi } from "vitest";
import {
  buildCapabilityCatalog,
  normalizeAndDigestCapabilityJsonSchema,
  type CapabilityImplementationReference,
  type CapabilityDescriptorCandidate,
} from "@kilnai/core/capabilities";
import { textParts, type ActionEffectEnvelope, type Capability } from "@kilnai/core/engine";
import { type ProviderAdapter, type ToolDefinition } from "@kilnai/core/agents";
import {
  CAPABILITY_DESCRIBE_TOOL_NAME,
  CAPABILITY_SEARCH_TOOL_NAME,
  RUNTIME_CAPABILITY_DESCRIBE_TOOL,
  RUNTIME_CAPABILITY_SEARCH_TOOL,
  createRuntimeCapabilityCompositionFactory,
  type RuntimeCapabilityGeneration,
  type RuntimeCapabilityMaterializationRecord,
} from "../../src/capabilities/runtime-capability-composition.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import {
  fixtureToolActionConfig,
  makeSession,
} from "./runtime-session-orchestrator-tools-test-fixture.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_C = `sha256:${"c".repeat(64)}` as const;
const EVALUATED_AT = "2026-08-21T00:00:00.000Z";
const INPUT_SCHEMA = {
  type: "object",
  properties: { query: { type: "string" } },
  additionalProperties: false,
} as const;
const OUTPUT_SCHEMA = {
  type: "object",
  properties: { result: { type: "string" } },
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

function candidate(overrides: Partial<CapabilityDescriptorCandidate> = {}): CapabilityDescriptorCandidate {
  return {
    capabilityId: "web.search",
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
      observedAt: "2026-08-21T00:00:00.000Z",
      validUntil: "2026-08-23T00:00:00.000Z",
      status: "available",
    },
    provenance: { sourceType: "provider", sourceIdentityDigest: DIGEST_A, sourceDigest: DIGEST_C },
    limits: { maxInputBytes: 16_384, maxOutputBytes: 65_536, maxDurationMs: 30_000, maxArtifacts: 2 },
    implementationReferences: [{
      identityDigest: DIGEST_C,
      kind: "provider-tool",
      inputSchemaDigest: INPUT_DIGEST,
      outputSchemaDigest: OUTPUT_DIGEST,
    }],
    ...overrides,
  };
}

function deferredTool(): ToolDefinition {
  return {
    name: "web_search",
    description: "Searches the web.",
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    tags: new Set(["search"]),
  };
}

function capability(name: string, effectEnvelope: ActionEffectEnvelope): Capability {
  return {
    name,
    description: name,
    schema: { type: "object" },
    tags: ["read-only"],
    effectEnvelope,
  };
}

function preparedGeneration(
  selectedExecutor?: (input: Record<string, unknown>) => void,
): { readonly generation: RuntimeCapabilityGeneration; readonly descriptorDigest: string } {
  const catalog = buildCapabilityCatalog([candidate()], EVALUATED_AT);
  const descriptor = catalog.descriptors[0]!;
  const implementationReference: CapabilityImplementationReference = descriptor.implementationReferences[0]!;
  const materialization: RuntimeCapabilityMaterializationRecord = {
    capabilityId: descriptor.capabilityId,
    revision: descriptor.revision,
    descriptorDigest: descriptor.descriptorDigest,
    inputSchemaDigest: descriptor.inputSchemaDigest,
    outputSchemaDigest: descriptor.outputSchemaDigest,
    implementationIdentityDigest: implementationReference.identityDigest,
    implementationReference,
    toolName: "web_search",
    tool: deferredTool(),
    executor: async (input) => {
      selectedExecutor?.(input);
      return { output: "selected search result", isError: false, metadata: {} };
    },
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
  };
  return {
    generation: createRuntimeCapabilityCompositionFactory({
      catalog,
      evaluatedAt: EVALUATED_AT,
      projectId: "runtime-session-capability-test-project",
      appId: "runtime-session-capability-test-app",
      surfaceId: "cli-direct",
      caller: "kiln-runtime",
      materializations: [materialization],
    }).prepare(),
    descriptorDigest: descriptor.descriptorDigest,
  };
}

function makeSingleToolProvider(
  toolName: string,
  input: Record<string, unknown>,
): ProviderAdapter {
  let callCount = 0;
  return {
    name: "mock",
    createMessage: vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return {
          parts: textParts("calling tool"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "single-tool-call", name: toolName, input }],
          stopReason: "tool_use",
        };
      }
      return {
        parts: textParts("done"),
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      };
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeCallerOwnedDiscoveryOrchestrator(
  provider: ProviderAdapter,
  capabilityGeneration: RuntimeCapabilityGeneration,
  callerOwnedSearch: (input: Record<string, unknown>) => Promise<unknown>,
): RuntimeSessionOrchestrator {
  return new RuntimeSessionOrchestrator({
    provider,
    model: "fixture-model",
    tools: [RUNTIME_CAPABILITY_SEARCH_TOOL, RUNTIME_CAPABILITY_DESCRIBE_TOOL],
    builtinTools: new Map([[CAPABILITY_SEARCH_TOOL_NAME, callerOwnedSearch]]),
    capabilityGeneration,
    capabilityMap: new Map([
      [CAPABILITY_SEARCH_TOOL_NAME, capability(CAPABILITY_SEARCH_TOOL_NAME, {
        operation: "observe",
        boundaries: [],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      })],
      [CAPABILITY_DESCRIBE_TOOL_NAME, capability(CAPABILITY_DESCRIBE_TOOL_NAME, {
        operation: "observe",
        boundaries: [],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      })],
    ]),
  });
}

function makeDeferredProvider(
  descriptorDigest: string,
  firstToolName: string = CAPABILITY_SEARCH_TOOL_NAME,
): ProviderAdapter {
  let callCount = 0;
  return {
    name: "mock",
    createMessage: vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return {
          parts: textParts("searching"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "cap-search-1",
            name: firstToolName,
            input: firstToolName === CAPABILITY_SEARCH_TOOL_NAME ? { query: "web" } : { query: "provider-native" },
          }],
          stopReason: "tool_use",
        };
      }
      if (callCount === 2 && firstToolName === CAPABILITY_SEARCH_TOOL_NAME) {
        return {
          parts: textParts("selecting"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "cap-describe-1",
            name: CAPABILITY_DESCRIBE_TOOL_NAME,
            input: {
              capabilityId: "web.search",
              revision: "v1",
              descriptorDigest,
            },
          }],
          stopReason: "tool_use",
        };
      }
      if (callCount === 3 && firstToolName === CAPABILITY_SEARCH_TOOL_NAME) {
        return {
          parts: textParts("executing selected capability"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "web-search-1", name: "web_search", input: { query: "web" } }],
          stopReason: "tool_use",
        };
      }
      return {
        parts: textParts("done"),
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      };
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeCapabilityOrchestrator(
  provider: ProviderAdapter,
  capabilityGeneration: RuntimeCapabilityGeneration,
  options: {
    readonly additionalTools?: readonly ToolDefinition[];
    readonly builtinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
    readonly materializableTools?: ReadonlyMap<string, ToolDefinition>;
  } = {},
): RuntimeSessionOrchestrator {
  return new RuntimeSessionOrchestrator({
    provider,
    model: "fixture-model",
    tools: [RUNTIME_CAPABILITY_SEARCH_TOOL, RUNTIME_CAPABILITY_DESCRIBE_TOOL, ...(options.additionalTools ?? [])],
    ...(options.builtinTools === undefined ? {} : { builtinTools: options.builtinTools }),
    ...(options.materializableTools === undefined ? {} : { materializableTools: options.materializableTools }),
    capabilityGeneration,
    capabilityMap: new Map([
      [CAPABILITY_SEARCH_TOOL_NAME, capability(CAPABILITY_SEARCH_TOOL_NAME, {
        operation: "observe",
        boundaries: [],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      })],
      [CAPABILITY_DESCRIBE_TOOL_NAME, capability(CAPABILITY_DESCRIBE_TOOL_NAME, {
        operation: "observe",
        boundaries: [],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      })],
      ["web_search", capability("web_search", SEARCH_EFFECT)],
    ]),
  });
}

function linkedToolActionConfig(
  orchestrator: RuntimeSessionOrchestrator,
  session: ReturnType<typeof makeSession>,
  generation: RuntimeCapabilityGeneration,
): ReturnType<typeof fixtureToolActionConfig> {
  void generation;
  return fixtureToolActionConfig(orchestrator, session, undefined);
}

describe("Runtime session capability deferred search", () => {
  it("keeps the initial surface bounded and materializes exactly the selected tool on the next round", async () => {
    const selectedExecutor = vi.fn();
    const prepared = preparedGeneration(selectedExecutor);
    const provider = makeDeferredProvider(prepared.descriptorDigest);
    const fallbackExecutor = vi.fn();
    const orchestrator = makeCapabilityOrchestrator(provider, prepared.generation);
    const session = makeSession();

    const result = await orchestrator.processMessage(
      session,
      textParts("Find the latest web result."),
      undefined,
      undefined,
      linkedToolActionConfig(orchestrator, session, prepared.generation),
    );

    const calls = vi.mocked(provider.createMessage).mock.calls;
    type ProviderRequestAssertion = {
      readonly tools?: readonly ToolDefinition[];
      readonly messages?: readonly {
        readonly parts: readonly { readonly type?: string; readonly content?: unknown }[];
      }[];
    };
    const requestAt = (index: number): ProviderRequestAssertion | undefined =>
      calls[index]?.[0] as ProviderRequestAssertion | undefined;
    const namesAt = (index: number): string[] =>
      (requestAt(index)?.tools ?? []).map((tool: ToolDefinition) => tool.name);
    expect(namesAt(0)).toEqual([CAPABILITY_SEARCH_TOOL_NAME, CAPABILITY_DESCRIBE_TOOL_NAME]);
    expect(namesAt(1)).toEqual([CAPABILITY_SEARCH_TOOL_NAME, CAPABILITY_DESCRIBE_TOOL_NAME]);
    expect(namesAt(2)).toEqual([
      CAPABILITY_SEARCH_TOOL_NAME,
      CAPABILITY_DESCRIBE_TOOL_NAME,
      "web_search",
    ]);
    expect(namesAt(0)).not.toContain("web_search");
    expect(namesAt(1)).not.toContain("web_search");
    expect((requestAt(1)?.messages ?? []).some((message) => message.parts.some((part) =>
      part.type === "tool_result"
      && typeof part.content === "string"
      && part.content.includes("implementationReferences")))).toBe(false);
    expect(result.toolExecutions?.map((execution) => execution.toolName)).toEqual([
      CAPABILITY_SEARCH_TOOL_NAME,
      CAPABILITY_DESCRIBE_TOOL_NAME,
      "web_search",
    ]);
    expect(selectedExecutor).toHaveBeenCalledTimes(1);
    expect(fallbackExecutor).not.toHaveBeenCalled();
  });

  it("blocks an unsupported provider-native search request without executing a tool", async () => {
    const prepared = preparedGeneration();
    const provider = makeDeferredProvider(
      prepared.descriptorDigest,
      "provider.native_search",
    );
    const fallbackExecutor = vi.fn();
    const orchestrator = makeCapabilityOrchestrator(provider, prepared.generation);
    const session = makeSession();

    const result = await orchestrator.processMessage(
      session,
      textParts("Use provider native search."),
      undefined,
      undefined,
      linkedToolActionConfig(orchestrator, session, prepared.generation),
    );

    expect(fallbackExecutor).not.toHaveBeenCalled();
    expect(result.toolExecutions?.[0]).toMatchObject({
      toolName: "provider.native_search",
      success: false,
    });
    expect(result.toolExecutions?.[0]?.resultSummary).toContain("projected tool schema");
  });

  it("fails closed when an invalidated generation would otherwise expose a caller-owned discovery executor", async () => {
    const prepared = preparedGeneration();
    const callerOwnedSearch = vi.fn(async () => ({ output: "caller-owned search" }));
    const provider = makeSingleToolProvider(CAPABILITY_SEARCH_TOOL_NAME, { query: "web" });
    const orchestrator = makeCallerOwnedDiscoveryOrchestrator(provider, prepared.generation, callerOwnedSearch);
    const session = makeSession();

    const config = linkedToolActionConfig(orchestrator, session, prepared.generation);
    prepared.generation.invalidate();
    const result = await orchestrator.processMessage(
      session,
      textParts("Use capability search."),
      undefined,
      undefined,
      config,
    );

    expect(callerOwnedSearch).not.toHaveBeenCalled();
    expect(result.toolExecutions?.[0]).toMatchObject({
      toolName: CAPABILITY_SEARCH_TOOL_NAME,
      success: false,
    });
    expect(result.toolExecutions?.[0]?.resultSummary).toMatch(/binding|denied/iu);
    expect(result.toolExecutions?.[0]?.metadata).toMatchObject({
      kind: "capability",
      operation: "binding",
      decision: "denied",
    });
  });

  it("fails closed when routed authority evidence does not match the generation binding", async () => {
    const prepared = preparedGeneration();
    const callerOwnedSearch = vi.fn(async () => ({ output: "caller-owned search" }));
    const provider = makeSingleToolProvider(CAPABILITY_SEARCH_TOOL_NAME, { query: "web" });
    const orchestrator = makeCallerOwnedDiscoveryOrchestrator(provider, prepared.generation, callerOwnedSearch);
    const session = makeSession();
    const config = linkedToolActionConfig(orchestrator, session, prepared.generation);
    const authorityAdmission = config.authorityAdmission;
    if (!authorityAdmission || authorityAdmission.turn.execution.status !== "routed") {
      throw new Error("Fixture must provide routed authority evidence.");
    }
    const mismatchedConfig = {
      ...config,
      authorityAdmission: {
        ...authorityAdmission,
        turn: {
          ...authorityAdmission.turn,
          execution: {
            ...authorityAdmission.turn.execution,
            target: {
              ...authorityAdmission.turn.execution.target,
              targetId: "mismatched-route",
            },
          },
        },
      },
    };

    const result = await orchestrator.processMessage(
      session,
      textParts("Use capability search."),
      undefined,
      undefined,
      mismatchedConfig,
    );

    expect(callerOwnedSearch).not.toHaveBeenCalled();
    expect(result.toolExecutions?.[0]).toMatchObject({
      toolName: CAPABILITY_SEARCH_TOOL_NAME,
      success: false,
    });
    expect(result.toolExecutions?.[0]?.metadata).toMatchObject({
      kind: "capability",
      operation: "binding",
      decision: "denied",
    });
  });

  it.each([
    {
      label: "a different base ToolDefinition",
      options: () => ({
        additionalTools: [{ ...deferredTool(), description: "Caller-owned search definition" }],
      }),
    },
    {
      label: "a caller-owned builtin executor",
      options: (fallback: (input: Record<string, unknown>) => void) => ({
        builtinTools: new Map([
          ["web_search", async (input: Record<string, unknown>) => {
            fallback(input);
            return { output: "caller-owned search" };
          }],
        ]),
      }),
    },
    {
      label: "a different materializable ToolDefinition",
      options: () => ({
        materializableTools: new Map([
          ["web_search", { ...deferredTool(), description: "Deferred caller-owned search definition" }],
        ]),
      }),
    },
  ])("denies selected capability materialization when its name collides with $label", async ({ options }) => {
    const selectedExecutor = vi.fn();
    const prepared = preparedGeneration(selectedExecutor);
    const provider = makeDeferredProvider(prepared.descriptorDigest);
    const fallbackExecutor = vi.fn();
    const orchestrator = makeCapabilityOrchestrator(
      provider,
      prepared.generation,
      options(fallbackExecutor),
    );
    const session = makeSession();

    const result = await orchestrator.processMessage(
      session,
      textParts("Find the latest web result."),
      undefined,
      undefined,
      linkedToolActionConfig(orchestrator, session, prepared.generation),
    );

    const selectedExecution = result.toolExecutions?.find((execution) => execution.toolName === "web_search");
    expect(selectedExecution).toMatchObject({
      success: false,
      metadata: {
        kind: "capability",
        operation: "materialize",
        decision: "denied",
        reasonCode: "tool-name-collision",
      },
    });
    expect(selectedExecution?.resultSummary).toMatch(/collid/iu);
    expect(fallbackExecutor).not.toHaveBeenCalled();
    expect(selectedExecutor).not.toHaveBeenCalled();
  });
});
