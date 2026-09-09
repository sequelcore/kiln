import { adoptBoundedWorkExecutionBudgetRevision } from "@kilnai/core/work-governance";
import { SqliteBoundedWorkAuthority, createRuntimeSharedExecutionBudgetScope } from "@kilnai/runtime";
import { describe, expect, it, vi } from "vitest";
import {
  buildCapabilityCatalog,
  CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
  normalizeAndDigestCapabilityJsonSchema,
  textParts,
  type ActionEffectEnvelope,
  type AgentResponse,
  type AuthorityDescriptor,
  type Capability,
  type CapabilityDescriptorCandidate,
  type ProviderAdapter,
  type ToolDefinition,
} from "@kilnai/core";
import {
  createAttachedRuntimeBuiltinToolSurface,
  createRuntimeCapabilityCompositionFactory,
  createTrustedRuntimeBuiltinPortableInvocationPort,
  defineEffectiveAuthorityAdmissionBundle,
  linkEffectiveAuthorityAdmissionBundleToRuntimeCapabilityGeneration,
  ManagedDirectProviderRuntimeAdapter,
  RUNTIME_CAPABILITY_DESCRIBE_TOOL,
  RUNTIME_CAPABILITY_SEARCH_TOOL,
  RuntimeManagedAgentInvocationService,
  RuntimeSession,
  RuntimeSessionOrchestrator,
  type EffectiveAuthorityAdmissionBundle,
  type RuntimeCapabilityGeneration,
  type RuntimeModelRoundActionClaim,
  type RuntimeModelRoundActionClaimPermit,
  type RuntimeModelRoundActionClaimStore,
  type RuntimeToolActionClaim,
  type RuntimeToolActionClaimPermit,
  type RuntimeToolActionClaimStore,
  type ManagedInvocationToolOptions,
  type ManagedInvocationToolRoute,
} from "@kilnai/runtime";
import { createKilnRuntimeManagedInvocationAttachment } from "../../src/application/managed-invocation-attachment.js";
import { createConfiguredInvocationAdmission } from "../../src/config/builtin-tool-surface-config.js";
import type { KilnPermissionPolicy, KilnToolPermissionRule } from "../../src/wrapper/session.js";

const EVALUATED_AT = "2026-09-08T00:00:00.000Z";
const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const CHILD_TOOL_NAME = "read";

const OBSERVE_EFFECT = {
  operation: "observe",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
} as const satisfies ActionEffectEnvelope;

const DESTRUCTIVE_EFFECT = {
  operation: "mutate",
  boundaries: ["process", "workspace", "network"],
  reversibility: "irreversible",
  dataEgress: "sensitive-data",
  identityUse: "authenticated",
  consequences: ["local-state", "external-state"],
  idempotency: "non-idempotent",
} as const satisfies ActionEffectEnvelope;

const READ_AUTHORITY = {
  level: 1,
  allowed: true,
  requiresApproval: false,
  reason: "Synthetic child read is admitted by the parent authority receipt.",
} as const satisfies AuthorityDescriptor;

const INVOKE_AUTHORITY = {
  level: 4,
  allowed: true,
  requiresApproval: false,
  reason: "Generic managed invocation is admitted for this synthetic Runtime turn.",
} as const satisfies AuthorityDescriptor;

function schemaDigest(schema: unknown): `sha256:${string}` {
  const normalized = normalizeAndDigestCapabilityJsonSchema(schema, "input", { requireObjectType: true });
  if (!normalized.ok || !normalized.present) throw new Error("Synthetic capability schema must be canonicalizable.");
  return normalized.digest;
}

function response(text: string, toolCalls: AgentResponse["toolCalls"] = []): AgentResponse {
  return {
    parts: textParts(text),
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
  };
}

function actionClaimStore(): RuntimeToolActionClaimStore {
  const claims = new Map<string, RuntimeToolActionClaim>();
  const consumed = new WeakSet<object>();
  return {
    claim(claim) {
      if (claims.has(claim.claimId)) throw new Error("Synthetic Runtime tool claim was duplicated.");
      const permit = {
        claimId: claim.claimId,
        permitId: `synthetic-tool:${claim.claimId}`,
        consume: () => {
          if (consumed.has(permit)) throw new Error("Synthetic Runtime tool claim was consumed twice.");
          consumed.add(permit);
        },
      } as unknown as RuntimeToolActionClaimPermit;
      claims.set(claim.claimId, claim);
      return permit;
    },
    settle(permit, settlement) {
      const claim = claims.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("Synthetic Runtime tool claim was not consumed.");
      claims.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "success" ? { outcome: "success" as const } : { unknownReason: settlement.reason }),
      });
    },
  };
}

