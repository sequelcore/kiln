import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentResponse,
  AllCredentialsExhaustedError,
  defineManagedAgentInvocationRequest,
  type ManagedAgentCapabilitySnapshotInput,
  type ManagedAgentInvocationRecord,
  type ManagedAgentInvocationRequest,
  type ProviderAdapter,
  type ToolDefinition,
} from "@kilnai/core/agents";
import { textParts, type AuthorityDescriptor, type Capability } from "@kilnai/core/engine";
import { createSessionBuiltinToolOptions } from "@kilnai/core/tools";
import {
  ManagedRuntimeSandboxLeaseManager,
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService as ProductionRuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeInvocationLifecycleOptions,
} from "../../src/agents/managed-invocation/index.js";
import {
  ManagedDirectProviderRuntimeAdapter as ProductionManagedDirectProviderRuntimeAdapter,
  type ManagedDirectProviderRuntimeAdapterConfig,
} from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import { ManagedEconomicLifecycleTimeoutError } from "../../src/agents/managed-invocation/economic-dispatch-coordinator.js";
import { createInternalConsumedWriteApproval } from "../../src/agents/managed-invocation/internal-consumed-write-approval.js";
import { terminalManagedInvocationResult } from "../../src/agents/managed-invocation/runtime-tool/result-projection.js";
import { createAttachedRuntimeBuiltinToolSurface } from "../../src/gateway/attached-runtime-tool-surface.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { deriveRuntimeConvergencePolicyInput } from "../../src/session/runtime-execution-envelope.js";
import type { RuntimeBuiltinToolExecutor } from "../../src/session/runtime-session-orchestrator.types.js";
import type { EffectiveTurnAuthoritySnapshot } from "../../src/session/runtime-session-orchestrator.types.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import type {
  RuntimeModelRoundActionClaim,
  RuntimeModelRoundActionClaimPermit,
  RuntimeModelRoundActionClaimStore,
} from "../../src/execution-kernel/runtime-model-round-action-claim.js";
import type { ManagedAgentRuntimeInvocationInput } from "../../src/agents/managed-invocation/index.js";
import { createFixtureToolActionStore } from "../session/runtime-claim-fixture.js";

function makeDirectTestExecutionEnvelope(toolRounds: number) {
  return {
    convergence: deriveRuntimeConvergencePolicyInput({
      policyId: "kiln.managed-direct.test",
      toolRounds,
    }),
  };
}

const DIRECT_TEST_ADMISSIONS = new Map<string, EffectiveAuthorityAdmissionBundle>();

function directTestModelRoundStore(): RuntimeModelRoundActionClaimStore {
  const claims = new Map<string, RuntimeModelRoundActionClaim>();
  const permitStates = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
  return {
    claim(input) {
      if (claims.has(input.claimId)) throw new Error("direct test model-round claim already exists");
      const state = { claimId: input.claimId, consumed: false };
      const permit = Object.freeze({
        claimId: input.claimId,
        permitId: `direct-test-model-round:${input.claimId}`,
        consume: () => {
          if (state.consumed) throw new Error("direct test model-round permit already consumed");
          state.consumed = true;
        },
      }) as unknown as RuntimeModelRoundActionClaimPermit;
      claims.set(input.claimId, input);
      permitStates.set(permit, state);
      return permit;
    },
    settle(permit, settlement) {
      const state = permitStates.get(permit);
      const claim = claims.get(permit.claimId);
      if (!state || !claim || !state.consumed) throw new Error("direct test model-round permit was not consumed");
      claims.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "success"
          ? { outcome: "success" as const }
          : { outcome: "unknown" as const, unknownReason: settlement.reason }),
      });
      permitStates.delete(permit);
    },
  };
}

function directTestRequestWithInternalHandoff(request: ManagedAgentInvocationRequest): ManagedAgentInvocationRequest {
  if (request.input.handoff === undefined) return request;
  const allowedToolNames = [...new Set([
    ...request.authority.toolAuthority.allowedToolNames,
    "managed_agent.submit_handoff",
  ])];
  return {
    ...request,
    authority: {
      ...request.authority,
      toolAuthority: {
        ...request.authority.toolAuthority,
        allowedToolNames,
      },
    },
  };
}

function directTestAdmission(
  request: ManagedAgentInvocationRequest,
  economicCommitmentId: string | undefined,
): EffectiveAuthorityAdmissionBundle {
  const routeId = `${request.providerRoute.providerId}:${request.access}`;
  const model = request.providerRoute.model ?? "test-model";
  const accountId = `direct-test-account:${request.invocationId}`;
  const credentialRevision = "direct-test-credential-revision";
  const allowedToolNames = [...new Set([
    ...request.authority.toolAuthority.allowedToolNames,
    ...(request.input.resourceUris?.length ? ["resource_read"] : []),
  ])].sort();
  const observeEffect = {
    operation: "observe" as const,
    boundaries: ["process", "workspace", "machine", "network", "external-system"] as const,
    reversibility: "reversible" as const,
    dataEgress: "sensitive-data" as const,
    identityUse: "privileged" as const,
    consequences: ["local-state", "external-state", "financial", "legal", "security"] as const,
    idempotency: "idempotent" as const,
  };
  const parentEffectCeiling = {
    operation: "mutate" as const,
    boundaries: ["process", "workspace", "machine", "network", "external-system"] as const,
    reversibility: "irreversible" as const,
    dataEgress: "sensitive-data" as const,
    identityUse: "privileged" as const,
    consequences: ["local-state", "external-state", "financial", "legal", "security"] as const,
    idempotency: "non-idempotent" as const,
  };
  const toolPermissions: EffectiveAuthorityAdmissionBundle["turn"]["tools"]["allowedToolPermissions"] = allowedToolNames.map((toolName) => ({
    toolName,
    authority: {
      level: request.authority.toolAuthority.writeAllowed ? 3 : 1,
      allowed: true,
      requiresApproval: false,
    reason: "policy-admitted",
    },
    effectEnvelope: observeEffect,
  }));
  const authority = {
    ...TEST_PARENT_AUTHORITY,
    toolCount: toolPermissions.length,
    deniedToolCount: 0,
  } as const;
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: request.parentSessionId,
    turnId: request.parentTurnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "direct-test", revisions: { tests: "direct-test" } },
      turnRevision: { revisionSetId: "direct-test", revisions: { tests: "direct-test" } },
    },
    session: {
      skillCatalog: { catalogId: "direct-test", revision: "direct-test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "direct provider test admission" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority,
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: toolPermissions, deniedToolNames: [] },
      effectCeiling: parentEffectCeiling,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: routeId,
          providerId: request.providerRoute.providerId,
          providerModelId: model,
          accountSelection: { kind: "operator-override", accountPolicyId: "direct-test-policy", accountId },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId, accountId, credentialId: "direct-test-credential", credentialRevision },
        ...(economicCommitmentId
          ? { economicCommitment: { commitmentId: economicCommitmentId, authorityRevision: "direct-test-authority-revision" } }
          : {}),
      },
    },
  });
}

type DirectTestAdapterConfig = Omit<ManagedDirectProviderRuntimeAdapterConfig, "readAuthorityAdmission" | "runtimeModelRoundActionClaims" | "runtimeToolActionClaims">
  & Partial<Pick<ManagedDirectProviderRuntimeAdapterConfig, "readAuthorityAdmission" | "runtimeModelRoundActionClaims" | "runtimeToolActionClaims">>;

