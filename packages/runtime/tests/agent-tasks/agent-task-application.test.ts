import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FilesystemAgentTaskStore,
  InMemoryAgentTaskStore,
  AgentTaskApplicationError,
  AgentTaskApplicationService,
  AgentTaskExecutionFailure,
  type AgentTaskApplicationOptions,
  type AgentTaskEconomicProfile,
  type AgentTaskEconomicAdoption,
  type AgentTaskExecutionContext,
  type AgentTaskRecord,
  type AgentTaskNativeHarnessProfile,
  type AgentTaskNativeHarnessRoute,
} from "../../src/agent-tasks/index.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import {
  adoptManagedEconomicSnapshot,
  digestManagedEconomicValue,
  type ManagedEconomicPriceEvidence,
} from "@kilnai/core/cost";
import type { ManagedEconomicCandidateSet } from "../../src/agents/managed-invocation/runtime-tool/index.js";
import { ManagedEconomicDispatchCoordinator } from "../../src/agents/managed-invocation/economic-dispatch-coordinator.js";

const now = new Date("2026-07-29T18:00:00.000Z");
const submission = {
  objective: "Inspect the policy-owned precommit boundary.",
  configuredAgentProfileId: "scout",
  callerId: "codex-app:caller-001",
  idempotencyKey: "caller-001",
};
const query = {
  project: { id: "kiln" },
  callerId: "codex-app:caller-001",
} as const;
const testProfileAuthorityDigest = `sha256:${"9".repeat(64)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function profile(
  constraints: AgentTaskEconomicProfile["constraints"] = {},
): AgentTaskEconomicProfile {
  return {
    kind: "economic",
    id: "scout",
    economicPolicyId: "economy-policy",
    economicPolicyRevision: "revision-001",
    admissionProfileId: "foundation-readonly-plan",
    constraints,
  };
}

function candidateSet(
  constraints: AgentTaskEconomicProfile["constraints"] = {},
): ManagedEconomicCandidateSet {
  return {
    economicPolicyId: "economy-policy",
    economicPolicyRevision: "revision-001",
    admissionProfileId: "foundation-readonly-plan",
    constraints,
    candidates: [{
      routeId: "codex-primary",
      routeSource: "explicit-managed-route",
      providerId: "codex-oauth",
      model: "gpt-test",
      accountPolicyId: "codex-pool",
      surface: "direct-provider",
      adapterCapabilityId: "codex-oauth-direct",
      adapterCapabilityVersion: "1",
      profileAuthorityDigest: testProfileAuthorityDigest,
    }],
    rejections: [{
      stage: "managed-candidate-admission",
      routeId: "remote-fallback",
      reason: "economic-capability-unverified",
    }],
  };
}

function createOptions(input: {
  readonly currentProfile?: () => AgentTaskEconomicProfile;
  readonly currentCandidates?: () => ManagedEconomicCandidateSet;
  readonly store?: AgentTaskApplicationOptions["store"];
  readonly clock?: () => Date;
  readonly commitmentState?: "absent" | "committed" | "dispatch-fenced";
} = {}): AgentTaskApplicationOptions {
  return {
    project: { resolve: async () => ({ id: "kiln" }) },
    governance: {
      resolve: async () => ({
        version: 1,
        authority: "authoritative",
        source: "kiln-config-status",
        issuedAt: "2026-07-29T17:59:00.000Z",
        validUntil: "2026-07-29T18:01:00.000Z",
      }),
      admit: async () => ({
        admitted: true,
        admissionId: "admission-001",
        source: "kiln-work-governance",
      }),
    },
    profiles: {
      resolve: async (id) => id === "scout"
        ? (input.currentProfile?.() ?? profile())
        : undefined,
    },
    routes: {
      resolve: async () => input.currentCandidates?.() ?? candidateSet(),
    },
    store: input.store ?? new InMemoryAgentTaskStore(),
    ...(input.commitmentState ? {
      commitmentRecovery: {
        query: () => input.commitmentState!,
      },
    } : {}),
    clock: input.clock ?? (() => now),
    idGenerator: () => "job-000000001",
    economicAttemptIdGenerator: () => "attempt-000000001",
  };
}

function adoptedEconomicEvidence(): AgentTaskEconomicAdoption {
  return {
    snapshot: {
      snapshotDigest: `sha256:${"d".repeat(64)}`,
      adoptedDecisionAt: now.toISOString(),
      routes: [],
    } as never,
    expectation: { candidateSetDigest: `sha256:${"c".repeat(64)}` } as never,
    routeCapacity: [],
  };
}

function sqliteAdoptedEconomicEvidence(): AgentTaskEconomicAdoption {
  const economicAmount = { atoms: "1", scale: 0, unit: "request",
    scheme: { kind: "currency" as const, currency: "USD" } };
  const evidence = {
    sourceIdentity: "agent-task-test", sourceRevision: "revision-001",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    observedAt: "2026-07-29T17:00:00.000Z", validUntil: "2026-07-29T19:00:00.000Z",
    confidence: "high" as const, authority: "configured" as const,
  };
  const unitRates = [{ usageUnit: "request", price: economicAmount }];
  const auxiliaryCharges: never[] = [];
  const domain = { id: "usd", rank: 0, basis: { unit: "request",
    scheme: { kind: "currency" as const, currency: "USD" },
    rateCardBasis: "test-rate-card", envelopeSemantics: "bounded-test" } };
  const priceEvidence: ManagedEconomicPriceEvidence = { kind: "metered", identity: {
    providerId: "codex-oauth", modelId: "gpt-test", authBillingChannel: "oauth",
    executionMode: "managed", serviceTier: "test", rateCardId: "test-rate-card",
    rateCardRevision: "revision-001", unit: "request",
    scheme: { kind: "currency", currency: "USD" },
    unitScheduleDigest: digestManagedEconomicValue(unitRates), contextClass: "test",
    cacheClass: "none", auxiliaryScheduleDigest: digestManagedEconomicValue(auxiliaryCharges), evidence,
  } };
  const route = {
    routeId: "codex-primary", providerId: "codex-oauth", modelId: "gpt-test",
    adapterCapabilityId: "codex-oauth-direct", adapterCapabilityVersion: "1",
    authBillingChannel: "oauth", executionMode: "managed", serviceTier: "test",
    accountPolicyId: null, fallbackPosture: "disabled" as const, overagePosture: "disabled" as const,
    rateCardId: "test-rate-card", rateCardRevision: "revision-001",
    priceEvidenceDigest: evidence.sourceDigest, unit: "request",
    scheme: { kind: "currency" as const, currency: "USD" }, contextClass: "test", cacheClass: "none",
    auxiliaryScheduleDigest: priceEvidence.identity.auxiliaryScheduleDigest,
    envelopeDigest: `sha256:${"e".repeat(64)}`,
  };
  const snapshot = adoptManagedEconomicSnapshot({
    policy: { policyId: "economy-policy", schemaVersion: 1, policyRevision: "revision-001",
      policyDigest: `sha256:${"b".repeat(64)}`, comparisonDomains: [domain], noRouteAction: "deny",
      evidenceRequirements: { quota: "optional", price: "required" } },
    adoptedAt: now.toISOString(), adoptedDecisionAt: now.toISOString(), callerConstraints: {},
    routes: [{
      admittedIdentity: { routeId: "codex-primary", sourceIdentity: "explicit-managed-route",
        providerId: "codex-oauth", modelId: "gpt-test", adapterCapabilityId: "codex-oauth-direct",
        adapterCapabilityVersion: "1", accountPolicy: { kind: "accountless" },
        profileAuthorityDigest: testProfileAuthorityDigest },
      route, comparisonDomain: domain, priorityRank: 0, priceEvidence,
      rateSchedule: { unitRates, auxiliaryCharges },
      executionEnvelope: { kind: "bounded", digest: route.envelopeDigest, limits: [{
        atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" },
      }] },
      worstCaseReservation: { kind: "exact", amount: economicAmount },
      ceiling: { kind: "finite", amount: economicAmount },
    }],
  });
  return {
    snapshot,
    expectation: {
      policyId: "economy-policy", policyRevision: "revision-001",
      candidateSetDigest: snapshot.candidateSetDigest,
      admittedCandidates: snapshot.routes.map((entry) => entry.admittedIdentity), callerConstraints: {},
    },
    routeCapacity: [{ routeId: "codex-primary" }],
  };
}

const nativeHarnessAcknowledgement = {
  version: 1 as const,
  source: "managed-route-admission" as const,
  credentialMode: "credentialless" as const,
  acknowledgedAt: now.toISOString(),
  routeId: "claude-sonnet-readonly",
  routeRevision: "configured-v1",
  providerId: "claude",
  model: "claude-sonnet-5",
  admissionProfileId: "foundation-readonly-plan" as const,
  adapterCapabilityId: "managed:claude-sonnet-readonly",
  adapterCapabilityVersion: "v1",
};

const nativeHarnessProfile: AgentTaskNativeHarnessProfile = {
  kind: "native-harness",
  id: "claude-reviewer",
  admissionProfileId: "foundation-readonly-plan",
  routeId: "claude-sonnet-readonly",
  routeRevision: "configured-v1",
  providerId: "claude",
  model: "claude-sonnet-5",
  adapterCapabilityId: "managed:claude-sonnet-readonly",
  adapterCapabilityVersion: "v1",
  acknowledgement: nativeHarnessAcknowledgement,
};

const nativeHarnessRoute: AgentTaskNativeHarnessRoute = {
  kind: "native-harness",
  admissionProfileId: nativeHarnessProfile.admissionProfileId,
  routeId: nativeHarnessProfile.routeId,
  routeRevision: nativeHarnessProfile.routeRevision,
  providerId: nativeHarnessProfile.providerId,
  model: nativeHarnessProfile.model,
  adapterCapabilityId: nativeHarnessProfile.adapterCapabilityId,
  adapterCapabilityVersion: nativeHarnessProfile.adapterCapabilityVersion,
  acknowledgement: nativeHarnessProfile.acknowledgement,
};

type NativeHarnessExecutionInput = Parameters<NonNullable<AgentTaskApplicationOptions["nativeHarnessExecution"]>["execute"]>[0];

function nativeDataPolicyProof(input: NativeHarnessExecutionInput) {
  return {
    version: 1 as const,
    jobId: input.job.id,
    dispatchFenceId: input.dispatchFenceId,
    routeId: input.route.routeId,
    providerId: input.route.providerId,
    providerModelId: input.route.model,
    decision: { status: "admitted" as const, freshness: "current" as const, reason: "policy-admitted" as const },
    evidence: {
      providerId: input.route.providerId, providerModelId: input.route.model,
      sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"f".repeat(64)}` as const,
      trainingPosture: "prohibited" as const, retentionPosture: "zero" as const, retentionDays: 0,
      maximumClassification: "internal" as const, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z",
    },
  };
}