function modelRoundClaimStore(): RuntimeModelRoundActionClaimStore {
  const claims = new Map<string, RuntimeModelRoundActionClaim>();
  const consumed = new WeakSet<object>();
  return {
    claim(claim) {
      if (claims.has(claim.claimId)) throw new Error("Synthetic Runtime model claim was duplicated.");
      const permit = {
        claimId: claim.claimId,
        permitId: `synthetic-model:${claim.claimId}`,
        consume: () => {
          if (consumed.has(permit)) throw new Error("Synthetic Runtime model claim was consumed twice.");
          consumed.add(permit);
        },
      } as unknown as RuntimeModelRoundActionClaimPermit;
      claims.set(claim.claimId, claim);
      return permit;
    },
    settle(permit, settlement) {
      const claim = claims.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("Synthetic Runtime model claim was not consumed.");
      claims.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "unknown" ? "unknown" : "settled",
        ...(settlement.kind === "unknown"
          ? { outcome: "unknown" as const, unknownReason: settlement.reason }
          : { outcome: settlement.kind }),
      });
    },
  };
}

function parentAdmission(sessionId: string, turnId: string): EffectiveAuthorityAdmissionBundle {
  const revision = {
    revisionSetId: DIGEST_A,
    revisions: { fixture: DIGEST_B },
  } as const;
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId,
    turnId,
    admittedAt: EVALUATED_AT,
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "generic-managed-child-fixture", revision: "v1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "Synthetic parent Runtime admission." },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: "destructive",
        admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection",
        reason: "Synthetic parent Runtime admission.",
        completeness: "authoritative",
        toolCount: 4,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [
          { toolName: "capability.search", authority: READ_AUTHORITY, effectEnvelope: OBSERVE_EFFECT },
          { toolName: "capability.describe", authority: READ_AUTHORITY, effectEnvelope: OBSERVE_EFFECT },
          { toolName: "managed_agent.invoke", authority: INVOKE_AUTHORITY, effectEnvelope: OBSERVE_EFFECT },
          { toolName: CHILD_TOOL_NAME, authority: READ_AUTHORITY, effectEnvelope: OBSERVE_EFFECT },
        ],
        deniedToolNames: [],
      },
      effectCeiling: DESTRUCTIVE_EFFECT,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: "synthetic-direct-route",
          providerId: "synthetic-provider",
          providerModelId: "synthetic-model",
          accountSelection: { kind: "operator-override", accountPolicyId: "synthetic-policy", accountId: "synthetic-account" },
        },
        dataPolicy: {
          decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
          evidence: {
            providerId: "synthetic-provider",
            providerModelId: "synthetic-model",
            sourceIdentity: "synthetic-policy-source",
            sourceRevision: "synthetic-policy-revision",
            sourceDigest: DIGEST_A,
            trainingPosture: "prohibited",
            retentionPosture: "zero",
            retentionDays: 0,
            maximumClassification: "restricted",
            observedAt: EVALUATED_AT,
            expiresAt: "2026-09-10T00:00:00.000Z",
          },
        },
        binding: {
          status: "bound",
          routeId: "synthetic-direct-route",
          accountId: "synthetic-account",
          credentialId: "synthetic-credential",
          credentialRevision: DIGEST_B,
        },
      },
    },
  });
}

function capabilityCandidate(tool: ToolDefinition): CapabilityDescriptorCandidate {
  return {
    capabilityId: "managed.synthetic.invoke",
    revision: "v1",
    kind: "hosted-tool",
    owner: { kind: "service", identityDigest: DIGEST_A },
    inputSchemaDigest: schemaDigest(tool.inputSchema),
    outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
    artifacts: [],
    effect: OBSERVE_EFFECT,
    permissions: [],
    approval: "conditional",
    network: "none",
    data: { input: "internal", output: "internal", retention: "none" },
    supportedCallers: ["kiln-runtime"],
    freshness: { observedAt: EVALUATED_AT, validUntil: "2026-09-10T00:00:00.000Z", status: "available" },
    provenance: { sourceType: "provider", sourceIdentityDigest: DIGEST_A, sourceDigest: DIGEST_B },
    limits: { maxInputBytes: 16_384, maxOutputBytes: 65_536, maxDurationMs: 30_000, maxArtifacts: 0 },
    implementationReferences: [{
      identityDigest: DIGEST_B,
      kind: "provider-tool",
      inputSchemaDigest: schemaDigest(tool.inputSchema),
      outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
    }],
  };
}