class ManagedDirectProviderRuntimeAdapter extends ProductionManagedDirectProviderRuntimeAdapter {
  constructor(config: DirectTestAdapterConfig) {
    const fallbackObserveEffect = {
      operation: "observe" as const,
      boundaries: ["process", "workspace", "machine", "network", "external-system"] as const,
      reversibility: "reversible" as const,
      dataEgress: "sensitive-data" as const,
      identityUse: "privileged" as const,
      consequences: ["local-state", "external-state", "financial", "legal", "security"] as const,
      idempotency: "idempotent" as const,
    };
    const fallbackMutateEffect = {
      ...fallbackObserveEffect,
      operation: "mutate" as const,
      reversibility: "compensatable" as const,
      idempotency: "non-idempotent" as const,
    };
    const fallbackNames = new Set([
      "read",
      "write",
      "resource_read",
      ...config.tools.map(({ name }) => name),
      ...config.builtinTools.keys(),
    ]);
    const fallbackCapabilities = new Map<string, Capability>([
      ...fallbackNames,
    ].map((name) => {
      const definition = config.tools.find((tool) => tool.name === name);
      return [name, {
        name,
        description: definition?.description ?? name,
        schema: definition?.inputSchema ?? { type: "object", additionalProperties: true },
        tags: [...(definition?.tags ?? [])].map(String),
        effectEnvelope: name === "write" ? fallbackMutateEffect : fallbackObserveEffect,
      }];
    }));
    const fallbackAuthority = new Map<string, AuthorityDescriptor>([
      ...fallbackNames,
    ].map((name) => [name, {
      level: name === "write" ? 3 : 1,
      allowed: true,
      requiresApproval: false,
      reason: "direct provider test authority",
    }]));
    super({
      ...config,
      ...(config.capabilityMap === undefined ? { capabilityMap: fallbackCapabilities } : {}),
      ...(config.toolAuthority === undefined ? { toolAuthority: fallbackAuthority } : {}),
      runtimeToolActionClaims: config.runtimeToolActionClaims ?? createFixtureToolActionStore(),
      runtimeModelRoundActionClaims: directTestModelRoundStore(),
      readAuthorityAdmission: async ({ admissionId }) => DIRECT_TEST_ADMISSIONS.get(admissionId),
    });
  }

  override invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord> {
    const bundle = input.childAuthorityAdmission?.bundle;
    if (bundle) DIRECT_TEST_ADMISSIONS.set(bundle.admissionId, bundle);
    return super.invoke(input);
  }
}

class RuntimeManagedAgentInvocationService extends ProductionRuntimeManagedAgentInvocationService {
  override start(
    request: ManagedAgentInvocationRequest,
    adapter: ProductionManagedDirectProviderRuntimeAdapter,
    capabilitySnapshotInput: ManagedAgentCapabilitySnapshotInput,
    lifecycleOptions: ManagedAgentRuntimeInvocationLifecycleOptions = {},
  ) {
    const admittedRequest = directTestRequestWithInternalHandoff(request);
    return super.start(
      admittedRequest,
      adapter,
      capabilitySnapshotInput,
      {
        ...lifecycleOptions,
        childAuthorityAdmission: lifecycleOptions.childAuthorityAdmission ?? {
          bundle: directTestAdmission(admittedRequest, lifecycleOptions.economicDispatch?.commitment.commitmentId),
        },
      },
    );
  }

  override invoke(
    request: ManagedAgentInvocationRequest,
    adapter: ProductionManagedDirectProviderRuntimeAdapter,
    capabilitySnapshotInput: ManagedAgentCapabilitySnapshotInput,
    lifecycleOptions: ManagedAgentRuntimeInvocationLifecycleOptions = {},
  ) {
    const admittedRequest = directTestRequestWithInternalHandoff(request);
    return super.invoke(
      admittedRequest,
      adapter,
      capabilitySnapshotInput,
      {
        ...lifecycleOptions,
        childAuthorityAdmission: lifecycleOptions.childAuthorityAdmission ?? {
          bundle: directTestAdmission(admittedRequest, lifecycleOptions.economicDispatch?.commitment.commitmentId),
        },
      },
    );
  }
}

const TEST_PARENT_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "read_only",
  admittedAuthority: "destructive",
  sourcePolicy: "runtime_surface_projection",
  reason: "direct-provider test parent turn authority is explicitly admitted",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} satisfies EffectiveTurnAuthoritySnapshot;

const READ_TOOL: ToolDefinition = {
  name: "read",
  description: "Read a governed resource.",
  inputSchema: {},
  tags: new Set(["read"]),
};

const WRITE_TOOL: ToolDefinition = {
  name: "write",
  description: "Write a governed resource.",
  inputSchema: {},
  tags: new Set(["write"]),
};

const LIVE_PROVEN_DIRECT_WRITE_AUTHORITY = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;

function response(
  text: string,
  toolCalls: AgentResponse["toolCalls"] = [],
): AgentResponse {
  return {
    parts: textParts(text),
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 1,
    cacheWriteTokens: 0,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
  };
}