const nativeDeliberationResolution = {
  status: "exact" as const,
  selectedLevel: "high",
  source: "route" as const,
  capabilityEvidence: {
    sourceIdentity: "opencode-cli-model-catalog",
    sourceRevision: "1.18.16:catalog-test",
    observedAt: "2026-08-10T00:00:00.000Z",
  },
};

function nativeStoredJob(input: {
  readonly id: string;
  readonly state: "queued" | "running";
  readonly dispatchFenceId?: string;
}): AgentTaskRecord {
  const updatedAt = now.toISOString();
  const dispatch = {
    ...nativeHarnessRoute,
    ...(input.dispatchFenceId ? { dispatchFenceId: input.dispatchFenceId } : {}),
  };
  return {
    version: 13,
    run: {
      runId: `agent-run:${input.id}`,
      state: input.state,
      dispatch,
    },
    id: input.id,
    adoptedDecisionAt: updatedAt,
    state: input.state,
    objective: "Inspect a native harness recovery boundary.",
    projectId: "kiln",
    callerId: query.callerId,
    configuredAgentProfileId: nativeHarnessProfile.id,
    admissionProfileId: nativeHarnessProfile.admissionProfileId,
    dispatch,
    governanceSource: "kiln-work-governance",
    admissionId: "admission-001",
    requestFingerprint: digestManagedEconomicValue({ kind: "native-harness", id: input.id }),
    idempotencyKeyHash: digestManagedEconomicValue({ kind: "native-harness-idempotency", id: input.id }),
    createdAt: updatedAt,
    updatedAt,
    lifecycle: [
      { sequence: 1, state: "queued", observedAt: updatedAt },
      ...(input.state === "running"
        ? [{ sequence: 2, state: "running" as const, observedAt: updatedAt }]
        : []),
    ],
  };
}

async function dispatchAccepted(
  service: AgentTaskApplicationService,
  input: unknown,
  context?: AgentTaskExecutionContext,
): Promise<AgentTaskRecord> {
  const accepted = await service.accept(input);
  if (accepted.state === "queued" || accepted.state === "running") {
    return await service.dispatch(accepted.id, context);
  }
  return accepted;
}