function capabilityGeneration(surface: ReturnType<typeof createAttachedRuntimeBuiltinToolSurface>): {
  readonly generation: RuntimeCapabilityGeneration;
  readonly descriptor: { readonly capabilityId: string; readonly revision: string; readonly descriptorDigest: `sha256:${string}` };
} {
  const tool = surface.materializableTools.get("managed_agent.invoke");
  const executor = surface.callBuiltinTools.get("managed_agent.invoke");
  if (!tool || !executor) throw new Error("Attached Runtime surface must expose generic managed_agent.invoke.");
  const catalog = buildCapabilityCatalog([capabilityCandidate(tool)], EVALUATED_AT);
  const descriptor = catalog.descriptors[0];
  if (!descriptor) throw new Error(`Synthetic managed capability descriptor is missing: ${JSON.stringify(catalog)}`);
  const implementationReference = descriptor.implementationReferences[0];
  if (!implementationReference) throw new Error("Synthetic managed capability implementation is missing.");
  const generation = createRuntimeCapabilityCompositionFactory({
    catalog,
    evaluatedAt: EVALUATED_AT,
    projectId: "synthetic-managed-child-project",
    appId: "cli-benchmark",
    surfaceId: "benchmark",
    caller: "kiln-runtime",
    materializations: [{
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
      inputSchemaDigest: descriptor.inputSchemaDigest,
      outputSchemaDigest: descriptor.outputSchemaDigest,
      implementationIdentityDigest: implementationReference.identityDigest,
      implementationReference,
      toolName: tool.name,
      tool,
      port: createTrustedRuntimeBuiltinPortableInvocationPort({
        executor,
        kind: "local-function",
        implementationIdentityDigest: implementationReference.identityDigest,
      }),
      requirements: {
        data: descriptor.data,
        network: descriptor.network,
        artifacts: descriptor.artifacts,
      },
      freshness: descriptor.freshness,
    }],
  }).prepare();
  return { generation, descriptor };
}

function genericPermissionPolicy(includeDiscovery: boolean): KilnPermissionPolicy {
  const discoveryTools: KilnToolPermissionRule[] = includeDiscovery
    ? [
        { tool: "capability.search", action: "allow" },
        { tool: "capability.describe", action: "allow" },
      ]
    : [];
  const tools: KilnToolPermissionRule[] = [
    { tool: "managed_agent.*", action: "allow" },
    { tool: "read", action: "allow" },
    ...discoveryTools,
  ];
  return {
    approval: "on-request",
    sandbox: "read-only",
    fileGovernance: { allowGlobs: ["**"] },
    tools,
  };
}

