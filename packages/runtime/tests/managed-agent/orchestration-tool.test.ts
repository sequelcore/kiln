import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
} from "@kilnai/core/agents";
import type { ManagedEconomicSettlement } from "@kilnai/core/cost";
import {
  createManagedAgentOrchestrateToolDefinition,
  createManagedInvocationLifecycleToolExecutors,
  RuntimeManagedAgentInvocationService,
  digestManagedEconomicCandidateProfileAuthority,
  type ManagedAgentRuntimeInvocationInput,
  type ManagedInvocationToolAttachment,
} from "../../src/agents/managed-invocation/index.js";
import type {
  EffectiveTurnAuthoritySnapshot,
  RuntimeBuiltinToolExecutionContext,
} from "../../src/session/runtime-session-orchestrator.types.js";

const TEST_PARENT_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "read_only",
  admittedAuthority: "destructive",
  sourcePolicy: "runtime_surface_projection",
  reason: "managed orchestration test parent turn authority is explicitly admitted",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} satisfies EffectiveTurnAuthoritySnapshot;

describe("managed_agent.orchestrate", () => {
  it("projects configured agent profiles and routes into each work-item schema", () => {
    const definition = createManagedAgentOrchestrateToolDefinition({
      routes: [],
      unavailableRoutes: [{
        routeId: "frontend-readonly",
        routeSource: "explicit-managed-route",
        providerId: "opencode-go",
        model: "kimi-k3",
        profiles: ["foundation-readonly-plan"],
        reason: "schema projection fixture",
      }],
      agentCatalog: [{
        name: "frontend-producer",
        role: "Frontend producer",
        goal: "Produce a bounded visual handoff.",
        tier: "reasoning",
        authorityProfileId: "authority:frontend-readonly",
        admissionProfile: "foundation-readonly-plan",
        routeId: "frontend-readonly",
      }],
    });
    const properties = definition.inputSchema.properties as Record<string, Record<string, unknown>>;
    const workItems = properties.workItems!;
    const items = workItems.items as { properties: Record<string, Record<string, unknown>> };

    expect(items.properties.agentProfile?.enum).toEqual(["frontend-producer"]);
    expect(items.properties.routeId?.enum).toEqual(["frontend-readonly"]);
  });

  it("rejects cyclic work graphs before route selection or child start", async () => {
    const result = await execute({
      profile: "foundation-readonly-plan",
      taskRisk: "medium",
      requiresIndependentReview: false,
      workItems: [
        { id: "a", roleIntent: "scout", task: "Inspect A.", dependencies: ["b"] },
        { id: "b", roleIntent: "verifier", task: "Inspect B.", dependencies: ["a"] },
      ],
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain("dependencies contain a cycle");
  });

  it("returns the canonical denied decision when runtime capacity is unavailable", async () => {
    const result = await execute({
      profile: "foundation-readonly-plan",
      taskRisk: "low",
      requiresIndependentReview: false,
      workItems: [
        { id: "a", roleIntent: "scout", task: "Inspect A." },
      ],
    });

    expect(result).toMatchObject({
      isError: true,
      metadata: {
        operation: "managed_orchestration_denied",
        coordinationDecision: {
          status: "denied",
          missingCapabilities: ["managed-route", "workspace"],
        },
      },
    });
  });

  it("dispatches adapterless economic children through the attached executor with stable caller-bound commitments", async () => {
    const invoked = vi.fn();
    const adapter = economicAdapter(invoked);
    const prepare = vi.fn(async (input) => ({
      status: "prepared" as const,
      commitment: {
        reservation: {
          selectedIdentity: {
            route: {
              routeId: "economic-route",
              providerId: "codex",
              modelId: "gpt-test",
              accountPolicyId: null,
            },
            account: { kind: "accountless" },
          },
        },
      } as never,
      adapter,
      recordExecutionSettlementPending: vi.fn(),
      createExecutionSettlement: () => ({} as never),
      registerEconomicSettlement: (settlement: PromiseLike<ManagedEconomicSettlement>) => void Promise.resolve(settlement),
    }));
    const input = {
      profile: "foundation-readonly-plan",
      taskRisk: "low",
      requiresIndependentReview: false,
      workItems: [
        { id: "economic-a", roleIntent: "scout", task: "Inspect A.", agentProfile: "economic-worker" },
        { id: "economic-b", roleIntent: "verifier", task: "Inspect B.", agentProfile: "economic-worker" },
      ],
    };
    const result = await execute(input, {
      routes: [economicRoute()],
      agentCatalog: [{
        name: "economic-worker",
        role: "Economic worker",
        goal: "Execute after durable economic commitment.",
        tier: "reasoning",
        authorityProfileId: "authority:economic",
        admissionProfile: "foundation-readonly-plan",
        economicPolicyId: "economic-policy",
        economicPolicyRevision: "revision-001",
        economicPolicyCandidateRouteIds: ["economic-route"],
      }],
      invocationService: new RuntimeManagedAgentInvocationService({
        authorityObserver: {
          observe: async () => ({
            approval: "on-request" as const,
            sandbox: "read-only" as const,
            source: "runtime-observation" as const,
            proof: "proven" as const,
            observedAt: "2026-08-01T00:00:00.000Z",
            validUntil: "2099-01-01T00:00:00.000Z",
          }),
        },
      }),
      economicDispatch: { prepare },
    });

    expect(result.isError, result.output).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(invoked).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls.map(([call]) => call.adoptedDecisionAt)).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ]);
    expect(prepare.mock.calls.map(([call]) => call.candidateSet)).toEqual([
      expect.objectContaining({ candidates: [expect.objectContaining({ routeId: "economic-route" })], rejections: [] }),
      expect.objectContaining({ candidates: [expect.objectContaining({ routeId: "economic-route" })], rejections: [] }),
    ]);
    expect(prepare.mock.calls.map(([call]) => call.authorityProfileId)).toEqual([
      "authority:economic",
      "authority:economic",
    ]);
    expect(prepare.mock.calls.map(([call]) => call.invocationId)).toEqual([
      "managed-orchestration:session-test:tool-call-test:child:1",
      "managed-orchestration:session-test:tool-call-test:child:2",
    ]);
    const expectedProfileAuthorityDigest = digestManagedEconomicCandidateProfileAuthority(economicRoute().profiles[0]!);
    expect(prepare.mock.calls.map(([call]) => call.candidateSet.candidates[0]?.profileAuthorityDigest)).toEqual([
      expectedProfileAuthorityDigest,
      expectedProfileAuthorityDigest,
    ]);
    expect(new Set(prepare.mock.calls.map(([call]) => call.jobId)).size).toBe(2);
    expect(new Set(prepare.mock.calls.map(([call]) => call.economicAttemptId)).size).toBe(2);
  });
});

