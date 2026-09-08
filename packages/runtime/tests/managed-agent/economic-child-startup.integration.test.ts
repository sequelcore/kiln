import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createExecutionAccountPolicyId,
  digestManagedEconomicValue,
  textParts,
  type AgentResponse,
  type ProviderAdapter,
} from "@kilnai/core";
import {
  createManagedInvocationLifecycleToolExecutors,
  type ManagedInvocationToolAttachment,
  type ManagedInvocationToolRoute,
  type ManagedInvocationToolOptions,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import { ManagedRuntimeCredentialRouteLeaseManager } from "../../src/agents/managed-invocation/credential-route-lease-manager.js";
import {
  ManagedEconomicDispatchCoordinator,
  type ManagedEconomicDispatchPrepareInput,
} from "../../src/agents/managed-invocation/economic-dispatch-coordinator.js";
import type { ManagedEconomicCandidateSet } from "../../src/agents/managed-invocation/runtime-tool/economic-candidate-collection.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type {
  EffectiveTurnAuthoritySnapshot,
  RuntimeBuiltinToolExecutionContext,
} from "../../src/session/runtime-session-orchestrator.types.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import { createFixtureModelRoundStore, createFixtureToolActionStore } from "../session/runtime-claim-fixture.js";
import { createEconomicRouteProofAdoption } from "./economic-route-proof-fixture.js";
import { managedEconomicAdmissionBundle } from "./managed-economic-admission-fixture.js";

const ROUTE_ID = "route-economic-child";
const PROVIDER_ID = "codex-oauth";
const MODEL_ID = "gpt-test";
const ACCOUNT_ID = `configured:${PROVIDER_ID}-account`;
const CREDENTIAL_REVISION = digestManagedEconomicValue({ provider: PROVIDER_ID, credential: 1 }).slice(
  "sha256:".length,
);
type EconomicDispatchPrepare = NonNullable<ManagedInvocationToolOptions["economicDispatch"]>["prepare"];
type EconomicDispatchInput<PreparedExecution = undefined> = {
  readonly candidateSet: ManagedEconomicCandidateSet;
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly intentFingerprint: string;
  readonly admissionBundle: EffectiveAuthorityAdmissionBundle;
  readonly effectIdentity: string;
  readonly adoptedDecisionAt: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly authorityProfileId: string;
  readonly invocationId: string;
  readonly abortSignal?: AbortSignal;
  readonly workLimitDurationMs?: number;
  readonly lifecycleEvents?: ManagedEconomicDispatchPrepareInput["lifecycleEvents"];
  readonly validateAndConsumeApprovalBeforeFence?: ManagedEconomicDispatchPrepareInput<PreparedExecution>["validateAndConsumeApprovalBeforeFence"];
  readonly validateExecutionProfile?: ManagedEconomicDispatchPrepareInput<PreparedExecution>["validateExecutionProfile"];
  readonly realizeExecutionBeforeFence?: ManagedEconomicDispatchPrepareInput<PreparedExecution>["realizeExecutionBeforeFence"];
  readonly releasePreparedExecutionBeforeFence?: ManagedEconomicDispatchPrepareInput<PreparedExecution>["releasePreparedExecutionBeforeFence"];
};

const PARENT_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "read_only",
  admittedAuthority: "read_only",
  sourcePolicy: "runtime_surface_projection",
  reason: "composed managed economic child test parent admission",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} satisfies EffectiveTurnAuthoritySnapshot;

function providerResponse(): AgentResponse {
  return {
    parts: textParts("synthetic child completed"),
    inputTokens: 3,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    stopReason: "stop",
  };
}

function provider(onStart: () => void): ProviderAdapter {
  return {
    name: PROVIDER_ID,
    createMessage: async () => {
      onStart();
      return providerResponse();
    },
    streamMessage: async function* () {
      onStart();
      yield { type: "done", response: providerResponse() } as never;
    },
  };
}