function childProvider(trace: { readonly builtinCalls: { value: number }; readonly providerCalls: { value: number } }): ProviderAdapter {
  let round = 0;
  return {
    name: "synthetic-provider",
    createMessage: vi.fn(async () => {
      trace.providerCalls.value += 1;
      return round++ === 0
        ? response("Read the admitted child fixture.", [{ id: "child-read", name: CHILD_TOOL_NAME, input: { path: "fixture" } }])
        : response("Child finished after the admitted Runtime builtin.");
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function outerProvider(descriptor: { readonly capabilityId: string; readonly revision: string; readonly descriptorDigest: string }, mode: "deny" | "allow") {
  let round = 0;
  const calls: string[][] = [];
  const provider: ProviderAdapter = {
    name: "synthetic-provider",
    createMessage: vi.fn(async (input) => {
      calls.push((input.tools ?? []).map((tool: ToolDefinition) => tool.name));
      if (mode === "deny") {
        return round++ === 0
          ? response("Search for the managed capability.", [{ id: "search-denied", name: "capability.search", input: { query: "managed" } }])
          : response("Capability discovery needs approval.");
      }
      switch (round++) {
        case 0:
          return response("Search for the managed capability.", [{ id: "search", name: "capability.search", input: { query: "managed" } }]);
        case 1:
          return response("Describe the exact capability.", [{
            id: "describe",
            name: "capability.describe",
            input: descriptor,
          }]);
        case 2:
          return response("Invoke the selected managed child.", [{
            id: "invoke",
            name: "managed_agent.invoke",
            input: {
              access: "read-only",
              routeId: "synthetic-direct-route",
              providerRoute: { providerId: "synthetic-provider", model: "synthetic-model" },
              requestedAuthority: "read_only",
              task: "Read the synthetic fixture through the configured child.",
            },
          }]);
        default:
          return response("Managed child completed.");
      }
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
  return { provider, calls };
}

describe("generic managed-child invocation through the benchmark Runtime surface", () => {
  it("requires exact discovery permissions before materializing generic managed_agent.invoke and terminally runs the admitted synthetic child", async () => {
    const budgetAuthority = new SqliteBoundedWorkAuthority({ path: ":memory:" });
    const sharedExecutionBudget = createRuntimeSharedExecutionBudgetScope({
      authority: budgetAuthority, projectRuntimeId: "synthetic", goalRunId: "budget-run", workItemId: "budget-item",
      contractRevision: adoptBoundedWorkExecutionBudgetRevision({
        accountingLineageId: "budget-run", adoptedAt: EVALUATED_AT,
        adoptedBy: { kind: "operator", actorId: "operator", decisionId: "synthetic-decision" },
        limits: { maxExecutionAttempts: 1, maxManagedInvocations: 1, maxConcurrentManagedInvocations: 1, maxChildDepth: 1, maxReviewRounds: 0, maxRemediationRounds: 0, maxToolCalls: 32 },
        policy: { budgetExhaustion: "stop" },
      }),
      route: { routeId: "synthetic-direct-route", harnessId: "runtime" }, harnessCapability: "authoritative",
      limits: { maximumManagedChildren: 1, maximumToolCalls: 32 },
    });
    const parentSession = new RuntimeSession({
      sessionId: "synthetic-parent-session",
      appName: "kiln-cli",
      tenantId: "synthetic",
      userId: "operator",
      systemPrompt: "Synthetic generic managed-child boundary test.",
    });
    const parentTurnId = "synthetic-parent-session:turn:1";
    const baseAdmission = parentAdmission(parentSession.id, parentTurnId);
    const childTrace = { builtinCalls: { value: 0 }, providerCalls: { value: 0 } };
    const persistedAdmissions = new Map<string, EffectiveAuthorityAdmissionBundle>([[baseAdmission.admissionId, baseAdmission]]);
    const sandboxLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({ ...lease, cleanupStatus: "pending" as const })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const service = new RuntimeManagedAgentInvocationService({ sandboxLeaseManager });
    const invocationOwner = {};
    const shutdownOwner = vi.spyOn(service, "shutdownOwner");
    const childTool: ToolDefinition = {
      name: CHILD_TOOL_NAME,
      description: "Read the bounded synthetic fixture under Runtime claims.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
      tags: new Set(["read"]),
    };
    const childCapability: Capability = {
      name: CHILD_TOOL_NAME,
      description: childTool.description,
      schema: childTool.inputSchema,
      tags: ["read"],
      effectEnvelope: OBSERVE_EFFECT,
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      sharedExecutionBudget,
      providerId: "synthetic-provider",
      model: "synthetic-model",
      provider: childProvider(childTrace),
      tools: [childTool],
      builtinTools: new Map([[CHILD_TOOL_NAME, async () => {
        childTrace.builtinCalls.value += 1;
        return "synthetic child read completed";
      }]]),
      capabilityMap: new Map([[CHILD_TOOL_NAME, childCapability]]),
      toolAuthority: new Map([[CHILD_TOOL_NAME, READ_AUTHORITY]]),
      toolInvocationAdmission: createConfiguredInvocationAdmission(genericPermissionPolicy(false)),
      runtimeToolActionClaims: actionClaimStore(),
      runtimeModelRoundActionClaims: modelRoundClaimStore(),
      readAuthorityAdmission: ({ admissionId }) => persistedAdmissions.get(admissionId),
    });
    const route: ManagedInvocationToolRoute = {
      routeId: "synthetic-direct-route",
      routeSource: "explicit-managed-route" as const,
      providerId: "synthetic-provider",
      model: "synthetic-model",
      capability: {
        identity: { routeId: "synthetic-direct-route", revision: "v1" },
        target: { providerId: "synthetic-provider", modelId: "synthetic-model" },
        adapter: { kind: "direct-provider", capabilityId: "synthetic-direct", capabilityVersion: "1" },
        authorityCeiling: "read_only" as const,
        toolNames: [CHILD_TOOL_NAME],
        supportsRecursion: true,
        supportsAttachments: false,
        supportsWrite: false,
        proof: {
          status: "live-proven" as const,
          source: "synthetic",
          freshness: "fresh" as const,
          observedAt: EVALUATED_AT,
          expiresAt: "2026-09-10T00:00:00.000Z",
          provenAccess: ["read-only" as const],
        },
        capacity: { kind: "accountless" as const },
        settlement: { kind: "not-required" as const },
      },
      createAdapter: async () => adapter,
      profiles: [{
        authorityProfileId: "synthetic-readonly",
        access: "read-only" as const,
        allowedToolNames: [CHILD_TOOL_NAME],
        workingDirectory: { path: "C:/synthetic-managed-child", mode: "sandbox" as const },
        timeoutMs: 5_000,
        credentialRoute: { mode: "credentialless" as const },
        memoryScope: { scope: { kind: "project" as const, id: "synthetic" }, access: "read-only" as const },
      }],
    };
    const invocationOptions: ManagedInvocationToolOptions = {
      routes: [route],
      invocationService: service,
      invocationOwner,
      maxParallelChildren: 1,
    };
    const attachment = {
      ...createKilnRuntimeManagedInvocationAttachment("benchmark", invocationOptions),
      childAuthorityAdmission: { bundle: baseAdmission },
    };
    const surface = createAttachedRuntimeBuiltinToolSurface({ managedInvocation: attachment, sharedExecutionBudget });
    try {
      const composed = capabilityGeneration(surface);
      const admission = linkEffectiveAuthorityAdmissionBundleToRuntimeCapabilityGeneration({
        generation: composed.generation,
        authorityAdmission: baseAdmission,
        caller: "kiln-runtime",
      });

      const deniedOuter = outerProvider(composed.descriptor, "deny");
      const denied = new RuntimeSessionOrchestrator({
        provider: deniedOuter.provider,
        model: "synthetic-model",
        tools: [RUNTIME_CAPABILITY_SEARCH_TOOL, RUNTIME_CAPABILITY_DESCRIBE_TOOL],
        capabilityGeneration: composed.generation,
        materializableTools: surface.materializableTools,
        materializableToolBindings: surface.materializableToolBindings,
        toolCatalogSnapshotId: surface.toolCatalogSnapshotId,
      });
      const deniedResult = await denied.processMessage(
        parentSession,
        textParts("Find and invoke a synthetic child."),
        undefined,
        undefined,
        {
          authorityAdmission: admission,
          turnCorrelationId: parentTurnId,
          toolInvocationAdmission: createConfiguredInvocationAdmission(genericPermissionPolicy(false)),
          toolAllowlist: new Set(["capability.search", "capability.describe", "managed_agent.invoke"]),
          runtimeModelRoundDispatch: {
            admission,
            intentFingerprint: DIGEST_A,
            attemptId: "synthetic-parent-denied",
            routeId: "synthetic-direct-route",
            accountId: "synthetic-account",
            credentialRevision: DIGEST_B,
            readAdmission: () => admission,
            store: modelRoundClaimStore(),
          },
          runtimeToolActionClaims: {
            admission,
            attemptId: "synthetic-parent-denied",
            adapterIdentity: "synthetic-parent",
            readAdmission: () => admission,
            store: actionClaimStore(),
          },
        },
      );
      expect(deniedResult.toolExecutions).toContainEqual(expect.objectContaining({
        toolName: "capability.search",
        success: false,
        authority: expect.objectContaining({ requiresApproval: true }),
      }));
      expect(deniedOuter.calls[0]).toEqual(["capability.search", "capability.describe"]);
      expect(service.list()).toHaveLength(0);
      expect(childTrace.builtinCalls.value).toBe(0);

      const allowedOuter = outerProvider(composed.descriptor, "allow");
      const allowed = new RuntimeSessionOrchestrator({
        sharedExecutionBudget,
        provider: allowedOuter.provider,
        model: "synthetic-model",
        tools: [RUNTIME_CAPABILITY_SEARCH_TOOL, RUNTIME_CAPABILITY_DESCRIBE_TOOL],
        capabilityGeneration: composed.generation,
        materializableTools: surface.materializableTools,
        materializableToolBindings: surface.materializableToolBindings,
        toolCatalogSnapshotId: surface.toolCatalogSnapshotId,
      });
      const allowedResult = await allowed.processMessage(
        parentSession,
        textParts("Find and invoke a synthetic child."),
        undefined,
        undefined,
        {
          authorityAdmission: admission,
          turnCorrelationId: parentTurnId,
          toolInvocationAdmission: createConfiguredInvocationAdmission(genericPermissionPolicy(true)),
          toolAllowlist: new Set(["capability.search", "capability.describe", "managed_agent.invoke"]),
          runtimeModelRoundDispatch: {
            admission,
            intentFingerprint: DIGEST_B,
            attemptId: "synthetic-parent-allowed",
            routeId: "synthetic-direct-route",
            accountId: "synthetic-account",
            credentialRevision: DIGEST_B,
            readAdmission: () => admission,
            store: modelRoundClaimStore(),
          },
          runtimeToolActionClaims: {
            admission,
            attemptId: "synthetic-parent-allowed",
            adapterIdentity: "synthetic-parent",
            readAdmission: () => admission,
            store: actionClaimStore(),
          },
        },
      );
      expect(allowedResult.outcome).toBe("completed");
      expect(allowedResult.toolExecutions?.map((execution) => execution.toolName)).toEqual([
        "capability.search",
        "capability.describe",
        "managed_agent.invoke",
      ]);
      expect(allowedOuter.calls).toEqual([
        ["capability.search", "capability.describe"],
        ["capability.search", "capability.describe"],
        ["capability.search", "capability.describe", "managed_agent.invoke"],
        ["capability.search", "capability.describe", "managed_agent.invoke"],
      ]);
      const searchExecution = allowedResult.toolExecutions?.[0];
      const describeExecution = allowedResult.toolExecutions?.[1];
      if (!searchExecution || !describeExecution) throw new Error("Expected search and describe executions.");
      if (typeof searchExecution.output !== "string") throw new Error("Capability search must return serialized output.");
      const searchEnvelope = JSON.parse(searchExecution.output) as { readonly output: string };
      const searchResult = JSON.parse(searchEnvelope.output) as {
        readonly descriptors: readonly { readonly capabilityId: string; readonly revision: string; readonly descriptorDigest: string }[];
      };
      const discoveredDescriptor = searchResult.descriptors[0];
      if (!discoveredDescriptor) throw new Error("Capability search did not return the synthetic managed descriptor.");
      const discoveredIdentity = {
        capabilityId: discoveredDescriptor.capabilityId,
        revision: discoveredDescriptor.revision,
        descriptorDigest: discoveredDescriptor.descriptorDigest,
      };
      expect(discoveredIdentity).toEqual({
        capabilityId: composed.descriptor.capabilityId,
        revision: composed.descriptor.revision,
        descriptorDigest: composed.descriptor.descriptorDigest,
      });
      expect(describeExecution.input).toMatchObject(discoveredIdentity);
      expect(childTrace.providerCalls.value).toBe(2);
      expect(childTrace.builtinCalls.value).toBe(1);
      expect(sharedExecutionBudget.snapshot()).toMatchObject({
        accounting: { managedInvocations: 1, activeManagedInvocations: 0, toolCalls: { kind: "observed", value: 4 } },
        settlement: { status: "settled" },
      });
      expect(service.list()).toHaveLength(1);
      expect(service.list()[0]).toMatchObject({
        lifecycleState: "completed",
        record: {
          lifecycleState: "completed",
          resourceLease: { healthStatus: "released", cleanupStatus: "completed" },
        },
      });
      expect(sandboxLeaseManager.release).toHaveBeenCalledTimes(1);
      await surface.dispose();
      expect(shutdownOwner).toHaveBeenCalledWith(invocationOwner, "Attached runtime tool surface disposed.");
    } finally {
      await surface.dispose();
      budgetAuthority.close();
    }
  });
});