async function execute(input: Record<string, unknown>, optionOverrides: ManagedInvocationToolAttachment["options"] = {}): Promise<{
  readonly output: string;
  readonly isError: boolean;
  readonly metadata: Record<string, unknown>;
}> {
  const attachment: ManagedInvocationToolAttachment = {
    options: {
      routes: [],
      invocationService: new RuntimeManagedAgentInvocationService(),
      maxParallelChildren: 2,
      ...optionOverrides,
    },
    callerIdentity: {
      kind: "kiln-runtime",
      surface: "test",
      attachmentId: "attachment:test",
    },
  };
  const executor = createManagedInvocationLifecycleToolExecutors(attachment)
    .get("managed_agent.orchestrate");
  if (!executor) throw new Error("managed_agent.orchestrate executor was not registered");
  const sessionEvents: any[] = [];
  return await executor(input, {
    session: {
      id: "session-test",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      get sessionEvents() { return sessionEvents; },
      nextSessionEventSequence: () => sessionEvents.length + 1,
      appendSessionEvents: (events: readonly unknown[]) => { sessionEvents.push(...events); },
    } as RuntimeBuiltinToolExecutionContext["session"],
    turnId: "turn-test",
    effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
    toolCall: {
      id: "tool-call-test",
      name: "managed_agent.orchestrate",
      input,
    },
  }) as {
    readonly output: string;
    readonly isError: boolean;
    readonly metadata: Record<string, unknown>;
  };
}