function route(): ManagedInvocationToolRoute {
  return {
    routeId: ROUTE_ID,
    economicPolicyIds: [`${PROVIDER_ID}-policy`],
    routeSource: "explicit-managed-route",
    providerId: PROVIDER_ID,
    model: MODEL_ID,
    capability: {
      identity: { routeId: ROUTE_ID, revision: "test-v1" },
      target: { providerId: PROVIDER_ID, modelId: MODEL_ID },
      adapter: { kind: "direct-provider", capabilityId: "direct-provider", capabilityVersion: "1" },
      authorityCeiling: "read_only",
      toolNames: [],
      supportsRecursion: true,
      supportsAttachments: false,
      supportsWrite: false,
      proof: {
        status: "live-proven",
        source: "composed-economic-child-test",
        freshness: "fresh",
        observedAt: "2026-08-02T12:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        provenAccess: ["read-only"],
      },
      capacity: { kind: "policy-bound", accountPolicyId: `${PROVIDER_ID}-accounts` },
      settlement: {
        kind: "managed-economic-selection",
        contractVersion: "managed-economic-v1",
        policyIds: [`${PROVIDER_ID}-policy`],
        pendingSettlement: "required",
        recovery: "required",
      },
    },
    economicCapability: {
      status: "verified",
      adapterCapabilityId: "direct-provider",
      adapterCapabilityVersion: "1",
    },
    profiles: [
      {
        authorityProfileId: "economic-child-read-only",
        access: "read-only",
        allowedToolNames: [],
        writeAllowed: false,
        networkAllowed: false,
        workingDirectory: { path: "C:/workspace", mode: "read-only" },
        timeoutMs: 30_000,
        credentialRoute: {
          mode: "account-leased",
          routeId: ROUTE_ID,
          accountPolicyId: createExecutionAccountPolicyId(`${PROVIDER_ID}-accounts`),
        },
        memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
      },
    ],
  };
}

function routedParentBundle(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly parentEconomicCommitmentId?: string;
}): EffectiveAuthorityAdmissionBundle {
  const base = managedEconomicAdmissionBundle(input);
  return defineEffectiveAuthorityAdmissionBundle({
    ...base,
    turn: {
      ...base.turn,
      execution: {
        status: "routed",
        target: {
          targetId: ROUTE_ID,
          providerId: PROVIDER_ID,
          providerModelId: MODEL_ID,
          accountSelection: {
            kind: "operator-override",
            accountPolicyId: `${PROVIDER_ID}-accounts`,
            accountId: ACCOUNT_ID,
          },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId: ROUTE_ID,
          accountId: ACCOUNT_ID,
          credentialId: "credential:economic-child",
          credentialRevision: CREDENTIAL_REVISION,
        },
        ...(input.parentEconomicCommitmentId
          ? {
              economicCommitment: {
                commitmentId: input.parentEconomicCommitmentId,
                authorityRevision: digestManagedEconomicValue({ authority: "parent" }),
              },
            }
          : {}),
      },
    },
  });
}

function economicAuthority(root: string): SqliteManagedAccountLeaseAuthority {
  return new SqliteManagedAccountLeaseAuthority({
    path: join(root, "authority.sqlite"),
    ownerId: "composed-economic-child-owner",
    now: () => Date.parse("2026-08-02T12:00:00.000Z"),
  });
}

function coordinator(
  authority: SqliteManagedAccountLeaseAuthority,
  onStart: () => void,
  admissionBundle: EffectiveAuthorityAdmissionBundle,
) {
  return new ManagedEconomicDispatchCoordinator({
    authority: {
      acquire: (input) => authority.acquireCommitment(input),
      releasePreFence: (jobId, attemptId) => authority.releaseCommitmentPreFence(jobId, attemptId),
      fenceDispatch: (jobId, attemptId, fenceId, claim) => authority.fenceDispatch(jobId, attemptId, fenceId, claim),
      readDispatch: (jobId, attemptId, fenceId, claim) => authority.readDispatch(jobId, attemptId, fenceId, claim),
      settleExecution: (jobId, attemptId, fenceId, settlement) =>
        authority.settleExecution(jobId, attemptId, fenceId, settlement),
      recordExecutionSettlementPending: (jobId, attemptId, fenceId, reason) =>
        authority.recordExecutionSettlementPending(jobId, attemptId, fenceId, reason),
      recordExecutionNotDispatched: (jobId, attemptId, fenceId, reason) =>
        authority.recordExecutionNotDispatched(jobId, attemptId, fenceId, reason),
    },
    resolveLifecycleTimeoutMs: () => 30_000,
    createAdapter: async ({ commitment }) =>
      new ManagedDirectProviderRuntimeAdapter({
        providerId: PROVIDER_ID,
        model: MODEL_ID,
        provider: provider(onStart),
        tools: [],
        builtinTools: new Map(),
        economicIdentity: commitment.reservation.selectedIdentity,
        runtimeToolActionClaims: createFixtureToolActionStore(),
        runtimeModelRoundActionClaims: createFixtureModelRoundStore(),
        readAuthorityAdmission: () => admissionBundle,
      }),
  });
}