describe("AgentTaskApplicationService V13 AgentTask/AgentRun record", () => {
  it("holds approved-write work awaiting approval and never dispatches it without an attached receipt", async () => {
    const execute = vi.fn();
    const service = new AgentTaskApplicationService({
      ...createOptions({
        currentProfile: () => ({
          ...profile(),
          admissionProfileId: "foundation-apply-approved-writes",
        }),
        currentCandidates: () => ({
          ...candidateSet(),
          admissionProfileId: "foundation-apply-approved-writes",
        }),
      }),
      execution: { execute },
    });

    const accepted = await service.accept(submission);
    expect(accepted).toMatchObject({ version: 13, state: "awaiting_approval" });
    await expect(service.attachWriteApproval(query, accepted.id, "approval-000001")).rejects.toMatchObject({
      code: "admission_denied",
    });
    await expect(service.dispatch(accepted.id)).resolves.toEqual(accepted);
    expect(execute).not.toHaveBeenCalled();
  });

  it("reconciles a consumed write receipt after a transient job-store failure before fencing", async () => {
    const writeAcknowledgement = {
      ...nativeHarnessAcknowledgement,
      routeId: "claude-sonnet-approved-write",
      admissionProfileId: "foundation-apply-approved-writes" as const,
    };
    const writeProfile: AgentTaskNativeHarnessProfile = {
      ...nativeHarnessProfile,
      id: "claude-writer",
      routeId: writeAcknowledgement.routeId,
      admissionProfileId: writeAcknowledgement.admissionProfileId,
      acknowledgement: writeAcknowledgement,
    };
    const writeRoute: AgentTaskNativeHarnessRoute = {
      ...nativeHarnessRoute,
      routeId: writeAcknowledgement.routeId,
      admissionProfileId: writeAcknowledgement.admissionProfileId,
      acknowledgement: writeAcknowledgement,
    };
    const store = new InMemoryAgentTaskStore();
    const recordWriteApproval = store.recordWriteApproval.bind(store);
    const persistApproval = vi.spyOn(store, "recordWriteApproval");
    persistApproval
      .mockRejectedValueOnce(new Error("transient store failure"))
      .mockRejectedValueOnce(new Error("transient store failure"))
      .mockRejectedValueOnce(new Error("transient store failure"))
      .mockImplementation((...args) => recordWriteApproval(...args));
    let receipt: import("../../src/managed-write-approvals/sqlite-managed-write-approval-authority.js").ManagedWriteApprovalReceipt | undefined;
    const consume = vi.fn(() => {
      if (!receipt) throw new Error("missing receipt");
      receipt = {
        ...receipt,
        state: "consumed",
        consumedAt: now.toISOString(),
        consumedBy: "agent-task:job-000000001",
      };
      return receipt;
    });
    const execute = vi.fn(async (input: Parameters<NonNullable<AgentTaskApplicationOptions["nativeHarnessExecution"]>["execute"]>[0]) => ({
      runtimeInvocationId: `agent-task:${input.job.id}`,
      completedAt: now.toISOString(),
      resultHandoff: {
        provenance: {
          delivery: "runtime-generated" as const,
          configuredModelId: writeRoute.model,
          primaryObservedModelId: writeRoute.model,
          observedModelIds: [writeRoute.model],
        },
        summary: "Approved write completed after receipt reconciliation.",
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
      dataPolicyProof: nativeDataPolicyProof(input),
    }));
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: { resolve: async (id) => id === writeProfile.id ? writeProfile : undefined },
      routes: { resolve: async () => writeRoute },
      writeApprovals: {
        inspect: () => receipt,
        consume,
        revoke: () => { throw new Error("not used"); },
      },
      nativeHarnessExecution: { execute },
      nativeHarnessDispatchIdGenerator: () => "dispatch-write-000001",
    });

    const accepted = await service.accept({ ...submission, configuredAgentProfileId: writeProfile.id });
    const dispatch = accepted.dispatch;
    if (dispatch.kind !== "native-harness") throw new Error("expected native dispatch");
    receipt = {
      approvalId: "managed-write-approval:reconcile-001",
      state: "issued",
      binding: {
        projectId: accepted.projectId,
        jobId: accepted.id,
        callerId: accepted.callerId,
        workItemFingerprint: accepted.requestFingerprint,
        configuredAgentProfileId: accepted.configuredAgentProfileId,
        admissionProfileId: "foundation-apply-approved-writes",
        routeId: dispatch.routeId,
        providerId: dispatch.providerId,
        model: dispatch.model,
        adapterCapabilityId: dispatch.adapterCapabilityId,
        adapterCapabilityVersion: dispatch.adapterCapabilityVersion,
        authorityDigest: `sha256:${"a".repeat(64)}`,
        effectDigest: `sha256:${"b".repeat(64)}`,
        revisionDigest: `sha256:${"c".repeat(64)}`,
      },
      issuedAt: now.toISOString(),
      expiresAt: "2099-08-10T00:00:00.000Z",
      approverId: "operator",
    };
    await service.attachWriteApproval(query, accepted.id, receipt.approvalId);

    const persistenceFailure = await service.dispatch(accepted.id).catch((error: unknown) => error);
    expect(persistenceFailure).toMatchObject({ code: "job_persistence_unavailable" });
    await expect(service.failDispatch(accepted.id, persistenceFailure)).resolves.toMatchObject({ state: "queued" });

    const completed = await service.dispatch(accepted.id);
    expect(completed.state, JSON.stringify({ diagnostic: completed.diagnostic })).toBe("succeeded");
    expect(completed).toMatchObject({
      state: "succeeded",
      writeApproval: { state: "consumed", consumedBy: `agent-task:${accepted.id}` },
    });
    expect(consume).toHaveBeenCalledOnce();
    expect(persistApproval).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      consumedWriteApproval: expect.objectContaining({ consumerId: `agent-task:${accepted.id}` }),
    }));
  });

  it("keeps an unfenced job retryable when consumed-approval persistence remains unavailable", async () => {
    const service = new AgentTaskApplicationService(createOptions());
    const accepted = await service.accept(submission);

    await expect(service.failDispatch(
      accepted.id,
      new AgentTaskApplicationError(
        "job_persistence_unavailable",
        "Reconcile the consumed approval before dispatch.",
      ),
    )).resolves.toMatchObject({ state: "queued" });
    await expect(service.getStatus(query, accepted.id)).resolves.toMatchObject({
      state: "queued",
      dispatch: expect.not.objectContaining({ dispatchFenceId: expect.any(String) }),
    });
  });

  it("accepts a durable queued record before dispatch and exposes completion through status/result", async () => {
    const execution = deferred<{
      readonly runtimeInvocationId: string;
      readonly completedAt: string;
      readonly resultHandoff: {
        readonly provenance: {
          readonly delivery: "native-structured-output";
          readonly configuredModelId: string;
          readonly primaryObservedModelId: string;
          readonly observedModelIds: readonly string[];
          readonly harness: { readonly id: string; readonly executable: string; readonly version: string };
        };
        readonly summary: string;
        readonly resourceUris: readonly string[];
        readonly memoryWriteProposalUris: readonly string[];
      };
      readonly writeEvidence: readonly [{
        readonly evidenceId: string;
        readonly invocationId: string;
        readonly kind: "write-attempt-completed";
        readonly summary: string;
        readonly resourceUris: readonly string[];
        readonly recordedAt: string;
      }];
    }>();
    const store = new InMemoryAgentTaskStore();
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
      nativeHarnessExecution: { execute: async (input) => ({ ...(await execution.promise), dataPolicyProof: nativeDataPolicyProof(input) }) },
      nativeHarnessDispatchIdGenerator: () => "dispatch-async-000001",
    });

    const accepted = await service.accept({
      ...submission,
      configuredAgentProfileId: nativeHarnessProfile.id,
    });
    expect(accepted).toMatchObject({ state: "queued", dispatch: { kind: "native-harness" } });
    await expect(service.getResult(query, accepted.id)).resolves.toMatchObject({
      availability: "pending",
      lifecycleState: "queued",
    });

    const dispatch = service.dispatch(accepted.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await expect(service.getStatus(query, accepted.id)).resolves.toMatchObject({ state: "running" });
    await expect(service.getResult(query, accepted.id)).resolves.toMatchObject({
      availability: "pending",
      lifecycleState: "running",
    });

    execution.resolve({
      runtimeInvocationId: "runtime-invocation-async",
      completedAt: now.toISOString(),
      resultHandoff: {
        provenance: {
          delivery: "native-structured-output",
          configuredModelId: nativeHarnessProfile.model,
          primaryObservedModelId: nativeHarnessProfile.model,
          observedModelIds: [nativeHarnessProfile.model],
          harness: { id: "claude", executable: "claude", version: "2.1.226" },
        },
        summary: "Async native dispatch completed.",
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
      writeEvidence: [{
        evidenceId: "async-write-evidence",
        invocationId: `agent-task:${accepted.id}`,
        kind: "write-attempt-completed",
        summary: "Workspace write completed for C:\\Users\\operator\\private\\proof.txt",
        resourceUris: ["kiln://managed-agents/async-write"],
        recordedAt: now.toISOString(),
      }],
    });
    await expect(dispatch).resolves.toMatchObject({ state: "succeeded" });
    await expect(service.getResult(query, accepted.id)).resolves.toMatchObject({
      availability: "available",
      lifecycleState: "succeeded",
      handoff: { summary: "Async native dispatch completed." },
      writeEvidence: [{
        summary: "Workspace write completed for [REDACTED:path]",
      }],
    });
  });

  it("aborts active execution and ignores a late successful result after cancellation", async () => {
    const execution = deferred<{
      readonly runtimeInvocationId: string;
      readonly completedAt: string;
      readonly resultHandoff: {
        readonly provenance: { readonly delivery: "runtime-generated" };
        readonly summary: string;
        readonly resourceUris: readonly string[];
        readonly memoryWriteProposalUris: readonly string[];
      };
      readonly writeEvidence: readonly [{
        readonly evidenceId: string;
        readonly invocationId: string;
        readonly kind: "write-attempt-completed";
        readonly summary: string;
        readonly resourceUris: readonly string[];
        readonly recordedAt: string;
      }];
    }>();
    let observedSignal: AbortSignal | undefined;
    const service = new AgentTaskApplicationService({
      ...createOptions(),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
      nativeHarnessExecution: {
        execute: async (input) => {
          observedSignal = input.abortSignal;
          return { ...(await execution.promise), dataPolicyProof: nativeDataPolicyProof(input) };
        },
      },
      nativeHarnessDispatchIdGenerator: () => "dispatch-cancel-000001",
    });
    const accepted = await service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id });
    const dispatch = service.dispatch(accepted.id);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());

    await expect(service.cancel(query, accepted.id)).resolves.toMatchObject({ state: "cancelled", diagnostic: "cancelled" });
    expect(observedSignal?.aborted).toBe(true);
    execution.resolve({
      runtimeInvocationId: "runtime-invocation-late",
      completedAt: now.toISOString(),
      resultHandoff: {
        provenance: { delivery: "runtime-generated" },
        summary: "Late completion must not be published.",
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
      writeEvidence: [{
        evidenceId: "late-write-evidence",
        invocationId: `agent-task:${accepted.id}`,
        kind: "write-attempt-completed",
        summary: "Late evidence must not be published.",
        resourceUris: ["kiln://managed-agents/late-write"],
        recordedAt: now.toISOString(),
      }],
    });

    const cancelled = await dispatch;
    expect(cancelled).toMatchObject({ state: "cancelled" });
    expect(cancelled).not.toHaveProperty("result");
    await expect(service.getResult(query, accepted.id)).resolves.toMatchObject({
      availability: "failed",
      lifecycleState: "cancelled",
      diagnostic: "cancelled",
    });
  });

  it("does not fence native execution after cancellation has activated its abort signal", async () => {
    const store = new InMemoryAgentTaskStore();
    const routeResolution = deferred<AgentTaskNativeHarnessRoute>();
    const cancellationEntered = deferred<void>();
    const allowCancellationPersistence = deferred<void>();
    const transition = store.transition.bind(store);
    vi.spyOn(store, "transition").mockImplementation(async (id, state, diagnostic, updatedAt, failureEvidence) => {
      if (state === "cancelled") {
        cancellationEntered.resolve();
        await allowCancellationPersistence.promise;
      }
      return transition(id, state, diagnostic, updatedAt, failureEvidence);
    });
    const fence = vi.spyOn(store, "fenceNativeHarness");
    const execute = vi.fn();
    let routeResolutions = 0;
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: {
        resolve: async () => ++routeResolutions === 1 ? nativeHarnessRoute : routeResolution.promise,
      },
      nativeHarnessExecution: { execute },
      nativeHarnessDispatchIdGenerator: () => "dispatch-cancel-before-fence-000001",
    });
    const accepted = await service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id });
    const dispatch = service.dispatch(accepted.id);
    const cancellation = service.cancel(query, accepted.id);
    await cancellationEntered.promise;

    routeResolution.resolve(nativeHarnessRoute);
    await expect(dispatch).resolves.toMatchObject({ state: "queued" });
    expect(fence).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    allowCancellationPersistence.resolve();
    await expect(cancellation).resolves.toMatchObject({ state: "cancelled", diagnostic: "cancelled" });
  });

  it("persists an exact native-harness dispatch without economic evidence", async () => {
    const execution = vi.fn(async (input: Parameters<NonNullable<AgentTaskApplicationOptions["nativeHarnessExecution"]>["execute"]>[0]) => ({
      runtimeInvocationId: "runtime-invocation-native-harness",
      completedAt: now.toISOString(),
      resultHandoff: {
        provenance: {
          delivery: "native-structured-output" as const,
          configuredModelId: "claude-sonnet-5",
          primaryObservedModelId: "claude-sonnet-5",
          observedModelIds: ["claude-sonnet-5"],
          harness: { id: "claude", executable: "claude", version: "2.1.226" },
        },
        summary: "Native harness execution completed.",
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
      dataPolicyProof: nativeDataPolicyProof(input),
    }));
    const service = new AgentTaskApplicationService({
      ...createOptions(),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
      nativeHarnessExecution: { execute: execution },
      nativeHarnessDispatchIdGenerator: () => "dispatch-000000001",
    });

    const job = await dispatchAccepted(service, {
      ...submission,
      configuredAgentProfileId: nativeHarnessProfile.id,
    });

    expect(job).toMatchObject({
      version: 13,
      state: "succeeded",
      dispatch: {
        kind: "native-harness",
        routeId: nativeHarnessRoute.routeId,
        providerId: nativeHarnessRoute.providerId,
        model: nativeHarnessRoute.model,
        dispatchFenceId: "native-harness-dispatch:dispatch-000000001",
        acknowledgement: nativeHarnessAcknowledgement,
      },
      result: {
        runtimeInvocationId: "runtime-invocation-native-harness",
        routeId: nativeHarnessRoute.routeId,
        providerId: nativeHarnessRoute.providerId,
      },
    });
    expect(job).not.toHaveProperty("economicPolicyId");
    expect(job).not.toHaveProperty("economicAttemptId");
    expect(job).not.toHaveProperty("candidateSet");
    expect(execution).toHaveBeenCalledOnce();
    await expect(service.getReplay(query, job.id)).resolves.toMatchObject({
      dispatch: {
        kind: "native-harness",
        routeId: nativeHarnessRoute.routeId,
        dispatchFenceId: "native-harness-dispatch:dispatch-000000001",
      },
    });
  });

  it("commits an evidence-backed native deliberation resolution before the dispatch fence and replays it", async () => {
    const acknowledgement = {
      ...nativeHarnessAcknowledgement,
      deliberationResolution: nativeDeliberationResolution,
    };
    const profileWithDeliberation: AgentTaskNativeHarnessProfile = {
      ...nativeHarnessProfile,
      acknowledgement,
      deliberationResolution: nativeDeliberationResolution,
    };
    const routeWithDeliberation: AgentTaskNativeHarnessRoute = {
      ...nativeHarnessRoute,
      acknowledgement,
      deliberationResolution: nativeDeliberationResolution,
    };
    const service = new AgentTaskApplicationService({
      ...createOptions(),
      profiles: { resolve: async (id) => id === profileWithDeliberation.id ? profileWithDeliberation : undefined },
      routes: { resolve: async () => routeWithDeliberation },
    });

    const accepted = await service.accept({
      ...submission,
      configuredAgentProfileId: profileWithDeliberation.id,
      idempotencyKey: "native-deliberation-commit",
    });
    expect(accepted).toMatchObject({
      state: "queued",
      dispatch: {
        kind: "native-harness",
        deliberationResolution: nativeDeliberationResolution,
        acknowledgement: { deliberationResolution: nativeDeliberationResolution },
      },
    });

    await expect(service.getReplay(query, accepted.id)).resolves.toMatchObject({
      dispatch: { kind: "native-harness", deliberationResolution: nativeDeliberationResolution },
    });
  });

  it("accepts refreshed native deliberation observation time when revision identity is unchanged", async () => {
    const acknowledgement = {
      ...nativeHarnessAcknowledgement,
      deliberationResolution: nativeDeliberationResolution,
    };
    const profileWithDeliberation: AgentTaskNativeHarnessProfile = {
      ...nativeHarnessProfile,
      acknowledgement,
      deliberationResolution: nativeDeliberationResolution,
    };
    const routeWithRefreshedObservation: AgentTaskNativeHarnessRoute = {
      ...nativeHarnessRoute,
      acknowledgement,
      deliberationResolution: {
        ...nativeDeliberationResolution,
        capabilityEvidence: {
          ...nativeDeliberationResolution.capabilityEvidence,
          observedAt: "2026-08-10T01:00:00.000Z",
        },
      },
    };
    const execution = vi.fn(async (input: NativeHarnessExecutionInput) => ({
      runtimeInvocationId: "runtime-invocation-refreshed-deliberation",
      completedAt: now.toISOString(),
      resultHandoff: {
        provenance: {
          delivery: "native-structured-output" as const,
          configuredModelId: "claude-sonnet-5",
          primaryObservedModelId: "claude-sonnet-5",
          observedModelIds: ["claude-sonnet-5"],
          harness: { id: "claude", executable: "claude", version: "2.1.226" },
        },
        summary: "Refreshed evidence accepted.",
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
      dataPolicyProof: nativeDataPolicyProof(input),
    }));
    const service = new AgentTaskApplicationService({
      ...createOptions(),
      profiles: { resolve: async () => profileWithDeliberation },
      routes: { resolve: async () => routeWithRefreshedObservation },
      nativeHarnessExecution: { execute: execution },
    });

    const job = await dispatchAccepted(service, {
      ...submission,
      configuredAgentProfileId: profileWithDeliberation.id,
      idempotencyKey: "native-deliberation-observation-refresh",
    });

    expect(job.state).toBe("succeeded");
    expect(execution).toHaveBeenCalledOnce();
  });

  it("fails closed before route resolution when native deliberation evidence is incomplete", async () => {
    const invalidResolution = {
      status: "exact" as const,
      selectedLevel: "high",
      source: "route" as const,
      capabilityEvidence: {
        sourceIdentity: "opencode-cli-model-catalog",
        observedAt: "2026-08-10T00:00:00.000Z",
      },
    };
    const invalidProfile = {
      ...nativeHarnessProfile,
      deliberationResolution: invalidResolution,
      acknowledgement: { ...nativeHarnessAcknowledgement, deliberationResolution: invalidResolution },
    } as unknown as AgentTaskNativeHarnessProfile;
    const resolveRoute = vi.fn(async () => nativeHarnessRoute);
    const service = new AgentTaskApplicationService({
      ...createOptions(),
      profiles: { resolve: async () => invalidProfile },
      routes: { resolve: resolveRoute },
    });

    await expect(service.accept({
      ...submission,
      configuredAgentProfileId: invalidProfile.id,
      idempotencyKey: "native-deliberation-invalid-evidence",
    })).rejects.toMatchObject({ code: "profile_unavailable" });
    expect(resolveRoute).not.toHaveBeenCalled();
  });

  it("persists sanitized terminal failure evidence identically in status, result, replay, and lifecycle", async () => {
    const store = new InMemoryAgentTaskStore();
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
      nativeHarnessExecution: {
        execute: async () => {
          throw new AgentTaskExecutionFailure(
            "harness_version_mismatch",
            "kiln://diagnostics/agent-tasks/harness-version-mismatch",
            "C:\\operator\\secret payload",
          );
        },
      },
      nativeHarnessDispatchIdGenerator: () => "dispatch-failure-000001",
    });

    const job = await dispatchAccepted(service, { ...submission, configuredAgentProfileId: nativeHarnessProfile.id });
    const expectedEvidence = {
      version: 1,
      classification: "harness_version_mismatch",
      diagnosticUri: "kiln://diagnostics/agent-tasks/harness-version-mismatch",
    };
    expect(job).toMatchObject({ state: "failed", failureEvidence: expectedEvidence });
    expect(job.lifecycle.at(-1)).toMatchObject({ state: "failed", failureEvidence: expectedEvidence });
    expect(JSON.stringify(job)).not.toContain("secret payload");
    await expect(service.getStatus(query, job.id)).resolves.toMatchObject({ failureEvidence: expectedEvidence });
    await expect(service.getResult(query, job.id)).resolves.toMatchObject({ availability: "failed", failureEvidence: expectedEvidence });
    await expect(service.getReplay(query, job.id)).resolves.toMatchObject({ resultAvailability: "failed", failureEvidence: expectedEvidence });
  });

  it("fails closed to sanitized unknown evidence for invalid diagnostic URIs and untyped errors", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new AgentTaskExecutionFailure("native_session_error", "https://provider.invalid/private", "raw provider message"))
      .mockRejectedValueOnce(new Error("C:\\operator\\provider-secret"));
    const makeService = () => new AgentTaskApplicationService({
      ...createOptions(),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
      nativeHarnessExecution: { execute },
      idGenerator: (() => { let index = 0; return () => `job-failure-00000${++index}`; })(),
      nativeHarnessDispatchIdGenerator: (() => { let index = 0; return () => `dispatch-failure-00000${++index}`; })(),
    });
    const invalidUri = await dispatchAccepted(makeService(), { ...submission, configuredAgentProfileId: nativeHarnessProfile.id, idempotencyKey: "failure-invalid-uri" });
    const unknown = await dispatchAccepted(makeService(), { ...submission, configuredAgentProfileId: nativeHarnessProfile.id, idempotencyKey: "failure-unknown" });

    expect(invalidUri.failureEvidence).toEqual({ version: 1, classification: "native_session_error" });
    expect(unknown.failureEvidence).toEqual({ version: 1, classification: "unknown_failure" });
    expect(JSON.stringify([invalidUri, unknown])).not.toContain("provider-secret");
  });

  it("preserves a typed provider timeout as the terminal timed_out diagnostic", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-agent-task-timeout-"));
    try {
      const store = new FilesystemAgentTaskStore(root);
      const service = new AgentTaskApplicationService({
        ...createOptions(),
        store,
        profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
        routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
        nativeHarnessExecution: {
          execute: async () => {
            throw new AgentTaskApplicationError(
              "provider_timeout",
              "Retry the exact admitted route.",
              {
                version: 1,
                classification: "provider_timeout",
                diagnosticUri: "kiln://managed-agents/invocations/timeout-test/resources/timeout",
                transportPhase: "first_byte",
              },
            );
          },
        },
        nativeHarnessDispatchIdGenerator: () => "dispatch-timeout-000001",
      });

      const job = await dispatchAccepted(service, {
        ...submission,
        configuredAgentProfileId: nativeHarnessProfile.id,
        idempotencyKey: "typed-provider-timeout",
      });

      expect(job).toMatchObject({
        state: "timed_out",
        diagnostic: "provider_timeout",
        failureEvidence: {
          version: 1,
          classification: "provider_timeout",
          diagnosticUri: "kiln://managed-agents/invocations/timeout-test/resources/timeout",
          transportPhase: "first_byte",
        },
      });
      await expect(service.getResult(query, job.id)).resolves.toMatchObject({
        availability: "failed",
        diagnostic: "provider_timeout",
      });
      await expect(service.getReplay(query, job.id)).resolves.toMatchObject({
        lifecycleState: "timed_out",
      });
      await expect(new FilesystemAgentTaskStore(root).get(job.id)).resolves.toMatchObject({
        state: "timed_out",
        failureEvidence: { classification: "provider_timeout", transportPhase: "first_byte" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists the native fence before invoking the harness process", async () => {
    const store = new InMemoryAgentTaskStore();
    const events: string[] = [];
    const fence = store.fenceNativeHarness.bind(store);
    const fenceSpy = vi.spyOn(store, "fenceNativeHarness").mockImplementation(async (id, dispatchFenceId, updatedAt) => {
      events.push("fence");
      return fence(id, dispatchFenceId, updatedAt);
    });
    const execution = vi.fn(async (input: Parameters<NonNullable<AgentTaskApplicationOptions["nativeHarnessExecution"]>["execute"]>[0]) => {
      events.push("process");
      expect(input.job.state).toBe("running");
      expect(input.job.dispatch.dispatchFenceId).toBe("native-harness-dispatch:dispatch-000000001");
      await expect(store.get(input.job.id)).resolves.toMatchObject({
        state: "running",
        dispatch: { kind: "native-harness", dispatchFenceId: "native-harness-dispatch:dispatch-000000001" },
      });
      expect(input.callerIdentity).toEqual({
        kind: "external-harness",
        harness: "claude",
        attachmentId: "claude-session-001",
        evidenceId: "mcp-request-001",
      });
      return {
        runtimeInvocationId: "runtime-invocation-native-fenced",
        completedAt: now.toISOString(),
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output" as const,
            configuredModelId: nativeHarnessProfile.model,
            primaryObservedModelId: nativeHarnessProfile.model,
            observedModelIds: [nativeHarnessProfile.model],
            harness: { id: "claude", executable: "claude", version: "2.1.226" },
          },
          summary: "Native process ran after the durable fence.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
        dataPolicyProof: nativeDataPolicyProof(input),
      };
    });
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: { resolve: async (profile) => profile.kind === "native-harness" ? nativeHarnessRoute : undefined },
      nativeHarnessExecution: { execute: execution },
      nativeHarnessDispatchIdGenerator: () => "dispatch-000000001",
    });

    const accepted = await service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id });
    await service.dispatch(accepted.id, {
      callerIdentity: {
        kind: "external-harness",
        harness: "claude",
        attachmentId: "claude-session-001",
        evidenceId: "mcp-request-001",
      },
    });

    expect(events).toEqual(["fence", "process"]);
    expect(fenceSpy).toHaveBeenCalledOnce();
    expect(execution).toHaveBeenCalledOnce();
  });

  it("returns one atomic native fence owner and marks concurrent losers existing", async () => {
    const store = new InMemoryAgentTaskStore();
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
    });
    const accepted = await service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id });

    const [first, second] = await Promise.all([
      store.fenceNativeHarness(accepted.id, "native-harness-dispatch:concurrent-000001"),
      store.fenceNativeHarness(accepted.id, "native-harness-dispatch:concurrent-000002"),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(["acquired", "existing"]);
    const acquired = first.kind === "acquired" ? first : second;
    const existing = first.kind === "existing" ? first : second;
    expect(acquired.job.dispatch).toMatchObject({ dispatchFenceId: "native-harness-dispatch:concurrent-000001" });
    expect(existing.job).toEqual(acquired.job);
  });

  it("returns one atomic economic fence owner and mirrors the persisted run dispatch", async () => {
    const store = new InMemoryAgentTaskStore();
    const accepted = await new AgentTaskApplicationService(createOptions({ store })).accept(submission);

    const [first, second] = await Promise.all([
      store.fenceEconomic(accepted.id, "managed-economic-dispatch:concurrent-000001", now.toISOString()),
      store.fenceEconomic(accepted.id, "managed-economic-dispatch:concurrent-000002", now.toISOString()),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(["acquired", "existing"]);
    const acquired = first.kind === "acquired" ? first : second;
    const existing = first.kind === "existing" ? first : second;
    expect(acquired.job).toMatchObject({
      state: "running",
      dispatch: { kind: "economic", dispatchFenceId: "managed-economic-dispatch:concurrent-000001" },
      run: { state: "running", dispatch: { kind: "economic", dispatchFenceId: "managed-economic-dispatch:concurrent-000001" } },
    });
    expect(existing.job).toEqual(acquired.job);
  });

  it("settles a fenced economic commitment when task-fence persistence fails before provider execution", async () => {
    const store = new InMemoryAgentTaskStore();
    const fenceEconomic = vi.spyOn(store, "fenceEconomic").mockRejectedValue(
      new AgentTaskApplicationError("job_persistence_unavailable", "Persist the economic task fence."),
    );
    const recordExecutionSettlementPending = vi.fn(async () => undefined);
    const prepare = vi.fn(async () => ({
      status: "prepared" as const,
      commitment: {} as never,
      dispatchFenceId: "managed-economic-dispatch:persist-failure-000001",
      adapter: {} as never,
      abortSignal: new AbortController().signal,
      recordExecutionSettlementPending,
      createExecutionSettlement: () => ({} as never),
      registerEconomicSettlement: () => undefined,
    }));
    const execute = vi.fn();
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      economicAdoption: { adopt: async () => adoptedEconomicEvidence() },
      economicDispatch: { prepare } as unknown as ManagedEconomicDispatchCoordinator,
      economicExecution: { execute },
    });
    const accepted = await service.accept(submission);

    await expect(service.dispatch(accepted.id)).rejects.toMatchObject({ code: "job_persistence_unavailable" });
    expect(fenceEconomic).toHaveBeenCalledOnce();
    expect(recordExecutionSettlementPending).toHaveBeenCalledWith("agent-task-economic-fence-persistence-failed");
    expect(execute).not.toHaveBeenCalled();
    await expect(store.get(accepted.id)).resolves.toMatchObject({
      state: "queued",
      dispatch: expect.not.objectContaining({ dispatchFenceId: expect.any(String) }),
    });
  });

  it("executes native harness exactly once when dispatch calls race for fence ownership", async () => {
    const store = new InMemoryAgentTaskStore();
    const execution = deferred<{
      readonly runtimeInvocationId: string;
      readonly completedAt: string;
      readonly resultHandoff: {
        readonly provenance: {
          readonly delivery: "native-structured-output";
          readonly configuredModelId: string;
          readonly primaryObservedModelId: string;
          readonly observedModelIds: readonly string[];
          readonly harness: { readonly id: string; readonly executable: string; readonly version: string };
        };
        readonly summary: string;
        readonly resourceUris: readonly string[];
        readonly memoryWriteProposalUris: readonly string[];
      };
    }>();
    const execute = vi.fn(async (input: NativeHarnessExecutionInput) => ({
      ...(await execution.promise),
      dataPolicyProof: nativeDataPolicyProof(input),
    }));
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
      nativeHarnessExecution: { execute },
      nativeHarnessDispatchIdGenerator: () => "dispatch-concurrent-000001",
    });
    const accepted = await service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id });

    const first = service.dispatch(accepted.id);
    const second = service.dispatch(accepted.id);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledOnce();
    expect(await store.get(accepted.id)).toMatchObject({
      state: "running",
      dispatch: { dispatchFenceId: "native-harness-dispatch:dispatch-concurrent-000001" },
    });

    execution.resolve({
      runtimeInvocationId: "runtime-invocation-concurrent",
      completedAt: now.toISOString(),
      resultHandoff: {
        provenance: {
          delivery: "native-structured-output",
          configuredModelId: nativeHarnessProfile.model,
          primaryObservedModelId: nativeHarnessProfile.model,
          observedModelIds: [nativeHarnessProfile.model],
          harness: { id: "claude", executable: "claude", version: "2.1.226" },
        },
        summary: "The native process ran once under the acquired fence.",
        resourceUris: [],
        memoryWriteProposalUris: [],
      },
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(execute).toHaveBeenCalledOnce();
    expect([firstResult.state, secondResult.state].sort()).toEqual(["running", "succeeded"]);
    await expect(store.get(accepted.id)).resolves.toMatchObject({ state: "succeeded" });
  });

  it("serializes native fence ownership across services sharing a filesystem store", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-agent-tasks-native-fence-"));
    try {
      const execution = deferred<{
        readonly runtimeInvocationId: string;
        readonly completedAt: string;
        readonly resultHandoff: {
          readonly provenance: {
            readonly delivery: "native-structured-output";
            readonly configuredModelId: string;
            readonly primaryObservedModelId: string;
            readonly observedModelIds: readonly string[];
            readonly harness: { readonly id: string; readonly executable: string; readonly version: string };
          };
          readonly summary: string;
          readonly resourceUris: readonly string[];
          readonly memoryWriteProposalUris: readonly string[];
        };
      }>();
      const executeFirst = vi.fn(async (input: NativeHarnessExecutionInput) => ({
        ...(await execution.promise),
        dataPolicyProof: nativeDataPolicyProof(input),
      }));
      const executeSecond = vi.fn(async (input: NativeHarnessExecutionInput) => ({
        ...(await execution.promise),
        dataPolicyProof: nativeDataPolicyProof(input),
      }));
      const createService = (
        store: FilesystemAgentTaskStore,
        dispatchFenceId: string,
        execute: NonNullable<AgentTaskApplicationOptions["nativeHarnessExecution"]>["execute"],
      ) => new AgentTaskApplicationService({
        ...createOptions({ store }),
        profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
        routes: { resolve: async (resolvedProfile) => resolvedProfile.kind === "native-harness" ? nativeHarnessRoute : undefined },
        nativeHarnessExecution: { execute },
        nativeHarnessDispatchIdGenerator: () => dispatchFenceId,
      });
      const serviceFirst = createService(
        new FilesystemAgentTaskStore(root),
        "dispatch-filesystem-first-000001",
        executeFirst,
      );
      const serviceSecond = createService(
        new FilesystemAgentTaskStore(root),
        "dispatch-filesystem-second-000001",
        executeSecond,
      );
      const accepted = await serviceFirst.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id });

      const first = serviceFirst.dispatch(accepted.id);
      const second = serviceSecond.dispatch(accepted.id);
      await vi.waitFor(() => expect(executeFirst.mock.calls.length + executeSecond.mock.calls.length).toBe(1));
      expect(executeFirst.mock.calls.length + executeSecond.mock.calls.length).toBe(1);
      await expect(new FilesystemAgentTaskStore(root).get(accepted.id)).resolves.toMatchObject({ state: "running" });

      execution.resolve({
        runtimeInvocationId: "runtime-invocation-filesystem-concurrent",
        completedAt: now.toISOString(),
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output",
            configuredModelId: nativeHarnessProfile.model,
            primaryObservedModelId: nativeHarnessProfile.model,
            observedModelIds: [nativeHarnessProfile.model],
            harness: { id: "claude", executable: "claude", version: "2.1.226" },
          },
          summary: "The shared filesystem fence selected one process.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(executeFirst.mock.calls.length + executeSecond.mock.calls.length).toBe(1);
      expect([firstResult.state, secondResult.state].sort()).toEqual(["running", "succeeded"]);
      await expect(new FilesystemAgentTaskStore(root).get(accepted.id)).resolves.toMatchObject({ state: "succeeded" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the admitted native acknowledgement does not match the route", async () => {
    const store = new InMemoryAgentTaskStore();
    const reserve = vi.spyOn(store, "reserve");
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: { resolve: async (id) => id === nativeHarnessProfile.id ? nativeHarnessProfile : undefined },
      routes: {
        resolve: async () => ({
          ...nativeHarnessRoute,
          acknowledgement: { ...nativeHarnessAcknowledgement, routeId: "different-route" },
        }),
      },
      nativeHarnessExecution: { execute: vi.fn() },
    });

    await expect(service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id })).rejects.toMatchObject({
      code: "route_unavailable",
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("fails closed when a native profile has no versioned acknowledgement", async () => {
    const service = new AgentTaskApplicationService({
      ...createOptions(),
      profiles: {
        resolve: async (id) => id === nativeHarnessProfile.id
          ? { ...nativeHarnessProfile, acknowledgement: undefined as never }
          : undefined,
      },
    });

    await expect(service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id })).rejects.toMatchObject({
      code: "profile_unavailable",
    });
  });

  it("rejects runtime-selected native admission before governance, route, persistence, or process creation", async () => {
    const store = new InMemoryAgentTaskStore();
    const options = createOptions({ store });
    const admit = vi.spyOn(options.governance, "admit");
    const resolveRoute = vi.spyOn(options.routes, "resolve");
    const reserve = vi.spyOn(store, "reserve");
    const execute = vi.fn();
    const service = new AgentTaskApplicationService({
      ...options,
      profiles: {
        resolve: async (id) => id === nativeHarnessProfile.id
          ? {
              ...nativeHarnessProfile,
              acknowledgement: {
                ...nativeHarnessAcknowledgement,
                credentialMode: "runtime-selected" as never,
              },
            }
          : undefined,
      },
      nativeHarnessExecution: { execute },
    });

    await expect(service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id })).rejects.toMatchObject({
      code: "profile_unavailable",
    });
    expect(admit).not.toHaveBeenCalled();
    expect(resolveRoute).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns an existing fenced native job without a second process for a nonterminal duplicate acceptance", async () => {
    const store = new InMemoryAgentTaskStore();
    let profileResolution = 0;
    let releaseExecution!: () => void;
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const execution = vi.fn(async (input: NativeHarnessExecutionInput) => {
      await executionReleased;
      return {
        runtimeInvocationId: "runtime-invocation-native-idempotent",
        completedAt: "2026-07-29T18:00:02.000Z",
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output" as const,
            configuredModelId: nativeHarnessProfile.model,
            primaryObservedModelId: nativeHarnessProfile.model,
            observedModelIds: [nativeHarnessProfile.model],
            harness: { id: "claude", executable: "claude", version: "2.1.226" },
          },
          summary: "The native process ran once.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
        dataPolicyProof: nativeDataPolicyProof(input),
      };
    });
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      profiles: {
        resolve: async (id) => {
          if (id !== nativeHarnessProfile.id) return undefined;
          profileResolution += 1;
          return {
            ...nativeHarnessProfile,
            acknowledgement: {
              ...nativeHarnessAcknowledgement,
              acknowledgedAt: `2026-07-29T17:59:0${profileResolution}.000Z`,
            },
          };
        },
      },
      routes: {
        resolve: async (profile) => profile.kind === "native-harness"
          ? { ...nativeHarnessRoute, acknowledgement: profile.acknowledgement }
          : undefined,
      },
      nativeHarnessExecution: { execute: execution },
      nativeHarnessDispatchIdGenerator: () => "dispatch-000000001",
    });

    const accepted = await service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id });
    const first = service.dispatch(accepted.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(execution).toHaveBeenCalledOnce();
    const duplicate = await service.accept({ ...submission, configuredAgentProfileId: nativeHarnessProfile.id });

    expect(duplicate).toMatchObject({
      id: "job-000000001",
      state: "running",
      dispatch: { kind: "native-harness", dispatchFenceId: "native-harness-dispatch:dispatch-000000001" },
    });
    expect(execution).toHaveBeenCalledOnce();

    releaseExecution();
    await expect(first).resolves.toMatchObject({ id: "job-000000001", state: "succeeded" });
  });

  it("marks queued and fenced native work interrupted without redispatch after recovery", async () => {
    const store = new InMemoryAgentTaskStore([
      nativeStoredJob({ id: "native-job-queued", state: "queued" }),
      nativeStoredJob({ id: "native-job-running", state: "running", dispatchFenceId: "native-harness-dispatch:recovery-000001" }),
    ]);
    const execution = vi.fn();
    const service = new AgentTaskApplicationService({
      ...createOptions({ store }),
      nativeHarnessExecution: { execute: execution },
    });

    const recovered = await service.recoverInterrupted();

    expect(recovered).toHaveLength(2);
    expect(recovered.map((job) => [job.id, job.state])).toEqual([
      ["native-job-queued", "interrupted"],
      ["native-job-running", "interrupted"],
    ]);
    expect(recovered.every((job) => job.diagnostic === "invocation_failed")).toBe(true);
    expect(execution).not.toHaveBeenCalled();
    await expect(store.get("native-job-running")).resolves.toMatchObject({
      state: "interrupted",
      dispatch: { kind: "native-harness", dispatchFenceId: "native-harness-dispatch:recovery-000001" },
    });
  });

  it("returns unfenced economic recovery to the project owner without dispatching inline", async () => {
    const store = new InMemoryAgentTaskStore();
    const first = new AgentTaskApplicationService(createOptions({ store }));
    const accepted = await first.accept(submission);
    const recovered = await new AgentTaskApplicationService(createOptions({ store })).recoverInterrupted();

    expect(recovered).toEqual([accepted]);
    await expect(store.get(accepted.id)).resolves.toMatchObject({ state: "queued" });
  });

  it("holds an economic record with a persisted dispatch fence without redispatch", async () => {
    const store = new InMemoryAgentTaskStore();
    const accepted = await new AgentTaskApplicationService(createOptions({ store })).accept(submission);
    const execute = vi.fn();
    const service = new AgentTaskApplicationService({
      ...createOptions({ store, commitmentState: "dispatch-fenced" }),
      economicExecution: { execute },
    });

    await expect(service.dispatch(accepted.id)).resolves.toMatchObject({ state: "queued" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("replays native route identity and fence without economic evidence", async () => {
    const store = new InMemoryAgentTaskStore([
      nativeStoredJob({ id: "native-job-replay", state: "running", dispatchFenceId: "native-harness-dispatch:replay-000001" }),
    ]);
    const service = new AgentTaskApplicationService(createOptions({ store }));

    const replay = await service.getReplay(query, "native-job-replay");

    expect(replay).toMatchObject({
      dispatch: {
        kind: "native-harness",
        routeId: nativeHarnessRoute.routeId,
        routeRevision: nativeHarnessRoute.routeRevision,
        providerId: nativeHarnessRoute.providerId,
        model: nativeHarnessRoute.model,
        adapterCapabilityId: nativeHarnessRoute.adapterCapabilityId,
        adapterCapabilityVersion: nativeHarnessRoute.adapterCapabilityVersion,
        acknowledgement: nativeHarnessAcknowledgement,
        dispatchFenceId: "native-harness-dispatch:replay-000001",
      },
    });
    expect(replay).not.toHaveProperty("economic");
  });

  it("persists policy identity and candidates without selecting an execution route", async () => {
    const service = new AgentTaskApplicationService(createOptions());

    const job = await dispatchAccepted(service, submission);

    expect(job).toMatchObject({
      version: 13,
      state: "failed",
      diagnostic: "economic_commitment_unavailable",
      dispatch: {
        kind: "economic",
        economicPolicyId: "economy-policy",
        economicPolicyRevision: "revision-001",
        constraints: {},
        candidateSet: {
          candidates: [{ routeId: "codex-primary" }],
          rejections: [{ reason: "economic-capability-unverified" }],
        },
        economicAttemptId: "economic-attempt:attempt-000000001",
      },
      lifecycle: [
        { sequence: 1, state: "queued" },
        {
          sequence: 2,
          state: "failed",
          diagnostic: "economic_commitment_unavailable",
        },
      ],
      adoptedDecisionAt: now.toISOString(),
    });
    expect(job.requestFingerprint).toBe(digestManagedEconomicValue({
      objective: submission.objective,
      configuredAgentProfileId: submission.configuredAgentProfileId,
      economicPolicyId: "economy-policy",
      economicPolicyRevision: "revision-001",
      constraints: {},
    }));
    expect(job.idempotencyKeyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(job).not.toHaveProperty("routeId");
    expect(job).not.toHaveProperty("providerId");
    expect(job).not.toHaveProperty("accountLease");
    await expect(service.getResult(query, job.id)).resolves.toMatchObject({
      availability: "failed",
      diagnostic: "economic_commitment_unavailable",
    });
    await expect(service.getReplay(query, job.id)).resolves.toMatchObject({
      availability: "available",
      resultAvailability: "failed",
    });
  });

  it("never invokes an adapter, credential, lease, reservation, or provider port", async () => {
    const sideEffect = vi.fn();
    const options = createOptions();
    const service = new AgentTaskApplicationService({
      ...options,
      // The application contract deliberately has no execution-side port.
      routes: {
        resolve: async () => {
          expect(sideEffect).not.toHaveBeenCalled();
          return candidateSet();
        },
      },
    });

    await dispatchAccepted(service, submission);

    expect(sideEffect).not.toHaveBeenCalled();
    expect(Object.keys(options)).not.toContain("runtime");
  });

  it("joins replay evidence by the persisted job and economic attempt without changing lifecycle", async () => {
    const inspect = vi.fn(() => ({
      evidenceVersion: 1 as const,
      status: "denied" as const,
      policyId: "economy-policy",
      policyRevision: "revision-001",
      policyDigest: `sha256:${"a".repeat(64)}`,
      rejections: [{ stage: "economic-selection" as const, routeId: "codex-primary", reason: "quota-evidence-missing" }],
    }));
    const service = new AgentTaskApplicationService({
      ...createOptions(),
      economicReplay: { inspect },
    });
    const job = await dispatchAccepted(service, submission);
    await expect(service.getReplay(query, job.id)).resolves.toMatchObject({
      lifecycleState: "failed",
      dispatch: { kind: "economic", economic: { availability: "available", snapshot: { status: "denied", policyId: "economy-policy", rejections: [{ stage: "economic-selection" }] } } },
    });
    expect(inspect).toHaveBeenCalledWith({ jobId: job.id, economicAttemptId: job.dispatch.kind === "economic" ? job.dispatch.economicAttemptId : "" });
  });

  it("makes missing or corrupt authority replay evidence visibly unavailable", async () => {
    const unavailable = new AgentTaskApplicationService({ ...createOptions(), economicReplay: { inspect: () => undefined } });
    const missing = await dispatchAccepted(unavailable, submission);
    await expect(unavailable.getReplay(query, missing.id)).resolves.toMatchObject({ dispatch: { kind: "economic", economic: { availability: "unavailable", reason: "evidence-not-found" } } });
    const corrupt = new AgentTaskApplicationService({ ...createOptions(), economicReplay: { inspect: () => { throw new Error("malformed"); } } });
    const job = await dispatchAccepted(corrupt, submission);
    await expect(corrupt.getReplay(query, job.id)).resolves.toMatchObject({ dispatch: { kind: "economic", economic: { availability: "unavailable", reason: "evidence-unprojectable" } } });
  });

  it("persists one V13 terminal result after commitment, exact adapter construction, fence, and settlement", async () => {
    const fenceDispatch = vi.fn();
    const settleExecution = vi.fn();
    const selectedCommitment = {
      commitmentId: "commitment-agent-task",
      reservation: {
        reservationId: "reservation-agent-task",
        jobId: "job-000000001",
        economicAttemptId: "economic-attempt:attempt-000000001",
        policy: {} as never,
        selectedIdentity: {
          route: {
            routeId: "codex-primary",
            providerId: "codex-oauth",
            modelId: "gpt-test",
            adapterCapabilityId: "codex-oauth-direct",
            adapterCapabilityVersion: "1",
          } as never,
          account: { kind: "accountless" as const },
        },
        priceIdentity: null,
        envelope: { kind: "bounded" as const, digest: `sha256:${"e".repeat(64)}`, limits: [] },
        amounts: [],
        authorityRevision: `sha256:${"d".repeat(64)}`,
      },
      rejected: [],
      notSelected: [],
    };
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: {
        acquire: () => ({
          status: "committed",
          replay: false,
          record: { commitment: selectedCommitment, state: "held" } as never,
        }),
        releasePreFence: vi.fn(),
        fenceDispatch,
        settleExecution,
        recordExecutionSettlementPending: vi.fn(),
      },
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });
    const service = new AgentTaskApplicationService({
      ...createOptions(),
      economicAdoption: { adopt: async () => sqliteAdoptedEconomicEvidence() },
      economicDispatch: coordinator,
      economicExecution: {
        execute: async ({ job, preparation }) => {
          preparation.registerEconomicSettlement(Promise.resolve(
            preparation.createExecutionSettlement({
              actualIdentity: preparation.commitment.reservation.selectedIdentity,
              usage: {
                kind: "complete",
                units: [{ atoms: "3", scale: 0, unit: "request", scheme: { kind: "unit" } }],
              },
              evidence: sqliteAdoptedEconomicEvidence().snapshot.routes[0]!.priceEvidence.identity.evidence,
            }),
          ));
          return {
            runtimeInvocationId: "runtime-invocation-agent-task",
            completedAt: now.toISOString(),
            resultHandoff: {
              provenance: {
                delivery: "native-structured-output",
                configuredModelId: "gpt-test",
                primaryObservedModelId: "gpt-test",
                observedModelIds: ["gpt-test"],
              },
              summary: "Managed economic execution completed.",
              resourceUris: [],
              memoryWriteProposalUris: [],
            },
            dataPolicyProof: {
              version: 1,
              jobId: job.id,
              dispatchFenceId: preparation.dispatchFenceId,
              routeId: "codex-primary",
              providerId: "codex-oauth",
              providerModelId: "gpt-test",
              decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
              evidence: {
                providerId: "codex-oauth", providerModelId: "gpt-test",
                sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"f".repeat(64)}`,
                trainingPosture: "prohibited", retentionPosture: "zero", retentionDays: 0,
                maximumClassification: "internal", observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z",
              },
            },
          };
        },
      },
    });

    const completed = await dispatchAccepted(service, submission);
    expect(completed).toMatchObject({
      version: 13,
      state: "succeeded",
      objective: submission.objective,
      dispatch: {
        kind: "economic",
        dispatchFenceId: expect.stringMatching(/^managed-economic-dispatch:/u),
      },
    });
    expect(completed.run.dispatch).toEqual(completed.dispatch);
    expect(completed.result?.dataPolicyProof).toMatchObject({
      jobId: completed.id,
      dispatchFenceId: completed.dispatch.kind === "economic" ? completed.dispatch.dispatchFenceId : undefined,
      routeId: "codex-primary",
      providerId: "codex-oauth",
      providerModelId: "gpt-test",
    });
    const status = await service.getStatus(query, completed.id);
    const result = await service.getResult(query, completed.id);
    const replay = await service.getReplay(query, completed.id);
    expect(status.dispatch).toEqual(completed.dispatch);
    expect(status.run.dispatch).toEqual(completed.dispatch);
    expect(result.dataPolicyProof).toEqual(completed.result?.dataPolicyProof);
    expect(replay.dataPolicyProof).toEqual(completed.result?.dataPolicyProof);
    await expect(service.getResult(query, completed.id)).resolves.toMatchObject({
      availability: "available",
      routeId: "codex-primary",
      providerId: "codex-oauth",
      handoff: { summary: "Managed economic execution completed." },
    });
    await expect(service.getReplay(query, completed.id)).resolves.toMatchObject({
      availability: "available",
      resultAvailability: "available",
      lifecycle: [
        { state: "queued" },
        { state: "running" },
        { state: "succeeded" },
      ],
    });
    expect(fenceDispatch).toHaveBeenCalledOnce();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settleExecution).toHaveBeenCalledOnce();
  });

  it("binds idempotency to policy revision and normalized constraints", async () => {
    let constraints: AgentTaskEconomicProfile["constraints"] = {
      providerId: "codex-oauth",
      model: "openai/gpt-test",
    };
    const store = new InMemoryAgentTaskStore();
    const service = new AgentTaskApplicationService(createOptions({
      store,
      currentProfile: () => profile(constraints),
      currentCandidates: () => candidateSet(constraints),
    }));

    const first = await dispatchAccepted(service, submission);
    await expect(dispatchAccepted(service, submission)).resolves.toEqual(first);
    expect(first).toMatchObject({ dispatch: { kind: "economic", constraints: { model: "openai/gpt-test" } } });

    constraints = { providerId: "codex-oauth" };
    await expect(dispatchAccepted(service, submission)).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("rejects pre-V9 agent-task records", () => {
    const queued = {
      version: 6,
      id: "job-precommit-006",
      economicAttemptId: "economic-attempt:attempt-precommit-006",
      adoptedDecisionAt: now.toISOString(),
      state: "queued",
      projectId: "kiln",
      callerId: "codex-app:caller-001",
      configuredAgentProfileId: "scout",
      admissionProfileId: "foundation-readonly-plan",
      economicPolicyId: "economy-policy",
      economicPolicyRevision: "revision-001",
      constraints: {},
      candidateSet: candidateSet(),
      governanceSource: "kiln-work-governance",
      admissionId: "admission-001",
      requestFingerprint: `sha256:${"a".repeat(64)}`,
      idempotencyKeyHash: `sha256:${"b".repeat(64)}`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lifecycle: [{ sequence: 1, state: "queued", observedAt: now.toISOString() }],
    };
    expect(() => new InMemoryAgentTaskStore([queued])).toThrowError(expect.objectContaining({
      code: "job_persistence_corrupt",
    }));
  });

  it("returns the persisted V13 run identity and decision time on a later replay", async () => {
    let currentTime = now;
    const store = new InMemoryAgentTaskStore();
    const service = new AgentTaskApplicationService(createOptions({
      store,
      clock: () => currentTime,
    }));

    const first = await dispatchAccepted(service, submission);
    currentTime = new Date("2026-07-29T18:00:30.000Z");
    const replay = await dispatchAccepted(service, submission);

    expect(replay).toEqual(first);
    expect(replay).toMatchObject({
      version: 13,
      dispatch: { kind: "economic", economicAttemptId: "economic-attempt:attempt-000000001" },
      adoptedDecisionAt: now.toISOString(),
    });
  });

  it("rejects candidate evidence that does not bind the profile policy and constraints", async () => {
    const service = new AgentTaskApplicationService(createOptions({
      currentProfile: () => profile({ routeId: "codex-primary" }),
      currentCandidates: () => candidateSet(),
    }));

    await expect(dispatchAccepted(service, submission)).rejects.toMatchObject({
      code: "route_unavailable",
    });
  });

  it("fails before candidate admission and persistence when governance denies work", async () => {
    const store = new InMemoryAgentTaskStore();
    const reserve = vi.spyOn(store, "reserve");
    const options = createOptions({ store });
    const resolveCandidates = vi.spyOn(options.routes, "resolve");
    const service = new AgentTaskApplicationService({
      ...options,
      governance: {
        ...options.governance,
        admit: async () => ({ admitted: false }),
      },
    });

    await expect(service.accept(submission)).rejects.toMatchObject({
      code: "admission_denied",
    });
    expect(resolveCandidates).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("serializes concurrent duplicate submissions at the store owner", async () => {
    const store = new InMemoryAgentTaskStore();
    const service = new AgentTaskApplicationService(createOptions({ store }));

    const jobs = await Promise.all([
      service.accept(submission),
      service.accept(submission),
      service.accept(submission),
    ]);

    expect(new Set(jobs.map((job) => job.id))).toEqual(
      new Set(["job-000000001"]),
    );
    expect(store.all()).toHaveLength(1);
  });

  it("binds status and result queries to the persisted caller and project", async () => {
    const service = new AgentTaskApplicationService(createOptions());
    const job = await dispatchAccepted(service, submission);

    await expect(service.getStatus({
      ...query,
      callerId: "different-caller",
    }, job.id)).rejects.toMatchObject({ code: "unauthorized_job" });
    await expect(service.getResult({
      project: { id: "different-project" },
      callerId: query.callerId,
    }, job.id)).rejects.toMatchObject({ code: "unauthorized_job" });
  });

  it("keeps terminal records immutable and cancellation honest", async () => {
    const store = new InMemoryAgentTaskStore();
    const service = new AgentTaskApplicationService(createOptions({ store }));
    const job = await dispatchAccepted(service, submission);

    await expect(service.cancel(query, job.id)).rejects.toMatchObject({
      code: "invalid_transition",
    });
    await expect(store.transition(job.id, "cancelled")).rejects.toMatchObject({
      code: "invalid_transition",
    });
  });

  it("preserves V13 idempotency across a filesystem restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-agent-tasks-v9-"));
    try {
      const first = new AgentTaskApplicationService(createOptions({
        store: new FilesystemAgentTaskStore(root),
      }));
      const created = await dispatchAccepted(first, submission);
      const second = new AgentTaskApplicationService({
        ...createOptions({ store: new FilesystemAgentTaskStore(root) }),
        idGenerator: () => "job-000000002",
      });

      await expect(dispatchAccepted(second, submission)).resolves.toEqual(created);
      const persisted = JSON.parse(
        await readFile(join(root, "agent-tasks", "agent-tasks.json"), "utf8"),
      ) as unknown[];
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({ version: 13 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects V10 persisted records without a compatibility migration", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-agent-tasks-v10-rejected-"));
    try {
      const legacy = { ...nativeStoredJob({ id: "native-job-v10-rejected", state: "queued" }), version: 10 };
      await mkdir(join(root, "agent-tasks"));
      await writeFile(join(root, "agent-tasks", "agent-tasks.json"), `${JSON.stringify([legacy])}\n`, "utf8");

      await expect(new FilesystemAgentTaskStore(root).get(legacy.id)).rejects.toMatchObject({ code: "job_persistence_corrupt" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown persisted AgentRun fields", async () => {
    const stored = nativeStoredJob({ id: "native-job-extra-run-field", state: "queued" });
    await expect(async () => new InMemoryAgentTaskStore([{
      ...stored,
      run: { ...stored.run, aliasRunId: stored.run.runId },
    }])).rejects.toMatchObject({ code: "job_persistence_corrupt" });
  });

  it("fails closed for corrupt V13 candidate evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-agent-tasks-corrupt-"));
    try {
      const service = new AgentTaskApplicationService(createOptions({
        store: new FilesystemAgentTaskStore(root),
      }));
      const created = await dispatchAccepted(service, submission);
      const path = join(root, "agent-tasks", "agent-tasks.json");
      const records = JSON.parse(await readFile(path, "utf8")) as Array<
        Record<string, unknown>
      >;
      const dispatchRecord = records[0]?.dispatch as {
        candidateSet: { rejections: Array<Record<string, unknown>> };
      };
      dispatchRecord.candidateSet.rejections[0]!.reason = "unowned-reason";
      await writeFile(path, `${JSON.stringify(records)}\n`, "utf8");

      await expect(
        new FilesystemAgentTaskStore(root).get(created.id),
      ).rejects.toMatchObject({ code: "job_persistence_corrupt" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes storage failures without leaking infrastructure errors", async () => {
    const service = new AgentTaskApplicationService(createOptions({
      store: {
        reserve: async () => {
          throw new Error("C:\\operator\\secret-provider-payload");
        },
        get: async () => undefined,
        transition: async () => {
          throw new Error("unused");
        },
        completeSuccess: async () => {
          throw new Error("unused");
        },
        listNonterminal: async () => [],
        fenceEconomic: async () => {
          throw new Error("unused");
        },
        fenceNativeHarness: async () => {
          throw new Error("unused");
        },
      },
    }));

    await expect(service.accept(submission)).rejects.toEqual(
      expect.objectContaining({
        code: "job_persistence_unavailable",
        message: "job_persistence_unavailable",
      }),
    );
  });
});