function economicRoute() {
  return {
    routeId: "economic-route",
    routeSource: "explicit-managed-route" as const,
    providerId: "codex",
    model: "gpt-test",
    surface: "cli-harness" as const,
    capability: {
      identity: { routeId: "economic-route", revision: "test-v1" },
      target: { providerId: "codex", modelId: "gpt-test" },
      adapter: { kind: "cli-harness", capabilityId: "codex-direct", capabilityVersion: "1" },
      authorityCeiling: "read_only",
      toolNames: ["read", "grep"],
      supportsRecursion: true,
      supportsAttachments: false,
      supportsWrite: false,
      proof: { status: "configured", source: "test-fixture", provenProfiles: ["foundation-readonly-plan"] },
      capacity: { kind: "accountless" },
      settlement: { kind: "managed-economic-selection", contractVersion: "managed-economic-v1", policyIds: ["economic-policy"], pendingSettlement: "required", recovery: "required" },
    },
    economicPolicyIds: ["economic-policy"],
    economicCapability: {
      status: "verified" as const,
      adapterCapabilityId: "codex-direct",
      adapterCapabilityVersion: "1",
    },
    profiles: [{
        authorityProfileId: "authority:economic",
        admissionProfile: "foundation-readonly-plan" as const,
        permissionProfile: "read-only" as const,
        allowedToolNames: ["read", "grep"],
        workingDirectory: { path: "C:/repo", mode: "read-only" as const },
        timeoutMs: 1000,
        credentialRoute: { mode: "credentialless" as const },
        memoryScope: { scope: { kind: "project" as const, id: "test" }, access: "none" as const },
    }],
  };
}

function economicAdapter(invoked: ReturnType<typeof vi.fn>) {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:economic-test",
      providerId: "codex",
      adapterKind: "harness",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["cli-harness"],
      lifecycle: { exposesStart: true, exposesTerminal: true, exposesCleanup: true },
      cancellation: { supported: true }, timeout: { supported: true, diagnosticArtifactOnTimeout: true },
      transcript: { supported: true, redactionKnown: true, truncationKnown: true, persistenceKnown: true, retentionKnown: true },
      usage: { supported: true, preservesProviderTokenClasses: true, supportsExplicitUnknowns: true, tokenClasses: ["input"], semanticSourceGranularity: "unknown", evidenceBasis: "adapter" },
      resultHandoff: { boundedSummary: true, resourcePointers: true }, credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true }, writeAuthority: { proposalSupported: true, approvedApplySupported: true, memoryProposalSupported: true, rollbackEvidence: true, cleanupEvidence: true, scopeReduction: true }, unsupportedFieldPolicy: "reject", cleanup: { supported: true },
    }),
    invoke: async ({
      request,
      admission,
      registerAdapterCompletion,
    }: ManagedAgentRuntimeInvocationInput) => {
      invoked(request.invocationId);
      registerAdapterCompletion(Promise.resolve());
      return defineManagedAgentInvocationRecord({
        invocationId: request.invocationId, agentId: request.agentId, parentSessionId: request.parentSessionId, parentTurnId: request.parentTurnId,
        profile: request.profile, lifecycleState: "completed", providerRoute: request.providerRoute, adapterKind: request.adapterKind,
        executionMode: request.executionMode, authority: request.authority, capabilitySnapshot: admission.capabilitySnapshot,
        resultHandoff: {
          provenance: { delivery: "runtime-generated", configuredModelId: "gpt-test", observedModelIds: [] },
          summary: "completed", resourceUris: ["kiln://test/economic-handoff"], memoryWriteProposalUris: [],
          structuredResult: {
            version: "structured-execution-result-v1", status: "completed", summary: "completed", uncertainty: 0,
            limitations: [], operatorDecisions: [], evidence: [{ uri: "kiln://test/economic-handoff", kind: "artifact" }], citations: [], warnings: [], failures: [], approvalRequirements: [], residualRisks: ["Synthetic adapter only."], verificationResults: [{ requirementId: "handoff", method: "deterministic", status: "passed", summary: "handoff", evidenceUris: ["kiln://test/economic-handoff"] }],
          },
        },
      });
    },
  };
}