function providerWithResponses(
  responses: readonly AgentResponse[],
  providerName = "openai",
): ProviderAdapter {
  let index = 0;
  return {
    name: providerName,
    createMessage: vi.fn(async () => responses[Math.min(index++, responses.length - 1)]!),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function request(overrides: Partial<Parameters<typeof defineManagedAgentInvocationRequest>[0]> = {}) {
  return defineManagedAgentInvocationRequest({
    invocationId: "inv-direct-1",
    agentId: "direct-readonly:read-only",
    parentSessionId: "parent-session",
    parentTurnId: "parent-session:turn:1",
    access: "read-only",
    requestedBy: "assistant",
    requestSource: "test",
    providerRoute: {
      providerId: "openai",
      surface: "direct-provider",
      model: "gpt-test",
    },
    adapterKind: "direct",
    executionMode: "direct-provider",
    authority: {
      authorityProfileId: "authority:direct-readonly:read-only",
      toolAuthority: {
        allowedToolNames: ["read"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/repo",
        mode: "read-only",
      },
      timeoutMs: 5000,
      credentialRoute: {
        mode: "credentialless",
      },
      memoryScope: {
        scope: { kind: "project", id: "repo" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect docs.",
      prompt: "Read the docs and summarize risks.",
    },
    ...overrides,
  });
}

function snapshotInputFor(
  childRequest: ManagedAgentInvocationRequest,
): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: `${childRequest.providerRoute.providerId}:${childRequest.access}`,
    routeSource: "explicit-managed-route",
  };
}

function approvedWriteRequest() {
  const base = request({ invocationId: "agent-task:direct-write-1" });
  return request({
    agentId: "direct-write:approved-write",
    access: "approved-write",
    requestedAuthority: "destructive",
    authorityApproval: { approved: true },
    authority: {
      ...base.authority,
      toolAuthority: {
        allowedToolNames: ["write"],
        writeAllowed: true,
        networkAllowed: false,
      },
      workingDirectory: { path: "C:/repo", mode: "workspace-write" },
          writeAuthority: {
        scope: {
          workspace: { mode: "apply-approved", allowedPaths: ["C:/repo"], deniedPaths: [] },
          memory: { operations: [] },
          artifacts: { mode: "none", resourceUris: [], retention: "none" },
          tools: { allowedToolNames: ["write"], deniedToolNames: [] },
        },
        approval: { mode: "required-before-apply", evidenceRequired: true },
      },
    },
  });
}

function consumedWriteApprovalFor(childRequest: ManagedAgentInvocationRequest) {
  return createInternalConsumedWriteApproval({
    approvalId: "managed-write-approval:test-approved-write",
    state: "consumed",
    binding: {
      projectId: "test-project",
      jobId: childRequest.invocationId.slice("agent-task:".length),
      callerId: childRequest.requestedBy,
      workItemFingerprint: "a".repeat(64),
      configuredAgentProfileId: childRequest.agentId,
      access: "approved-write",
      routeId: snapshotInputFor(childRequest).routeId,
      providerId: childRequest.providerRoute.providerId,
      model: childRequest.providerRoute.model ?? "unknown",
      adapterCapabilityId: "test-adapter",
      adapterCapabilityVersion: "1",
      authorityDigest: "b".repeat(64),
      effectDigest: "c".repeat(64),
      revisionDigest: "d".repeat(64),
    },
    issuedAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2099-08-10T00:00:00.000Z",
    approverId: "operator",
    consumedAt: "2026-08-10T00:00:01.000Z",
    consumedBy: childRequest.invocationId,
  });
}

function invokeManaged(
  service: RuntimeManagedAgentInvocationService,
  childRequest: ManagedAgentInvocationRequest,
  adapter: ManagedDirectProviderRuntimeAdapter,
  lifecycleOptions: ManagedAgentRuntimeInvocationLifecycleOptions = {},
) {
  return service.invoke(childRequest, adapter, snapshotInputFor(childRequest), lifecycleOptions);
}

function startManaged(
  service: RuntimeManagedAgentInvocationService,
  childRequest: ManagedAgentInvocationRequest,
  adapter: ManagedDirectProviderRuntimeAdapter,
) {
  return service.start(childRequest, adapter, snapshotInputFor(childRequest));
}

describe("ManagedDirectProviderRuntimeAdapter", () => {
  it("requires the canonical AgentTask identity for a consumed write approval", async () => {
    const provider = providerWithResponses([response("must not execute")]);
    const childRequest = approvedWriteRequest();
    const legacyInvocation = { ...childRequest, invocationId: "managed-job:direct-write-1" };
    const adapter = new ManagedDirectProviderRuntimeAdapter({ providerId: "openai", model: "gpt-test", provider, tools: [], builtinTools: new Map() });

    await expect(new RuntimeManagedAgentInvocationService().start(
      legacyInvocation,
      adapter,
      snapshotInputFor(legacyInvocation),
      { consumedWriteApproval: consumedWriteApprovalFor(childRequest) },
    )).rejects.toThrow("Consumed managed write approval");
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("rejects matching consumed-write data when it was not minted by the approval authority bridge", async () => {
    const provider = providerWithResponses([response("must not execute")]);
    const childRequest = approvedWriteRequest();
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
    });

    await expect(new RuntimeManagedAgentInvocationService().start(
      childRequest,
      adapter,
      snapshotInputFor(childRequest),
      {
        consumedWriteApproval: {
          ...consumedWriteApprovalFor(childRequest),
        } as never,
      },
    )).rejects.toThrow("Consumed managed write approval");
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("rejects an economic adapter before provider effect when typed settlement ownership is absent", async () => {
    const provider = providerWithResponses([response("must not execute")]);
    const childRequest = request();
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
      economicIdentity: {
        route: {
          routeId: `${childRequest.providerRoute.providerId}:${childRequest.access}`,
          providerId: "openai",
          modelId: "gpt-test",
          accountPolicyId: null,
        },
        account: { kind: "accountless" },
      } as never,
    });

    await expect(invokeManaged(
      new RuntimeManagedAgentInvocationService(),
      childRequest,
      adapter,
    )).rejects.toThrow(/typed economic settlement ownership/u);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("rejects an economic identity whose provider or model differs from the adapter route", () => {
    expect(() => new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider: providerWithResponses([response("must not execute")]),
      tools: [],
      builtinTools: new Map(),
      economicIdentity: {
        route: { providerId: "openai", modelId: "different-model" },
        account: { kind: "accountless" },
      } as never,
    })).toThrow(/economic identity does not match/u);
  });

  it("reports committed actual identity and exact provider units for economic settlement", async () => {
    const provider = providerWithResponses([response("Economic work completed.")]);
    const childRequest = request();
    const routeId = `${childRequest.providerRoute.providerId}:${childRequest.access}`;
    const economicIdentity = {
      route: {
        routeId,
        providerId: "openai",
        modelId: "gpt-test",
        accountPolicyId: null,
      },
      account: { kind: "accountless" as const },
    } as never;
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
      economicIdentity,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });
    const createExecutionSettlement = vi.fn(() => ({} as never));
    const registerEconomicSettlement = vi.fn();
    const service = new RuntimeManagedAgentInvocationService();

    const started = await service.start(childRequest, adapter, snapshotInputFor(childRequest), {
      economicDispatch: {
        commitment: {
          commitmentId: "commitment-direct",
          reservation: {
            reservationId: "reservation-direct",
            jobId: "job-direct",
            economicAttemptId: "economic-attempt-direct",
            policy: {} as never,
            selectedIdentity: economicIdentity,
            priceIdentity: null,
            envelope: { kind: "bounded", digest: `sha256:${"a".repeat(64)}`, limits: [] },
            amounts: [],
            authorityRevision: `sha256:${"b".repeat(64)}`,
          },
          rejected: [],
          notSelected: [],
        },
        dispatchFenceId: "dispatch-fence-direct",
        recordExecutionSettlementPending: vi.fn(),
        createExecutionSettlement,
        registerEconomicSettlement,
      },
    });
    expect(started.status).toBe("started");
    await service.join(childRequest.invocationId);

    await vi.waitFor(() => expect(registerEconomicSettlement).toHaveBeenCalledOnce());
    expect(createExecutionSettlement).toHaveBeenCalledWith({
      actualIdentity: economicIdentity,
      usage: {
        kind: "complete",
        units: [
          { atoms: "10", scale: 0, unit: "input-token", scheme: { kind: "unit" } },
          { atoms: "5", scale: 0, unit: "output-token", scheme: { kind: "unit" } },
          { atoms: "1", scale: 0, unit: "cache-read-token", scheme: { kind: "unit" } },
          { atoms: "0", scale: 0, unit: "cache-write-token", scheme: { kind: "unit" } },
        ],
      },
      evidence: {
        sourceIdentity: "managed-direct-runtime:openai:gpt-test",
        sourceRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        observedAt: "2026-08-01T12:00:00.000Z",
        validUntil: "2026-08-01T12:05:00.000Z",
        confidence: "medium",
        authority: "calculated-estimate",
      },
    });
  });

  it("reports provider failures as incomplete economic usage", async () => {
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async () => {
        throw new Error("provider exploded");
      }),
      streamMessage: async function* (): AsyncGenerator<never> {
        return;
      },
    };
    const childRequest = request();
    const economicIdentity = {
      route: {
        routeId: `${childRequest.providerRoute.providerId}:${childRequest.access}`,
        providerId: "openai",
        modelId: "gpt-test",
        accountPolicyId: null,
      },
      account: { kind: "accountless" as const },
    } as never;
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
      economicIdentity,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });
    const createExecutionSettlement = vi.fn(() => ({} as never));
    const registerEconomicSettlement = vi.fn();
    const service = new RuntimeManagedAgentInvocationService();

    const started = await service.start(childRequest, adapter, snapshotInputFor(childRequest), {
      economicDispatch: {
        commitment: {
          commitmentId: "commitment-direct-failure",
          reservation: {
            reservationId: "reservation-direct-failure",
            jobId: "job-direct-failure",
            economicAttemptId: "economic-attempt-direct-failure",
            policy: {} as never,
            selectedIdentity: economicIdentity,
            priceIdentity: null,
            envelope: { kind: "bounded", digest: `sha256:${"a".repeat(64)}`, limits: [] },
            amounts: [],
            authorityRevision: `sha256:${"b".repeat(64)}`,
          },
          rejected: [],
          notSelected: [],
        },
        dispatchFenceId: "dispatch-fence-direct-failure",
        recordExecutionSettlementPending: vi.fn(),
        createExecutionSettlement,
        registerEconomicSettlement,
      },
    });
    expect(started.status).toBe("started");
    await service.join(childRequest.invocationId);

    await vi.waitFor(() => expect(registerEconomicSettlement).toHaveBeenCalledOnce());
    expect(createExecutionSettlement).toHaveBeenCalledWith(expect.objectContaining({
      actualIdentity: economicIdentity,
      usage: {
        kind: "incomplete",
        knownUnits: [],
        reason: "provider-usage-unknown:cache_read,cache_write,input,output",
      },
    }));
  });

  it("settles explicit provider quota rejection as unknown after the model claim", async () => {
    const provider: ProviderAdapter = {
      name: "opencode-go",
      createMessage: vi.fn(async () => {
        throw new AllCredentialsExhaustedError(
          new Error("provider rejected request"),
          { type: "quota-exceeded" },
        );
      }),
      streamMessage: async function* (): AsyncGenerator<never> {
        return;
      },
    };
    const childRequest = request({
      providerRoute: { providerId: "opencode-go", surface: "direct-provider", model: "kimi-k2.6" },
    });
    const economicIdentity = {
      route: {
        routeId: "opencode-go:read-only",
        providerId: "opencode-go",
        modelId: "kimi-k2.6",
        accountPolicyId: "opencode-go-subscription",
      },
      account: { kind: "accountless" as const },
    } as never;
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "opencode-go",
      model: "kimi-k2.6",
      provider,
      tools: [],
      builtinTools: new Map(),
      economicIdentity,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });
    const subscriptionSettlement = { kind: "subscription" } as never;
    const createExecutionSettlement = vi.fn(() => subscriptionSettlement);
    const registerEconomicSettlement = vi.fn();
    const service = new RuntimeManagedAgentInvocationService();

    const started = await service.start(childRequest, adapter, snapshotInputFor(childRequest), {
      economicDispatch: {
        commitment: {
          commitmentId: "commitment-direct-quota",
          reservation: {
            reservationId: "reservation-direct-quota",
            jobId: "job-direct-quota",
            economicAttemptId: "economic-attempt-direct-quota",
            policy: {} as never,
            selectedIdentity: economicIdentity,
            priceIdentity: null,
            envelope: { kind: "bounded", digest: `sha256:${"a".repeat(64)}`, limits: [] },
            amounts: [],
            authorityRevision: `sha256:${"b".repeat(64)}`,
          },
          rejected: [],
          notSelected: [],
        },
        dispatchFenceId: "dispatch-fence-direct-quota",
        recordExecutionSettlementPending: vi.fn(),
        createExecutionSettlement,
        registerEconomicSettlement,
      },
    });
    expect(started.status).toBe("started");
    const completed = await service.join(childRequest.invocationId);
    expect(completed).toMatchObject({
      status: "completed",
      record: {
        diagnostics: [{ kind: "failure" }],
      },
    });

    await vi.waitFor(() => expect(registerEconomicSettlement).toHaveBeenCalledOnce());
    await expect(registerEconomicSettlement.mock.calls[0]?.[0]).resolves.toBe(subscriptionSettlement);
    expect(createExecutionSettlement).toHaveBeenCalledWith(expect.objectContaining({
      actualIdentity: economicIdentity,
      usage: {
        kind: "incomplete",
        knownUnits: [],
        reason: "provider-usage-unknown:cache_read,cache_write,input,output",
      },
    }));
  });

  it("projects the managed handoff contract into the child prompt and accepts its structured result", async () => {
    const structuredResult = {
      version: "structured-execution-result-v1",
      status: "completed",
      summary: "README heading verified.",
      limitations: [],
      operatorDecisions: [],
      evidence: [{ uri: "kiln://managed-invocations/inv-direct-1/readme", kind: "artifact" }],
      citations: [],
      warnings: [],
      failures: [],
      approvalRequirements: [],
      residualRisks: ["Only the requested heading was verified."],
      verificationResults: [{
        requirementId: "readme-heading",
        method: "deterministic",
        status: "passed",
        summary: "The heading was read from README.md.",
        evidenceUris: ["kiln://managed-invocations/inv-direct-1/readme"],
      }],
    } as const;
    const provider = providerWithResponses([
      response("Submitting the governed result.", [{
        id: "handoff-1",
        name: "managed_agent.submit_handoff",
        input: structuredResult,
      }]),
      response("Handoff submitted."),
    ]);
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", vi.fn(async () => "# Kiln")]]),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request({
      input: {
        summary: "Verify the README heading.",
        prompt: "Read README.md and report its first heading.",
        handoff: {
          roleIntent: "verifier",
          expectedEvidence: ["result-handoff"],
          requiredResultFields: ["summary", "evidence", "verificationResults"],
          doneCriteria: ["Return the verified heading."],
          residualRiskRequired: true,
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed");
    expect(result.record.resultHandoff?.structuredResult).toMatchObject({
      version: "structured-execution-result-v1",
      status: "completed",
      summary: "README heading verified.",
      residualRisks: ["Only the requested heading was verified."],
      verificationResults: [expect.objectContaining({ requirementId: "readme-heading", status: "passed" })],
    });
    const firstProviderCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(JSON.stringify(firstProviderCall)).toContain("Managed Result Handoff Contract");
    expect(JSON.stringify(firstProviderCall)).toContain("structured-execution-result-v1");
    expect(JSON.stringify(firstProviderCall)).toContain("residualRisks");
    expect(firstProviderCall.tools).toContainEqual(expect.objectContaining({
      name: "managed_agent.submit_handoff",
      strict: true,
      inputSchema: expect.objectContaining({
        type: "object",
        additionalProperties: false,
      }),
    }));
  });

  it("requests one handoff round when the child finishes without submitting its handoff", async () => {
    const structuredResult = {
      version: "structured-execution-result-v1",
      status: "completed",
      summary: "README heading verified.",
      limitations: [],
      operatorDecisions: [],
      evidence: [{ uri: "kiln://managed-invocations/inv-direct-1/readme", kind: "artifact" }],
      citations: [],
      warnings: [],
      failures: [],
      approvalRequirements: [],
      residualRisks: ["Only the requested heading was verified."],
      verificationResults: [{
        requirementId: "readme-heading",
        method: "deterministic",
        status: "passed",
        summary: "The heading was read from README.md.",
        evidenceUris: ["kiln://managed-invocations/inv-direct-1/readme"],
      }],
    } as const;
    const provider = providerWithResponses([
      response("The inspection is complete."),
      response("", [{
        id: "handoff-finalization",
        name: "managed_agent.submit_handoff",
        input: structuredResult,
      }]),
      response("Handoff submitted."),
    ]);
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", vi.fn(async () => "# Kiln")]]),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request({
      input: {
        summary: "Verify the README heading.",
        handoff: {
          requiredResultFields: ["summary", "evidence", "verificationResults", "residualRisks"],
          residualRiskRequired: true,
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed");
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.resultHandoff?.structuredResult).toMatchObject({
      summary: "README heading verified.",
    });
    expect(result.record.usage?.tokenClasses).toEqual(expect.arrayContaining([
      { name: "input", value: 30 },
      { name: "output", value: 15 },
    ]));
    expect(result.record.providerRequestObservations).toHaveLength(3);
    expect(result.record.providerRequestObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        managedInvocation: {
          invocationId: "inv-direct-1",
          childSessionId: expect.any(String),
          childTurnId: expect.any(String),
        },
        cache: {
          partitionIdentity: expect.objectContaining({ state: "observed" }),
          regions: expect.any(Array),
          measurement: expect.any(String),
          readTokens: expect.any(Number),
          writeTokens: expect.any(Number),
        },
      }),
    ]));
    const toolProjection = terminalManagedInvocationResult({
      toolName: "managed_agent.join",
      rawInput: {},
      routeId: "openai:read-only",
      request: request({
        input: {
          summary: "Verify the README heading.",
          handoff: {
            requiredResultFields: ["summary", "evidence", "verificationResults", "residualRisks"],
            residualRiskRequired: true,
          },
        },
      }),
      record: result.record,
      sessionEventIds: [],
    });
    expect(JSON.parse(toolProjection.output)).not.toHaveProperty("providerRequestObservations");
    expect(toolProjection.metadata.providerRequestObservations).toHaveLength(3);
    expect(provider.createMessage).toHaveBeenCalledTimes(3);
    expect((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toMatchObject({
      tools: [expect.objectContaining({ name: "managed_agent.submit_handoff", strict: true })],
      toolChoice: { type: "tool", name: "managed_agent.submit_handoff" },
    });
    expect((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[2]?.[0].toolChoice).toBeUndefined();
  });

  it("returns a replayable failed record when handoff recovery still produces no handoff", async () => {
    const provider = providerWithResponses([
      response("The inspection is complete."),
      response("I forgot to call the required handoff tool."),
    ]);
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", vi.fn(async () => "# Kiln")]]),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request({
      input: {
        summary: "Verify the README heading.",
        handoff: {
          requiredResultFields: ["summary", "verificationResults"],
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected terminal invocation");
    expect(result.record).toMatchObject({
      lifecycleState: "failed",
      diagnostics: [{ kind: "failure" }],
      resultHandoff: {
        summary: "I forgot to call the required handoff tool.",
      },
    });
    expect(provider.createMessage).toHaveBeenCalledTimes(2);
  });

  it("runs a child RuntimeSessionOrchestrator and returns the shared managed invocation record shape", async () => {
    const provider = providerWithResponses([
      response("reading", [{ id: "tool-1", name: "read", input: { uri: "kiln://docs/a" } }]),
      response("Direct child completed."),
    ]);
    const readTool = vi.fn(async () => "doc contents");
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", readTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await invokeManaged(service, request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(readTool).toHaveBeenCalledWith(
      { uri: "kiln://docs/a" },
      expect.objectContaining({ sandbox: expect.any(Object) }),
    );
    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(result.record).toMatchObject({
      invocationId: "inv-direct-1",
      lifecycleState: "completed",
      adapterKind: "direct",
      executionMode: "direct-provider",
      providerRoute: {
        providerId: "openai",
        surface: "direct-provider",
        model: "gpt-test",
      },
      childSessionId: "parent-session:managed:inv-direct-1",
      resultHandoff: {
        summary: "Direct child completed.",
        resourceUris: [
          "kiln://managed-agents/invocations/inv-direct-1/transcript",
          "kiln://managed-agents/invocations/inv-direct-1/resources/child-execution",
        ],
        memoryWriteProposalUris: [],
      },
      usage: {
        source: "runtime",
        tokenClasses: [
          { name: "input", value: 20 },
          { name: "output", value: 10 },
          { name: "cache_read", value: 2 },
          { name: "cache_write", value: 0 },
        ],
      },
    });
    expect(result.record.replayResources?.[0]).toMatchObject({
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/child-execution",
      title: "Managed invocation child execution evidence",
      mimeType: "text/markdown",
    });
    expect(result.record.replayResources?.[0]?.text).toContain("Disposition reason: completion_eligible");
    expect(result.record.replayResources?.[0]?.text).toContain("Tool executions: 1");
    expect(result.record.replayResources?.[0]?.text).toContain("## Tool 1: read");
    expect(result.record.replayResources?.[0]?.text).toContain("doc contents");
  });

  it("reports child runtime tool events through managed invocation progress", async () => {
    const provider = providerWithResponses([
      response("reading", [{ id: "tool-1", name: "read", input: { uri: "kiln://docs/a" } }]),
      response("Direct child completed."),
    ]);
    const readTool = vi.fn(async () => "doc contents");
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", readTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await invokeManaged(service, request(), adapter);
    const snapshot = service.status("inv-direct-1");

    expect(result.status).toBe("completed");
    expect(snapshot?.progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "tool_called",
        summary: "read called",
        toolName: "read",
      }),
      expect.objectContaining({
        kind: "tool_result",
        summary: "read succeeded",
        toolName: "read",
        success: true,
      }),
    ]));
  });

  it("admits explicit read-only reference roots into the direct child sandbox", async () => {
    const provider = providerWithResponses([
      response("reading reference", [{
        id: "tool-read-reference",
        name: "read",
        input: { filePath: "/workspace/references/t1code/src/app/layout.tsx" },
      }]),
      response("Reference evidence collected."),
    ]);
    const readTool = vi.fn(async (_input, context) => {
      const sandbox = context?.sandbox as { readonly policy?: { canRead(filePath: string): boolean; canWrite(filePath: string): boolean } } | undefined;
      const filePath = "/workspace/references/t1code/src/app/layout.tsx";
      return sandbox?.policy?.canRead(filePath) === true && sandbox.policy.canWrite(filePath) === false
        ? "reference file visible read-only"
        : "reference file denied";
    });
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", readTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await invokeManaged(service, request({
      authority: {
        authorityProfileId: "authority:direct-readonly:read-only",
        toolAuthority: {
          allowedToolNames: ["read"],
          writeAllowed: false,
          networkAllowed: false,
        },
        workingDirectory: {
          path: "/workspace/kiln",
          mode: "read-only",
        },
        readAuthority: {
          workspace: {
            allowedPaths: ["/workspace/references/t1code", "/workspace/references/vllm-studio"],
            deniedPaths: [],
          },
        },
        timeoutMs: 5000,
        credentialRoute: {
          mode: "credentialless",
        },
        memoryScope: {
          scope: { kind: "project", id: "kiln" },
          access: "read-only",
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    expect(readTool).toHaveBeenCalledTimes(1);
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.replayResources?.[0]?.text).toContain("reference file visible read-only");
  });

  it("keeps long direct-provider child output bounded while exposing the full result as a managed resource", async () => {
    const fullResultBody = Array.from({ length: 90 }, (_, index) =>
      `finding-${String(index).padStart(2, "0")}: actionable managed-agent review detail with exact evidence and correction.`
    ).join("\n");
    const fullResult = `\n\n${fullResultBody}\n\n`;
    const extractedResult = fullResult.trim();
    const provider = providerWithResponses([response(fullResult)]);
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.resultHandoff?.summary.length).toBeLessThanOrEqual(2000);
    expect(result.record.resultHandoff?.summary).toContain("Full child result is available through the managed invocation result resource.");
    expect(result.record.resultHandoff?.summary).not.toContain("finding-89");
    expect(result.record.resultHandoff?.resourceUris).toEqual([
      "kiln://managed-agents/invocations/inv-direct-1/transcript",
      "kiln://managed-agents/invocations/inv-direct-1/resources/result/final",
    ]);
    expect(result.record.replayResources).toEqual([{
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/result/final",
      title: "Managed invocation final result",
      mimeType: "text/markdown",
      text: extractedResult,
    }]);
  });

  it("records empty direct-provider child output as an actionable no-handoff result", async () => {
    const provider = providerWithResponses([response("   ")]);
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.resultHandoff?.summary).toContain("finished without final handoff text");
    expect(result.record.resultHandoff?.summary).toContain("Inspect the transcript");
    expect(result.record.resultHandoff?.resourceUris).toEqual([
      "kiln://managed-agents/invocations/inv-direct-1/transcript",
      "kiln://managed-agents/invocations/inv-direct-1/resources/child-execution",
    ]);
    expect(result.record.replayResources?.[0]).toMatchObject({
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/child-execution",
      title: "Managed invocation child execution evidence",
      mimeType: "text/markdown",
    });
    expect(result.record.replayResources?.[0]?.text).toContain("Final output: <empty>");
    expect(result.record.replayResources?.[0]?.text).toContain("Disposition reason: completion_eligible");
    expect(result.record.replayResources?.[0]?.text).toContain("Tool executions: 0");
    expect(result.record.replayResources?.[0]?.text).toContain("Input tokens: 10");
    expect(result.record.replayResources?.[0]?.text).toContain("Output tokens: 5");
  });

  it("records exhausted direct-provider tool loops as actionable no-handoff evidence", async () => {
    const provider = providerWithResponses([
      response("reading", [{ id: "tool-1", name: "read", input: { uri: "kiln://docs/a" } }]),
      {
        parts: [],
        inputTokens: 10,
        outputTokens: 0,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        toolCalls: [{ id: "tool-2", name: "read", input: { uri: "kiln://docs/b" } }],
        stopReason: "tool_calls",
      },
    ]);
    const readTool = vi.fn(async () => "doc contents");
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", readTool]]),
      executionEnvelope: makeDirectTestExecutionEnvelope(1),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff?.summary).toContain("finished without final handoff text");
    expect(result.record.resultHandoff?.summary).toContain("Turn paused: toolRounds limit reached (1/1).");
    expect(result.record.diagnostics).toBeUndefined();
    expect(result.record.replayResources?.[0]?.text).toContain("Disposition reason: tool_round_limit");
    expect(result.record.replayResources?.[0]?.text).toContain("Tool executions: 1");
    expect(readTool).toHaveBeenCalledTimes(1);
  });

  it("preserves a non-completed typed disposition instead of forcing handoff finalization", async () => {
    const provider = providerWithResponses([response("The required verifier was not run.")]);
    const baseRequest = request();
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [{
        name: "formal_verify",
        description: "Run the formal verifier.",
        inputSchema: {},
        tags: new Set(),
      }],
      builtinTools: new Map(),
    });

    const result = await invokeManaged(
      new RuntimeManagedAgentInvocationService(),
      request({
        authority: {
          ...baseRequest.authority,
          toolAuthority: {
            ...baseRequest.authority.toolAuthority,
            allowedToolNames: ["formal_verify"],
          },
        },
        input: {
          summary: "Verify the implementation.",
          prompt: "Use Dafny to verify the implementation.",
          handoff: {
            requiredResultFields: ["summary"],
          },
        },
      }),
      adapter,
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected terminal invocation");
    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.stopReason).toBe("required_producer_not_run");
    expect(result.record.resultHandoff?.summary).toContain("formal_verify: not_run");
  });

  it("does not infer a failed child from a provider stop reason", async () => {
    const provider = providerWithResponses([{
      parts: textParts([
        "Managed invocation state transition is still pending after the turn-convergence tool-round limit was reached.",
        "Work item work-1 must be transitioned with work_item.update before the governed workflow can continue.",
      ].join("\n")),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "managed_invocation_state_transition_required",
    }]);
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.stopReason).toBe("completion_eligible");
    expect(result.record.resultHandoff?.summary).toContain("Managed invocation state transition is still pending");
  });

  it("hydrates admitted resource context through resource_read without broadening child tool authority", async () => {
    const provider = providerWithResponses([
      response("Resource context summarized."),
    ]);
    const resourceReadTool = vi.fn(async () => ({
      output: "# Managed Invocation Transcript\n\nChild transcript body.",
      isError: false,
      metadata: {
        toolName: "resource_read",
        kind: "resource",
        operation: "read",
        uri: "kiln://managed-agents/invocations/child-1/transcript",
      },
    }));
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["resource_read", resourceReadTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await invokeManaged(service, request({
      input: {
        summary: "Summarize a managed resource.",
        prompt: "Summarize the supplied resource.",
        resourceUris: ["kiln://managed-agents/invocations/child-1/transcript"],
        context: {
          mode: "resources",
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    expect(resourceReadTool).toHaveBeenCalledWith(
      {
        uri: "kiln://managed-agents/invocations/child-1/transcript",
      },
      expect.objectContaining({
        session: expect.any(RuntimeSession),
        toolCall: expect.objectContaining({
          name: "resource_read",
        }),
      }),
    );
    const firstProviderCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
      tools?: readonly ToolDefinition[];
    };
    expect(firstProviderCall.system).toContain("kiln://managed-agents/invocations/child-1/transcript");
    expect(firstProviderCall.system).toContain("Child transcript body.");
    expect(firstProviderCall.tools?.map((tool) => tool.name)).not.toContain("resource_read");
  });

  it("hydrates admitted resource context from a late-bound builtin tool surface", async () => {
    const provider = providerWithResponses([
      response("Late resource context summarized."),
    ]);
    const resourceReadTool = vi.fn(async () => ({
      output: "# Late Managed Invocation Transcript\n\nLate child transcript body.",
      isError: false,
      metadata: {
        toolName: "resource_read",
        kind: "resource",
        operation: "read",
        uri: "kiln://managed-agents/invocations/child-late/transcript",
      },
    }));
    let runtimeBuiltinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor> = new Map();
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
      builtinToolsProvider: () => runtimeBuiltinTools,
    });
    runtimeBuiltinTools = new Map([["resource_read", resourceReadTool]]);
    const service = new RuntimeManagedAgentInvocationService();

    const result = await invokeManaged(service, request({
      input: {
        summary: "Summarize a late managed resource.",
        prompt: "Summarize the supplied late resource.",
        resourceUris: ["kiln://managed-agents/invocations/child-late/transcript"],
        context: {
          mode: "resources",
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    expect(resourceReadTool).toHaveBeenCalledWith(
      {
        uri: "kiln://managed-agents/invocations/child-late/transcript",
      },
      expect.objectContaining({
        session: expect.any(RuntimeSession),
        toolCall: expect.objectContaining({
          name: "resource_read",
        }),
      }),
    );
    const firstProviderCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
      tools?: readonly ToolDefinition[];
    };
    expect(firstProviderCall.system).toContain("kiln://managed-agents/invocations/child-late/transcript");
    expect(firstProviderCall.system).toContain("Late child transcript body.");
    expect(firstProviderCall.tools?.map((tool) => tool.name)).not.toContain("resource_read");
  });

  it("keeps read-only authority from executing unlisted write tools", async () => {
    const provider = providerWithResponses([
      response("writing", [{ id: "tool-1", name: "write", input: { path: "x", content: "bad" } }]),
      response("Write was denied."),
    ]);
    const writeTool = vi.fn(async () => "wrote");
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL, WRITE_TOOL],
      builtinTools: new Map([["write", writeTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await invokeManaged(service, request(), adapter);

    expect(result.status).toBe("completed");
    expect(writeTool).not.toHaveBeenCalled();
    const secondCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
      messages: Array<{ role: string; parts: Array<{ type: string; content?: string }> }>;
    };
    const toolResult = secondCall.messages.at(-1)?.parts[0];
    expect(toolResult?.content).toContain('Tool "write" is not available');
  });

  it("admits explicit apply-approved direct-provider writes and records write evidence", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kiln-direct-child-write-"));
    const targetPath = join(workspaceRoot, "direct-write.txt");
    const content = "DIRECT_CHILD_WRITE_MARKER\n";
    const provider = providerWithResponses([
      response("writing", [{
        id: "tool-1",
        name: "write",
        input: {
          filePath: targetPath,
          content,
        },
      }]),
      response("Direct child applied the approved workspace write."),
    ], "opencode-go");
    const writeTool = vi.fn(async (input: Record<string, unknown>) => {
      writeFileSync(String(input.filePath), String(input.content), "utf8");
      return {
        output: "wrote direct-write.txt",
        metadata: {
          toolName: "write",
          kind: "file",
          operation: "write",
          filePath: targetPath,
          changeType: "created",
          linesAdded: 1,
          linesRemoved: 0,
          diffPreview: `+ ${content.trimEnd()}`,
          diffTruncated: false,
        },
      };
    });
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "opencode-go",
      model: "kimi-k2.6",
      provider,
      tools: [WRITE_TOOL],
      builtinTools: new Map([["write", writeTool]]),
      toolAuthority: new Map([["write", {
        level: 3,
        allowed: false,
        requiresApproval: true,
        reason: "Workspace writes require operator approval",
      }]]),
      writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY,
    });
    const service = new RuntimeManagedAgentInvocationService();

    try {
      expect(adapter.descriptor).toMatchObject({
        supportedAccess: [
          "read-only",
          "propose",
          "approved-write",
        ],
        writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY,
      });

      const approvedRequest = request({
        invocationId: "agent-task:direct-write-live-1",
        agentId: "direct-write:approved-write",
        access: "approved-write",
        providerRoute: {
          providerId: "opencode-go",
          surface: "direct-provider",
          model: "kimi-k2.6",
        },
        authority: {
          ...request().authority,
          toolAuthority: {
            allowedToolNames: ["write"],
            writeAllowed: true,
            networkAllowed: false,
          },
          workingDirectory: {
            path: workspaceRoot,
            mode: "workspace-write",
          },
          writeAuthority: {
            scope: {
              workspace: {
                mode: "apply-approved",
                allowedPaths: [workspaceRoot],
                deniedPaths: [],
              },
              memory: {
                operations: [],
              },
              artifacts: {
                mode: "none",
                resourceUris: [],
                retention: "none",
              },
              tools: {
                allowedToolNames: ["write"],
                deniedToolNames: [],
              },
            },
            approval: {
              mode: "required-before-apply",
              evidenceRequired: true,
            },
          },
          memoryScope: {
            scope: { kind: "project", id: "direct-write-test" },
            access: "write-proposals",
          },
        },
        input: {
          summary: "Apply an approved direct write.",
          prompt: "Write the admitted file and report completion.",
        },
      });
      const result = await invokeManaged(service, approvedRequest, adapter, {
        consumedWriteApproval: consumedWriteApprovalFor(approvedRequest),
      });

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("expected completed");
      }
      expect(writeTool).toHaveBeenCalledWith(
        { filePath: targetPath, content },
        expect.objectContaining({
          sandbox: expect.objectContaining({
            policy: expect.objectContaining({
              config: expect.objectContaining({
                fsPolicy: "read-write",
                allowedPaths: [workspaceRoot],
              }),
            }),
          }),
        }),
      );
      expect(result.record.lifecycleState).toBe("completed");
      expect(result.record.writeEvidence?.map((evidence) => evidence.kind)).toEqual([
        "write-proposal-created",
        "write-proposal-approved",
        "write-attempt-completed",
      ]);
      expect(result.record.resultHandoff?.resourceUris.some((uri) => uri.endsWith("/resources/write-attempts/1"))).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("records a failed invocation when the child provider fails", async () => {
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async () => {
        throw new Error("provider exploded");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff?.summary).toContain("Direct provider managed invocation failed for provider openai, model gpt-test.");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/failure",
      kind: "failure",
    }]);
  });

  it("classifies explicit provider usage limits without changing direct-provider failure evidence", async () => {
    const provider: ProviderAdapter = {
      name: "opencode-go",
      createMessage: vi.fn(async () => {
        throw new AllCredentialsExhaustedError(
          new Error("Weekly usage limit reached"),
          { type: "rate-limited", resetAt: Date.parse("2026-08-01T12:30:00.000Z") },
        );
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "opencode-go",
      model: "kimi-k2.6",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });

    const service = new RuntimeManagedAgentInvocationService();
    const result = await invokeManaged(service, request({
      providerRoute: {
        providerId: "opencode-go",
        surface: "direct-provider",
        model: "kimi-k2.6",
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/failure",
      kind: "failure",
    }]);
    expect(result.record.providerRequestObservations).toEqual([
      expect.objectContaining({
        managedInvocation: expect.objectContaining({ invocationId: "inv-direct-1" }),
        cache: expect.objectContaining({
          partitionIdentity: expect.objectContaining({ state: "observed" }),
        }),
      }),
    ]);
    expect(result.record.resultHandoff?.summary).toContain(
      "Direct provider managed invocation failed for provider opencode-go, model kimi-k2.6.",
    );
  });

  it("records credential pool exhaustion with provider, model, and last outcome details", async () => {
    const provider: ProviderAdapter = {
      name: "codex-oauth",
      createMessage: vi.fn(async () => {
        throw new AllCredentialsExhaustedError(
          new Error("model endpoint returned 429"),
          { type: "rate-limited", resetAt: Date.parse("2026-05-19T23:30:00.000Z") },
        );
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "codex-oauth",
      model: "gpt-5.4-mini",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request({
      providerRoute: {
        providerId: "codex-oauth",
        surface: "direct-provider",
        model: "gpt-5.4-mini",
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff?.summary).toContain("provider codex-oauth");
    expect(result.record.resultHandoff?.summary).toContain("model gpt-5.4-mini");
    expect(result.record.resultHandoff?.summary).toContain("The Runtime model round was claimed; its provider outcome is not safely replayable.");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/failure",
      kind: "failure",
    }]);
  });

  it("returns a timed-out invocation record when the child runtime exceeds authority timeout", async () => {
    let observedSignal: AbortSignal | undefined;
    let abortObserved = false;
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn((options) => {
        observedSignal = options.signal;
        return new Promise<AgentResponse>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            abortObserved = true;
            reject(new Error("provider request aborted"));
          }, { once: true });
        });
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request({
      authority: {
        ...request().authority,
        timeoutMs: 1,
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("timed_out");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/timeout",
      kind: "timeout",
    }]);
    expect(result.record.resultHandoff?.resourceUris).toEqual([
      "kiln://managed-agents/invocations/inv-direct-1/transcript",
      "kiln://managed-agents/invocations/inv-direct-1/resources/timeout",
    ]);
    expect(result.record.replayResources).toEqual([expect.objectContaining({
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/timeout",
      title: "Managed invocation timeout evidence",
      mimeType: "text/markdown",
    })]);
    expect(result.record.replayResources?.[0]?.text).toContain("Progress events: 0");
    expect(result.record.replayResources?.[0]?.text).toContain("No child runtime progress events were observed before timeout.");
    expect(result.record.resultHandoff?.summary).toContain("timed out after 1ms");
    expect(result.record.resultHandoff?.summary).toContain(result.record.childSessionId);
    expect(result.record.resultHandoff?.summary).toContain("No completed child handoff was produced before timeout");
    expect(result.record.resultHandoff?.summary).toContain("Inspect the transcript and timeout diagnostic resources");
    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
    expect(abortObserved).toBe(true);
  });

  it("preserves safe provider transport phase evidence in a timeout diagnostic", async () => {
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn((options) => {
        options.transportObserver?.onEvent({
          type: "response_headers",
          identity: { projectId: "unsafe-project-path", requestId: "unsafe-request" },
          status: 200,
        });
        options.transportObserver?.onEvent({
          type: "response_first_byte",
          identity: { projectId: "unsafe-project-path", requestId: "unsafe-request" },
        });
        options.transportObserver?.onEvent({
          type: "response_chunk",
          identity: { projectId: "unsafe-project-path", requestId: "unsafe-request" },
        });
        return new Promise<AgentResponse>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("provider request aborted")), { once: true });
        });
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });

    const service = new RuntimeManagedAgentInvocationService();
    const result = await invokeManaged(service, request({
      authority: { ...request().authority, timeoutMs: 1 },
    }), adapter);

    if (result.status !== "completed") throw new Error("fixture");
    const evidence = result.record.replayResources?.[0]?.text ?? "";
    expect(result.record.lifecycleState).toBe("timed_out");
    expect(evidence).toContain("Provider transport response headers.");
    expect(evidence).toContain("Provider transport response first byte.");
    expect(evidence).toContain('Metadata: {"eventType":"response_headers","phase":"headers","status":200}');
    expect(evidence).not.toContain("unsafe-project-path");
    expect(evidence).not.toContain("unsafe-request");
    const progressEvents = service.status("inv-direct-1")?.progressEvents ?? [];
    const transportEventIds = progressEvents
      .filter((event) => event.kind === "provider_transport")
      .map((event) => event.eventId) ?? [];
    expect(transportEventIds).toHaveLength(2);
    expect(new Set(transportEventIds).size).toBe(transportEventIds.length);
  });

  it("classifies a coordinator-owned lifecycle abort as timeout instead of cancellation", async () => {
    const lifecycle = new AbortController();
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn((options) => new Promise<AgentResponse>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("provider request aborted")), { once: true });
      })),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });
    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(request(), adapter, snapshotInputFor(request()), {
      abortSignal: lifecycle.signal,
    });
    if (started.status !== "started") throw new Error("fixture");

    lifecycle.abort(new ManagedEconomicLifecycleTimeoutError(100));
    const result = await service.join("inv-direct-1");

    expect(result).toMatchObject({
      status: "completed",
      record: { lifecycleState: "timed_out" },
    });
    if (result.status === "completed") {
      expect(result.record.resultHandoff?.summary).toContain("timed out after 100ms");
    }
  });

  it("preserves partial child progress evidence when a direct child times out mid-tool", async () => {
    const provider = providerWithResponses([
      response("reading", [{ id: "tool-1", name: "read", input: { uri: "kiln://docs/a" } }]),
    ]);
    const readTool = vi.fn(async () => new Promise<string>(() => undefined));
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", readTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await invokeManaged(service, request({
      authority: {
        ...request().authority,
        timeoutMs: 25,
      },
    }), adapter);
    const snapshot = service.status("inv-direct-1");

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("timed_out");
    expect(result.record.providerRequestObservations).toEqual([
      expect.objectContaining({
        managedInvocation: expect.objectContaining({ invocationId: "inv-direct-1" }),
      }),
    ]);
    expect(snapshot?.progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "tool_called",
        summary: "read called",
        toolName: "read",
      }),
    ]));
    expect(result.record.replayResources?.[0]?.text).toContain("Progress events:");
    expect(result.record.replayResources?.[0]?.text).toContain("## Progress");
    expect(result.record.replayResources?.[0]?.text).toContain("Summary: Tool progress observed before timeout.");
    expect(result.record.replayResources?.[0]?.text).not.toContain("No child runtime progress events were observed before timeout.");
  });

  it("redacts tool progress payloads from timeout replay evidence", async () => {
    let providerCalls = 0;
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn((options) => {
        providerCalls += 1;
        if (providerCalls === 1) {
          return Promise.resolve(response("read", [{ id: "tool-1", name: "read", input: { uri: "kiln://docs/a" } }]));
        }
        return new Promise<AgentResponse>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("provider request aborted")), { once: true });
        });
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", async () => "credential=synthetic-secret C:/private/plan.txt"]]),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request({
      authority: { ...request().authority, timeoutMs: 25 },
    }), adapter);

    if (result.status !== "completed") throw new Error("fixture");
    const evidence = result.record.replayResources?.[0]?.text ?? "";
    expect(result.record.lifecycleState).toBe("timed_out");
    expect(evidence).toContain("Tool progress observed before timeout.");
    expect(evidence).not.toContain("synthetic-secret");
    expect(evidence).not.toContain("C:/private/plan.txt");
    expect(evidence).not.toContain("credential=");
  });

  it("records external cancellation as a cancelled direct-provider invocation with evidence", async () => {
    let observedSignal: AbortSignal | undefined;
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn((options) => {
        observedSignal = options.signal;
        return new Promise<AgentResponse>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new Error("provider request aborted"));
          }, { once: true });
        });
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });
    const service = new RuntimeManagedAgentInvocationService();
    const started = await startManaged(service, request(), adapter);

    expect(started.status).toBe("started");
    await flushMicrotasks();

    const cancelled = await service.cancel("inv-direct-1", "Operator stopped direct child.");
    await flushMicrotasks();

    if (cancelled.status !== "cancelled") throw new Error(`Expected cancellation to settle, received ${cancelled.status}.`);
    expect(cancelled.record.lifecycleState).toBe("cancelled");
    expect(observedSignal?.aborted).toBe(true);
    expect(service.status("inv-direct-1")).toMatchObject({
      lifecycleState: "cancelled",
      record: {
        lifecycleState: "cancelled",
        transcript: {
          uri: "kiln://managed-agents/invocations/inv-direct-1/transcript",
        },
        resultHandoff: {
          summary: "Operator stopped direct child.",
          resourceUris: ["kiln://managed-agents/invocations/inv-direct-1/transcript"],
        },
        providerRequestObservations: [
          expect.objectContaining({
            managedInvocation: expect.objectContaining({ invocationId: "inv-direct-1" }),
          }),
        ],
      },
    });
    expect(service.status("inv-direct-1")?.error).toBeUndefined();
  });

  it("integrates through managed_agent.invoke with Kiln builtin tools and returns only bounded handoff", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kiln-direct-child-"));
    const docPath = join(tmpDir, "managed-agent-risk.txt");
    const childOnlyMarker = "INTERNAL_DIRECT_CHILD_EVIDENCE";
    writeFileSync(
      docPath,
      `Managed agent direct-provider integration fixture.\n${childOnlyMarker}\nRisk: retain bounded handoff only.\n`,
      "utf8",
    );
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async (input) => {
        const serializedInput = JSON.stringify(input);
        if (!serializedInput.includes(childOnlyMarker)) {
          return response("reading governed fixture", [{
            id: "read-fixture-1",
            name: "read",
            input: {
              filePath: docPath,
              limit: 3,
            },
          }]);
        }
        return response("Direct child found one bounded managed-agent risk.");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const childSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-5.4-mini",
      provider,
      tools: childSurface.toolDefinitions,
      builtinTools: childSurface.callBuiltinTools,
      capabilityMap: childSurface.capabilities,
      toolAuthority: childSurface.toolAuthority,
    });
    const parentSurface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: new RuntimeManagedAgentInvocationService({
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager(),
        }),
        routes: [{
          routeId: "openai-direct-readonly",
          routeSource: "explicit-managed-route",
          providerId: "openai",
          model: "gpt-5.4-mini",
          surface: "direct-provider",
          capability: {
            identity: { routeId: "openai-direct-readonly", revision: "test-v1" },
            target: { providerId: "openai", modelId: "gpt-5.4-mini" },
            adapter: { kind: "direct-provider", capabilityId: "openai-direct", capabilityVersion: "test-v1" },
            authorityCeiling: "read_only",
            toolNames: ["read"],
            supportsRecursion: true,
            supportsAttachments: false,
            supportsWrite: false,
            proof: { status: "configured", source: "test-fixture", provenAccess: ["read-only"] },
            capacity: { kind: "accountless" },
            settlement: { kind: "not-required" },
          },
          createAdapter: async () => adapter,
          profiles: [{
              authorityProfileId: "authority:openai-direct-readonly:read-only",
              access: "read-only",
              allowedToolNames: ["read"],
              writeAllowed: false,
              networkAllowed: false,
              workingDirectory: {
                path: tmpDir,
                mode: "read-only",
              },
              timeoutMs: 5000,
              credentialRoute: {
                mode: "runtime-selected",
                routeId: "credential-route:openai:runtime-selected",
              },
              memoryScope: {
                scope: { kind: "project", id: "direct-child-test" },
                access: "read-only",
              },
          }],
        }],
      },
    });
    const parentSession = new RuntimeSession({
      sessionId: "parent-direct-session",
      appName: "managed-agent-test",
      tenantId: "tenant-a",
      userId: "operator-1",
      systemPrompt: "test",
    });
    parentSession.addUserMessage(textParts("Delegate direct child fixture review."));

    try {
      const result = await parentSurface.callBuiltinTools.get("managed_agent.invoke")?.({
        access: "read-only",
        routeId: "openai-direct-readonly",
        providerRoute: {
          providerId: "openai",
          model: "gpt-5.4-mini",
        },
        task: "Read the admitted fixture and report bounded managed-agent risks.",
      }, {
        session: parentSession,
        effectiveTurnAuthority: TEST_PARENT_AUTHORITY,
        toolCall: {
          id: "managed-direct-tool-call-1",
          name: "managed_agent.invoke",
          input: {},
        },
      }) as {
        readonly output: string;
        readonly isError: boolean;
        readonly metadata: Record<string, unknown>;
      };

      expect(result.isError).toBe(false);
      expect(result.output).toContain("Direct child found one bounded managed-agent risk.");
      expect(result.output).not.toContain(childOnlyMarker);
      expect(provider.createMessage).toHaveBeenCalledTimes(2);
      expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]))
        .toContain(childOnlyMarker);
      expect(parentSession.sessionEvents.map((event) => event.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        "agent_invocation_completed",
      ]);
      const terminalEvent = parentSession.sessionEvents[2];
      expect(terminalEvent).toMatchObject({
        resultSummary: "Direct child found one bounded managed-agent risk.",
        managedInvocationEvidence: {
          childSessionId: expect.stringContaining("parent-direct-session:managed:"),
        },
      });
      expect(JSON.stringify(terminalEvent)).not.toContain(childOnlyMarker);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("applies managed working-directory sandbox to direct-provider builtin file tools", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kiln-direct-child-workspace-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "kiln-direct-child-outside-"));
    const outsidePath = join(outsideRoot, "outside-secret.txt");
    const outsideMarker = "OUTSIDE_DIRECT_CHILD_MARKER";
    writeFileSync(outsidePath, outsideMarker, "utf8");
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async (input) => {
        const serializedInput = JSON.stringify(input);
        if (!serializedInput.includes("Read access denied")) {
          return response("reading outside file", [{
            id: "read-outside-1",
            name: "read",
            input: {
              filePath: outsidePath,
            },
          }]);
        }
        return response("Outside read was denied by the managed sandbox.");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const childSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: childSurface.toolDefinitions,
      builtinTools: childSurface.callBuiltinTools,
      capabilityMap: childSurface.capabilities,
      toolAuthority: childSurface.toolAuthority,
    });

    try {
      const result = await invokeManaged(
        new RuntimeManagedAgentInvocationService({
          sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
        }),
        request({
          authority: {
            ...request().authority,
            workingDirectory: {
              path: workspaceRoot,
              mode: "sandbox",
            },
          },
          input: {
            summary: "Attempt an out-of-scope read.",
            prompt: "Read the requested file and report the result.",
          },
        }),
        adapter,
      );

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("expected completed");
      }
      expect(result.record.resultHandoff?.summary).toBe("Outside read was denied by the managed sandbox.");
      expect(provider.createMessage).toHaveBeenCalledTimes(2);
      const secondCall = JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]);
      expect(secondCall).toContain("Read access denied");
      expect(secondCall).not.toContain(outsideMarker);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("admits explicit resource URI context with DefaultContextGovernor audit", async () => {
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async (input) => {
        expect(JSON.stringify(input)).toContain("kiln://artifacts/managed-invocations/example/content");
        return response("Resource context was admitted.");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
    });

    const result = await invokeManaged(new RuntimeManagedAgentInvocationService(), request({
      input: {
        summary: "Read admitted resource.",
        prompt: "Use the admitted resource URI.",
        resourceUris: ["kiln://artifacts/managed-invocations/example/content"],
        context: {
          mode: "resources",
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.resultHandoff?.summary).toBe("Resource context was admitted.");
  });
});