async function runComposedInvocation(
  parentEconomicCommitmentId?: string,
  runOptions: { readonly abortBeforeStart?: boolean } = {},
): Promise<{
  readonly authority: SqliteManagedAccountLeaseAuthority;
  readonly root: string;
  readonly childCommitmentId?: string;
  readonly providerStarts: number;
  readonly result?: { readonly isError: boolean };
  readonly parentBundle: EffectiveAuthorityAdmissionBundle;
  readonly attempted?: { readonly jobId: string; readonly economicAttemptId: string };
}> {
  const root = mkdtempSync(join(tmpdir(), "kiln-economic-child-startup-"));
  const authority = economicAuthority(root);
  let childCommitmentId: string | undefined;
  let providerStarts = 0;
  const parentSession = new RuntimeSession({
    appName: "economic-child-startup-composition",
    tenantId: "synthetic-tenant",
    userId: "synthetic-user",
    systemPrompt: "synthetic parent",
    sessionId: `session-economic-child-${parentEconomicCommitmentId ? "distinct" : "none"}`,
  });
  const parentTurnId = "turn-economic-child";
  const parentBundle = routedParentBundle({
    sessionId: parentSession.id,
    turnId: parentTurnId,
    ...(parentEconomicCommitmentId ? { parentEconomicCommitmentId } : {}),
  });
  const adoption = createEconomicRouteProofAdoption({
    providerId: PROVIDER_ID,
    routeId: ROUTE_ID,
    modelId: MODEL_ID,
    priceKind: "metered",
    quotaEvidence: {
      kind: "unknown",
      capacityIdentity: `${PROVIDER_ID}-capacity`,
      subscriptionClass: "unknown",
      reason: "synthetic provider-free fixture",
      evidence: null,
    },
    quotaRequirement: "optional",
  });
  const economicDispatch = coordinator(
    authority,
    () => {
      providerStarts += 1;
    },
    parentBundle,
  );
  let attempted: { readonly jobId: string; readonly economicAttemptId: string } | undefined;
  const prepareEconomicDispatch: EconomicDispatchPrepare = async <PreparedExecution = undefined>(
    input: EconomicDispatchInput<PreparedExecution>,
  ) => {
    attempted = { jobId: input.jobId, economicAttemptId: input.economicAttemptId };
    const result = await economicDispatch.prepare<PreparedExecution>({
      ...input,
      access: input.candidateSet.access,
      adoption,
    });
    if (result.status === "prepared") childCommitmentId = result.commitment.commitmentId;
    return result;
  };
  const options: ManagedInvocationToolOptions = {
    routes: [route()],
    agentCatalog: [
      {
        name: "economic-scout",
        role: "Scout",
        goal: "Inspect bounded work.",
        tier: "reasoning",
        authorityProfileId: "economic-child-read-only",
        access: "read-only",
        economicPolicyId: `${PROVIDER_ID}-policy`,
        economicPolicyRevision: "revision-1",
        economicPolicyCandidateRouteIds: [ROUTE_ID],
      },
    ],
    contextResolver: async () => ({ admittedAgentProfile: "economic-scout" }),
    invocationService: new RuntimeManagedAgentInvocationService({
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager(),
    }),
    economicDispatch: { prepare: prepareEconomicDispatch },
  };
  const attachment: ManagedInvocationToolAttachment = {
    options,
    childAuthorityAdmission: { bundle: parentBundle },
    callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:composed-economic-child" },
  };
  const executor = createManagedInvocationLifecycleToolExecutors(attachment).get("managed_agent.invoke");
  if (!executor) throw new Error("managed_agent.invoke was not registered");
  const abortController = new AbortController();
  if (runOptions.abortBeforeStart) abortController.abort("synthetic cancellation before adapter start");
  let result: { readonly isError: boolean };
  try {
    result = (await executor(
      { access: "read-only", agentProfile: "economic-scout", task: "Inspect the composed economic child boundary." },
      {
        session: parentSession,
        turnId: parentTurnId,
        effectiveTurnAuthority: PARENT_AUTHORITY,
        authorityAdmission: parentBundle,
        ...(runOptions.abortBeforeStart ? { abortSignal: abortController.signal } : {}),
        toolCall: { id: "tool-call-economic-child", name: "managed_agent.invoke", input: {} },
      } as RuntimeBuiltinToolExecutionContext,
    )) as { readonly isError: boolean };
  } catch (error) {
    if (runOptions.abortBeforeStart) {
      return { authority, root, providerStarts, parentBundle, attempted };
    }
    authority.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  if (childCommitmentId === undefined) throw new Error("Expected a prepared economic invocation.");
  return { authority, root, childCommitmentId, providerStarts, result, parentBundle, attempted };
}

describe("composed managed economic child startup", () => {
  it.each([
    ["parent has no economic commitment", undefined],
    ["parent has a distinct economic commitment", "parent-commitment:distinct"],
  ] as const)(
    "starts the child once and releases the child reservation when %s",
    async (_label, parentEconomicCommitmentId) => {
      const run = await runComposedInvocation(parentEconomicCommitmentId);
      try {
        if (!run.childCommitmentId || !run.result || !run.attempted)
          throw new Error("Expected composed invocation output.");
        const attempted = run.attempted;
        expect(run.result).toMatchObject({ isError: false });
        expect(run.providerStarts).toBe(1);
        expect(run.childCommitmentId).not.toBe(parentEconomicCommitmentId);
        await vi.waitFor(() =>
          expect(
            run.authority.createAgentTaskReplayInspectionPort().inspect({
              jobId: attempted.jobId,
              economicAttemptId: attempted.economicAttemptId,
            }),
          ).toMatchObject({ status: "released" }),
        );
      } finally {
        run.authority.close();
        rmSync(run.root, { recursive: true, force: true });
      }
    },
  );

  it("records cancellation as a released child reservation before adapter start", async () => {
    const run = await runComposedInvocation(undefined, { abortBeforeStart: true });
    try {
      expect(run.providerStarts).toBe(0);
      expect(run.attempted).toBeDefined();
      if (!run.attempted) throw new Error("Expected the cancelled economic attempt to be recorded.");
      expect(run.authority.createAgentTaskReplayInspectionPort().inspect(run.attempted)).toMatchObject({
        status: "released",
      });
    } finally {
      run.authority.close();
      rmSync(run.root, { recursive: true, force: true });
    }
  });

  it("rejects a missing canonical tool before acquiring economic capacity", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-child-missing-tool-"));
    const authority = economicAuthority(root);
    const prepare = vi.fn();
    try {
      const options: ManagedInvocationToolOptions = {
        routes: [route()],
        agentCatalog: [
          {
            name: "economic-scout",
            role: "Scout",
            goal: "Inspect bounded work.",
            tier: "reasoning",
            authorityProfileId: "economic-child-read-only",
            access: "read-only",
            economicPolicyId: `${PROVIDER_ID}-policy`,
            economicPolicyRevision: "revision-1",
            economicPolicyCandidateRouteIds: [ROUTE_ID],
          },
        ],
        contextResolver: async () => ({ admittedAgentProfile: "economic-scout" }),
        invocationService: new RuntimeManagedAgentInvocationService(),
        economicDispatch: { prepare },
      };
      const session = new RuntimeSession({
        appName: "missing-tool",
        tenantId: "tenant",
        userId: "user",
        systemPrompt: "test",
        sessionId: "session-missing-tool",
      });
      const bundle = routedParentBundle({ sessionId: session.id, turnId: "turn-missing-tool" });
      const executor = createManagedInvocationLifecycleToolExecutors({
        options,
        childAuthorityAdmission: { bundle },
        callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:missing-tool" },
      }).get("managed_agent.invoke");
      if (!executor) throw new Error("managed_agent.invoke was not registered");
      const result = (await executor(
        { access: "read-only", agentProfile: "economic-scout", requiredToolNames: ["shell"], task: "missing tool" },
        {
          session,
          turnId: "turn-missing-tool",
          effectiveTurnAuthority: PARENT_AUTHORITY,
          toolCall: { id: "tool-call-missing-tool", name: "managed_agent.invoke", input: {} },
        } as RuntimeBuiltinToolExecutionContext,
      )) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };
      expect(result).toMatchObject({
        isError: true,
        metadata: { errorCode: "required_tools_missing", status: "denied" },
      });
      expect(prepare).not.toHaveBeenCalled();
      expect(
        authority
          .createAgentTaskReplayInspectionPort()
          .inspect({ jobId: "missing", economicAttemptId: "economic-attempt:missing" }),
      ).toBeUndefined();
    } finally {
      authority.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
