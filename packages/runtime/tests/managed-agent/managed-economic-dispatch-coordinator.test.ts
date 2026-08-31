import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptManagedEconomicSnapshot,
  digestManagedEconomicValue,
  type ManagedEconomicCommitment,
  type ManagedEconomicSettlement,
} from "@kilnai/core/cost";
import {
  ManagedEconomicDispatchCoordinator,
  ManagedEconomicLifecycleTimeoutError,
  type ManagedEconomicActionClaim,
  type ManagedEconomicDispatchAdoption,
  type ManagedEconomicDispatchAuthorityPort,
  type ManagedEconomicLifecycleEventPort,
} from "../../src/agents/managed-invocation/economic-dispatch-coordinator.js";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import { appendManagedEconomicLifecycleSessionEvent } from "../../src/agents/managed-invocation/session-events.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { defineEffectiveAuthorityAdmissionBundle, type EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { createEconomicRouteProofAdoption } from "./economic-route-proof-fixture.js";
import { createFixtureModelRoundStore, createFixtureToolActionStore } from "../session/runtime-claim-fixture.js";

const AUTHORITY_PROFILE_ID = "authority:dispatch-test:read-only";
const INVOCATION_ID = "managed-invocation:dispatch-test";
const PROFILE_AUTHORITY_DIGEST = `sha256:${"9".repeat(64)}`;

function unknownQuotaEvidence(capacityIdentity: string) {
  return {
    kind: "unknown" as const,
    capacityIdentity,
    subscriptionClass: "unknown" as const,
    reason: "fixture usage evidence is unavailable",
    evidence: null,
  };
}

function admissionBundle(): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "dispatch-test-session",
    turnId: "dispatch-test-turn",
    admittedAt: "2026-08-01T00:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "dispatch-session-revision", revisions: { routes: "1", skills: "1" } },
      turnRevision: { revisionSetId: "dispatch-turn-revision", revisions: { routes: "1", skills: "1" } },
    },
    session: {
      skillCatalog: { catalogId: "dispatch-test-skills", revision: "1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "test", subjectId: "dispatch-test-session" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection",
        reason: "test",
        completeness: "authoritative",
        toolCount: 0,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "observe",
        boundaries: [],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      },
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

function dispatchAdoption(): ManagedEconomicDispatchAdoption {
  return createEconomicRouteProofAdoption({
    providerId: "codex-oauth",
    routeId: "route-a",
    modelId: "gpt-test",
    priceKind: "metered",
    quotaEvidence: unknownQuotaEvidence("route-a"),
    quotaRequirement: "optional",
  });
}

function recordingLifecycleEvents(): { readonly port: ManagedEconomicLifecycleEventPort; readonly transitions: string[] } {
  const transitions: string[] = [];
  return {
    port: { record: (input) => { transitions.push(input.transition); } },
    transitions,
  };
}

function commitment(): ManagedEconomicCommitment {
  return {
    commitmentId: "commitment-a",
    reservation: {
      reservationId: "reservation-a",
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      policy: {} as never,
      selectedIdentity: {
        route: {
          routeId: "route-a",
          providerId: "codex-oauth",
          modelId: "gpt-test",
          adapterCapabilityId: "direct-runtime",
          adapterCapabilityVersion: "1",
        } as never,
        account: {
          kind: "account-bound",
          capacityIdentity: "account-b",
          accountRef: "configured:account-b" as never,
          credentialRevision: "b".repeat(64),
          creditPosture: "disabled",
          overagePosture: "disabled",
        },
      },
      priceIdentity: null,
      envelope: { kind: "bounded", digest: `sha256:${"a".repeat(64)}`, limits: [] },
      amounts: [],
      authorityRevision: `sha256:${"c".repeat(64)}`,
    },
    rejected: [],
    notSelected: [],
  };
}

function authority(state: "held" | "dispatch-fenced" = "held") {
  const selected = commitment();
  const port: ManagedEconomicDispatchAuthorityPort = {
    acquire: vi.fn(() => ({
      status: "committed" as const,
      replay: state !== "held",
      record: { commitment: selected, state, ownerGeneration: "managed-economic-owner:test" } as never,
    })),
    releasePreFence: vi.fn(),
    fenceDispatch: vi.fn(),
    readDispatch: vi.fn(() => undefined),
    settleExecution: vi.fn(),
    recordExecutionSettlementPending: vi.fn(),
  };
  return port;
}

describe("ManagedEconomicDispatchCoordinator", () => {
  it("materializes the exact committed adapter before fencing the provider effect", async () => {
    const events: string[] = [];
    const economicAuthority = authority();
    const lifecycleEvents = recordingLifecycleEvents();
    vi.mocked(economicAuthority.acquire).mockImplementation((input) => {
      events.push(`commit:${input.economicAttemptId}`);
      return {
        status: "committed",
        replay: false,
        record: { commitment: commitment(), state: "held", ownerGeneration: "managed-economic-owner:test" } as never,
      };
    });
    vi.mocked(economicAuthority.fenceDispatch).mockImplementation(() => {
      events.push("fence");
      return undefined as never;
    });
    const resolveLifecycleTimeoutMs = vi.fn(() => 1_000);
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs,
      createAdapter: async ({
        commitment: selected,
        authorityProfileId,
        profileAuthorityDigest,
        invocationId,
      }) => {
        events.push(`adapter:${selected.reservation.selectedIdentity.account.kind}`);
        expect(authorityProfileId).toBe(AUTHORITY_PROFILE_ID);
        expect(profileAuthorityDigest).toBe(PROFILE_AUTHORITY_DIGEST);
        expect(invocationId).toBe(INVOCATION_ID);
        return { descriptor: {} } as never;
      },
    });

    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
      lifecycleEvents: lifecycleEvents.port,
    });
    if (prepared.status !== "prepared") throw new Error("fixture");
    expect(resolveLifecycleTimeoutMs).toHaveBeenCalledWith(
      expect.any(Object),
      "read-only",
      AUTHORITY_PROFILE_ID,
    );
    expect(events).toEqual(["commit:economic-attempt-a", "adapter:account-bound", "fence"]);
    expect(lifecycleEvents.transitions).toEqual(["held", "dispatch-fenced"]);
    events.push("provider-effect");
    expect(events).toEqual([
      "commit:economic-attempt-a",
      "adapter:account-bound",
      "fence",
      "provider-effect",
    ]);

    const economicSettlement = settlement(prepared.dispatchFenceId);
    prepared.registerEconomicSettlement(Promise.resolve(economicSettlement));
    await vi.waitFor(() => expect(economicAuthority.settleExecution).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      prepared.dispatchFenceId,
      economicSettlement,
    ));
    await vi.waitFor(() => expect(lifecycleEvents.transitions).toEqual(["held", "dispatch-fenced", "released"]));
  });

  it("binds the persisted admission receipt and named effect in the canonical claim", async () => {
    const economicAuthority = authority();
    const bundle = admissionBundle();
    const claim = {
      version: 1 as const,
      attemptId: "economic-attempt-a",
      admissionId: bundle.admissionId,
      admissionBundle: bundle,
      ownerGeneration: "managed-economic-owner:test",
      effectIdentity: "managed-economic-dispatch:test",
    };
    const resolveLifecycleTimeoutMs = vi.fn(() => 1_000);
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });

    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: bundle,
      effectIdentity: claim.effectIdentity,
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    });

    expect(prepared).toMatchObject({ status: "prepared" });
    expect(economicAuthority.fenceDispatch).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      expect.any(String),
      {
        ...claim,
        intentFingerprint: `sha256:${"9".repeat(64)}`,
      },
    );
  });

  it("validates and consumes approval before fencing or materializing an adapter", async () => {
    const order: string[] = [];
    const economicAuthority = authority();
    const validateAndConsumeApprovalBeforeFence = vi.fn(async ({ commitment: selected }: { readonly commitment: ManagedEconomicCommitment }) => {
      order.push(`approval:${selected.commitmentId}`);
    });
    vi.mocked(economicAuthority.fenceDispatch).mockImplementation(() => {
      order.push("fence");
      return undefined as never;
    });
    const createAdapter = vi.fn(async () => {
      order.push("adapter");
      return { descriptor: {} } as never;
    });
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter,
    });

    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "approved-write",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
      validateAndConsumeApprovalBeforeFence,
    });

    expect(prepared).toMatchObject({ status: "prepared" });
    expect(validateAndConsumeApprovalBeforeFence).toHaveBeenCalledOnce();
    expect(validateAndConsumeApprovalBeforeFence).toHaveBeenCalledWith({
      commitment: expect.objectContaining({ commitmentId: "commitment-a" }),
    });
    expect(order).toEqual(["approval:commitment-a", "adapter", "fence"]);
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
  });

  it("releases the held commitment when pre-fence approval validation or consumption fails", async () => {
    const economicAuthority = authority();
    const createAdapter = vi.fn();
    const validateAndConsumeApprovalBeforeFence = vi.fn(async () => {
      throw new Error("approval-rejected");
    });
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter,
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "approved-write",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
      validateAndConsumeApprovalBeforeFence,
    })).rejects.toThrow("approval-rejected");

    expect(validateAndConsumeApprovalBeforeFence).toHaveBeenCalledOnce();
    expect(economicAuthority.releasePreFence).toHaveBeenCalledOnce();
    expect(economicAuthority.releasePreFence).toHaveBeenCalledWith("job-a", "economic-attempt-a");
    expect(economicAuthority.fenceDispatch).not.toHaveBeenCalled();
    expect(economicAuthority.recordExecutionSettlementPending).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("does not redispatch a replay whose durable commitment is already fenced", async () => {
    const createAdapter = vi.fn();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: authority("dispatch-fenced"),
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter,
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    })).resolves.toMatchObject({ status: "already-dispatched" });
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("releases capacity when adapter construction fails before the action fence", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => { throw new Error("synthetic adapter failure"); },
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    })).rejects.toThrow("synthetic adapter failure");
    expect(economicAuthority.fenceDispatch).not.toHaveBeenCalled();
    expect(economicAuthority.recordExecutionSettlementPending).not.toHaveBeenCalled();
    expect(economicAuthority.releasePreFence).toHaveBeenCalledOnce();
  });

  it("fails closed on an authority digest mismatch before adapter materialization or fencing", async () => {
    const economicAuthority = authority();
    const createAdapter = vi.fn(async () => ({ descriptor: {} }) as never);
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter,
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
      validateExecutionProfile: async () => {
        throw new Error("identity-revision-conflict: managed profile authority changed");
      },
    })).rejects.toThrow("identity-revision-conflict");
    expect(economicAuthority.fenceDispatch).not.toHaveBeenCalled();
    expect(economicAuthority.recordExecutionSettlementPending).not.toHaveBeenCalled();
    expect(economicAuthority.releasePreFence).toHaveBeenCalledOnce();
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("releases a commitment when its configured lifecycle timeout is invalid", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 0,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    })).rejects.toThrow("timeout must be a positive finite number");
    expect(economicAuthority.releasePreFence).toHaveBeenCalledOnce();
  });

  it("releases the held commitment when the lifecycle is already aborted before dispatch fencing", async () => {
    const economicAuthority = authority();
    const lifecycleEvents = recordingLifecycleEvents();
    const validateAndConsumeApprovalBeforeFence = vi.fn();
    const controller = new AbortController();
    controller.abort(new Error("synthetic pre-fence abort"));
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
      abortSignal: controller.signal,
      lifecycleEvents: lifecycleEvents.port,
      validateAndConsumeApprovalBeforeFence,
    })).rejects.toThrow("synthetic pre-fence abort");

    expect(validateAndConsumeApprovalBeforeFence).not.toHaveBeenCalled();
    expect(economicAuthority.fenceDispatch).not.toHaveBeenCalled();
    expect(economicAuthority.releasePreFence).toHaveBeenCalledWith("job-a", "economic-attempt-a");
    expect(lifecycleEvents.transitions).toEqual(["held"]);
  });

  it("emits denied and dispatches nothing further when acquire denies the commitment", async () => {
    const lifecycleEvents = recordingLifecycleEvents();
    const createAdapter = vi.fn();
    const economicAuthority: ManagedEconomicDispatchAuthorityPort = {
      acquire: vi.fn<ManagedEconomicDispatchAuthorityPort["acquire"]>((_input) => ({
        ...(_input && {}),
        status: "denied" as const,
        replay: false,
        decision: { kind: "denied" as const, rejected: [] },
        evidence: {
          evidenceVersion: 1,
          policy: {
            policyId: "dispatch-policy",
            policyRevision: "dispatch-policy-revision",
            policyDigest: `sha256:${"d".repeat(64)}`,
          },
          decision: { kind: "denied" as const, rejected: [] },
          authorityRejections: [],
        },
      })),
      releasePreFence: vi.fn(),
      fenceDispatch: vi.fn(),
      readDispatch: vi.fn(() => undefined),
      settleExecution: vi.fn(),
      recordExecutionSettlementPending: vi.fn(),
    };
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter,
    });

    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
      lifecycleEvents: lifecycleEvents.port,
    });

    expect(prepared).toMatchObject({ status: "denied" });
    expect(lifecycleEvents.transitions).toEqual(["denied"]);
    expect(economicAuthority.fenceDispatch).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("projects the authority decision's staged denial evidence without account internals", async () => {
    const records: Array<Record<string, unknown>> = [];
    const createAdapter = vi.fn();
    const economicAuthority: ManagedEconomicDispatchAuthorityPort = {
      acquire: vi.fn(() => ({
        status: "denied",
        replay: false,
        decision: {
          kind: "denied",
          rejected: [{
            stage: "economic-selection",
            reason: "ceiling-exceeded",
            alternativeIdentity: {
              route: { routeId: "route-codex" },
              account: {
                kind: "account-bound",
                capacityIdentity: "secret-capacity",
                accountRef: "secret-account-ref",
                credentialRevision: "secret-credential-revision",
              },
            },
          }],
        },
        evidence: {
          decision: {
            kind: "denied",
            rejected: [{
              stage: "economic-selection",
              reason: "ceiling-exceeded",
              alternativeIdentity: {
                route: { routeId: "route-codex" },
                account: {
                  kind: "account-bound",
                  capacityIdentity: "secret-capacity",
                  accountRef: "secret-account-ref",
                  credentialRevision: "secret-credential-revision",
                },
              },
            }],
          },
          authorityRejections: [
            {
              stage: "account-selection",
              routeId: "route-opencode",
              rejections: [
                { account: "secret-account-a", reason: "lease-conflict" },
                { account: "secret-account-b", reason: "lease-conflict" },
                { account: "secret-account-c", reason: "unhealthy" },
              ],
            },
            {
              stage: "local-capacity",
              routeId: "route-opencode",
              reason: "route-capacity-exhausted",
            },
          ],
        },
      } as never)),
      releasePreFence: vi.fn(),
      fenceDispatch: vi.fn(),
      readDispatch: vi.fn(() => undefined),
      settleExecution: vi.fn(),
      recordExecutionSettlementPending: vi.fn(),
    };
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter,
    });

    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
      lifecycleEvents: {
        record: (input) => records.push(input as unknown as Record<string, unknown>),
      },
    });

    expect(prepared).toMatchObject({ status: "denied" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      transition: "denied",
      rejections: [
        { stage: "economic-selection", routeId: "route-codex", reason: "ceiling-exceeded" },
        { stage: "account-selection", routeId: "route-opencode", reason: "lease-conflict", count: 2 },
        { stage: "account-selection", routeId: "route-opencode", reason: "unhealthy", count: 1 },
        { stage: "local-capacity", routeId: "route-opencode", reason: "route-capacity-exhausted" },
      ],
    });
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain("secret-account");
    expect(serialized).not.toContain("secret-capacity");
    expect(serialized).not.toContain("secret-credential");
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("aborts bounded adapter materialization and releases the unfenced commitment", async () => {
    const economicAuthority = authority();
    const controller = new AbortController();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => await new Promise(() => undefined),
    });

    const preparation = coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
      abortSignal: controller.signal,
    });
    controller.abort(new Error("synthetic lifecycle deadline"));

    await expect(preparation).rejects.toThrow("synthetic lifecycle deadline");
    expect(economicAuthority.fenceDispatch).not.toHaveBeenCalled();
    expect(economicAuthority.recordExecutionSettlementPending).not.toHaveBeenCalled();
    expect(economicAuthority.releasePreFence).toHaveBeenCalledOnce();
  });

  it("expires an unused fenced commitment as settlement-pending", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 5,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });

    const preparation = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    });
    if (preparation.status !== "prepared") throw new Error("fixture");

    await vi.waitFor(() => expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      preparation.dispatchFenceId,
      "registered-execution-settlement-missing",
    ));
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
    expect(economicAuthority.fenceDispatch).toHaveBeenCalledOnce();
  });

  it("marks its own lifecycle deadline with a typed timeout reason", async () => {
    const economicAuthority = authority();
    let observedSignal: AbortSignal | undefined;
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1,
      createAdapter: async ({ abortSignal }) => {
        observedSignal = abortSignal;
        return { descriptor: {} } as never;
      },
    });

    const preparation = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    });
    if (preparation.status !== "prepared") throw new Error("fixture");

    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    expect(observedSignal?.reason).toBeInstanceOf(ManagedEconomicLifecycleTimeoutError);
    expect((observedSignal?.reason as ManagedEconomicLifecycleTimeoutError).timeoutMs).toBe(1);
    expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      preparation.dispatchFenceId,
      "registered-execution-settlement-missing",
    );
  });

  it("expires a registered settlement that does not resolve", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 5,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });
    const preparation = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    });
    if (preparation.status !== "prepared") throw new Error("fixture");
    preparation.registerEconomicSettlement(new Promise<ManagedEconomicSettlement>(() => undefined));

    await vi.waitFor(() => expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      preparation.dispatchFenceId,
      "registered-execution-settlement-timed-out",
    ));
    expect(economicAuthority.settleExecution).not.toHaveBeenCalled();
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
  });

  it("keeps capacity pending when a typed settlement reports unknown outcome", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });
    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    });
    if (prepared.status !== "prepared") throw new Error("fixture");
    const unknown: ManagedEconomicSettlement = {
      kind: "unknown",
      reservationId: prepared.commitment.reservation.reservationId,
      dispatchFenceId: prepared.dispatchFenceId,
      actualIdentity: prepared.commitment.reservation.selectedIdentity,
      reason: "provider-charge-unavailable",
      evidence: null,
    };
    prepared.registerEconomicSettlement(Promise.resolve(unknown));

    await vi.waitFor(() => expect(economicAuthority.settleExecution).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      prepared.dispatchFenceId,
      unknown,
    ));
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
  });

  it("keeps capacity when a registered provider settlement rejects", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });
    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    });
    if (prepared.status !== "prepared") throw new Error("fixture");
    prepared.registerEconomicSettlement(Promise.reject(new Error("provider outcome unknown")));

    await vi.waitFor(() => expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledOnce());
    expect(economicAuthority.settleExecution).not.toHaveBeenCalled();
  });

  it("does not expose pre-fence compensation after preparation", async () => {
    const economicAuthority = authority();
    const prepared = await new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    }).prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      admissionBundle: admissionBundle(),
      effectIdentity: "managed-economic-dispatch:test",
      adoption: dispatchAdoption(),
      access: "read-only",
      authorityProfileId: AUTHORITY_PROFILE_ID,
      invocationId: INVOCATION_ID,
    });

    expect(prepared).toMatchObject({ status: "prepared" });
    expect(prepared).not.toHaveProperty("releaseBeforeProviderEffect");
    expect(prepared).not.toHaveProperty("beforeProviderEffect");
    expect(economicAuthority.fenceDispatch).toHaveBeenCalledOnce();
  });

  it("selects OpenCode without constructing or charging a ceiling-rejected Codex route", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-no-spend-"));
    const authority = new SqliteManagedAccountLeaseAuthority({
      path: join(root, "authority.sqlite"),
      ownerId: "no-spend-proof-owner",
      now: () => Date.parse("2026-08-02T12:00:00.000Z"),
    });
    try {
      const adoption = accountlessCompetingRoutes();
      const jobId = "job-no-spend-proof";
      const economicAttemptId = "economic-attempt-no-spend-proof";
      const session = new RuntimeSession({
        appName: "managed-economic-no-spend-proof",
        tenantId: "synthetic-tenant",
        userId: "synthetic-user",
        systemPrompt: "Synthetic no-spend proof.",
        sessionId: "session-no-spend-proof",
      });
      const order: string[] = [];
      const materializeCodexCredential = vi.fn();
      const reserveCodexQuota = vi.fn();
      const createCodexMcpConnection = vi.fn();
      const spawnCodexProcess = vi.fn();
      const invokeCodexProvider = vi.fn();
      const constructCodexAdapter = vi.fn(async () => {
        materializeCodexCredential();
        reserveCodexQuota();
        createCodexMcpConnection();
        spawnCodexProcess();
        invokeCodexProvider();
        throw new Error("The rejected Codex route must never be constructed.");
      });
      const materializeOpenCodeCredential = vi.fn();
      const invokeOpenCodeProvider = vi.fn();
      const constructOpenCodeAdapter = vi.fn(async (commitment: ManagedEconomicCommitment) => {
        materializeOpenCodeCredential();
        return new ManagedDirectProviderRuntimeAdapter({
          providerId: "opencode-go",
          model: "open-model",
          provider: {
            name: "synthetic-opencode-provider",
            createMessage: async () => {
              invokeOpenCodeProvider();
              throw new Error("This proof does not invoke providers.");
            },
            streamMessage: async function* () {
              invokeOpenCodeProvider();
              throw new Error("This proof does not invoke providers.");
            },
          },
          tools: [],
          builtinTools: new Map(),
          economicIdentity: commitment.reservation.selectedIdentity,
          runtimeToolActionClaims: createFixtureToolActionStore(),
          readAuthorityAdmission: () => admissionBundle(),
          runtimeModelRoundActionClaims: createFixtureModelRoundStore(),
        });
      });
      const fenceDispatch = vi.fn((fenceJobId: string, fenceAttemptId: string, fenceId: string, actionClaim: ManagedEconomicActionClaim) => {
        order.push("fence");
        return authority.fenceDispatch(fenceJobId, fenceAttemptId, fenceId, actionClaim);
      });
      const createAdapter = vi.fn(async ({ commitment }: { readonly commitment: ManagedEconomicCommitment }) => {
        order.push(`adapter:${commitment.reservation.selectedIdentity.route.providerId}`);
        if (commitment.reservation.selectedIdentity.route.providerId === "codex-oauth") {
          return constructCodexAdapter();
        }
        return constructOpenCodeAdapter(commitment);
      });
      const coordinator = new ManagedEconomicDispatchCoordinator({
        authority: {
          acquire: (request) => authority.acquireCommitment(request),
          releasePreFence: (releaseJobId, releaseAttemptId) => authority.releaseCommitmentPreFence(releaseJobId, releaseAttemptId),
          fenceDispatch,
          readDispatch: (readJobId, readAttemptId, readFenceId, actionClaim) =>
            authority.readDispatch(readJobId, readAttemptId, readFenceId, actionClaim),
          settleExecution: (settleJobId, settleAttemptId, fenceId, settlement) =>
            authority.settleExecution(settleJobId, settleAttemptId, fenceId, settlement),
          recordExecutionSettlementPending: (pendingJobId, pendingAttemptId, fenceId, reason) =>
            authority.recordExecutionSettlementPending(pendingJobId, pendingAttemptId, fenceId, reason),
        },
        resolveLifecycleTimeoutMs: () => 5_000,
        createAdapter,
      });

      const prepared = await coordinator.prepare({
        jobId,
        economicAttemptId,
        intentFingerprint: digestManagedEconomicValue({ proof: "no-spend" }),
        admissionBundle: admissionBundle(),
        effectIdentity: "managed-economic-dispatch:test",
        adoption,
        access: "read-only",
        authorityProfileId: AUTHORITY_PROFILE_ID,
        invocationId: `managed-invocation:${jobId}`,
        lifecycleEvents: {
          record: (input) => appendManagedEconomicLifecycleSessionEvent({
            session,
            workspaceRoot: root,
            jobId,
            economicAttemptId,
            ...input,
          }),
        },
      });

      if (prepared.status !== "prepared") throw new Error("Expected the eligible OpenCode route to be prepared.");
      expect(prepared.commitment.reservation.selectedIdentity.route).toMatchObject({
        routeId: "route-opencode", providerId: "opencode-go",
      });
      expect(prepared.commitment.rejected).toContainEqual(expect.objectContaining({
        stage: "economic-selection", reason: "ceiling-exceeded",
        alternativeIdentity: expect.objectContaining({ route: expect.objectContaining({ routeId: "route-codex" }) }),
      }));
      expect(order).toEqual(["adapter:opencode-go", "fence"]);
      expect(fenceDispatch).toHaveBeenCalledOnce();
      expect(createAdapter).toHaveBeenCalledOnce();
      expect(constructOpenCodeAdapter).toHaveBeenCalledOnce();
      expect(materializeOpenCodeCredential).toHaveBeenCalledOnce();
      expect(constructCodexAdapter).not.toHaveBeenCalled();
      expect(materializeCodexCredential).not.toHaveBeenCalled();
      expect(reserveCodexQuota).not.toHaveBeenCalled();
      expect(createCodexMcpConnection).not.toHaveBeenCalled();
      expect(spawnCodexProcess).not.toHaveBeenCalled();
      expect(invokeCodexProvider).not.toHaveBeenCalled();
      expect(invokeOpenCodeProvider).not.toHaveBeenCalled();

      const settlement = prepared.createExecutionSettlement({
        actualIdentity: prepared.commitment.reservation.selectedIdentity,
        usage: { kind: "complete", units: [{ atoms: "20", scale: 0, unit: "input-token", scheme: { kind: "unit" } }] },
        evidence: {
          sourceIdentity: "synthetic-opencode-usage",
          sourceRevision: "revision-1",
          sourceDigest: digestManagedEconomicValue({ proof: "opencode-settlement" }),
          observedAt: "2026-08-02T12:00:00.000Z",
          validUntil: "2026-08-02T12:05:00.000Z",
          confidence: "high",
          authority: "configured",
        },
      });
      prepared.registerEconomicSettlement(Promise.resolve(settlement));
      await vi.waitFor(() => expect(authority.createAgentTaskReplayInspectionPort().inspect({ jobId, economicAttemptId }))
        .toMatchObject({ evidenceVersion: 1, status: "released", selectedRoute: { routeId: "route-opencode" } }));
      expect(session.sessionEvents.map((event) => event.kind)).toEqual([
        "managed_economic_lifecycle", "managed_economic_lifecycle", "managed_economic_lifecycle",
      ]);
      for (const event of session.sessionEvents) {
        expect(event).toMatchObject({ evidenceVersion: 1 });
      }
      expect(session.sessionEvents.at(0)).toMatchObject({ transition: "held" });
      expect(session.sessionEvents.at(1)).toMatchObject({ transition: "dispatch-fenced" });
      expect(session.sessionEvents.at(2)).toMatchObject({ transition: "released" });
    } finally {
      authority.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps capacity consumed by an earlier accountless commitment as a local-capacity rejection", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-capacity-proof-"));
    const authority = new SqliteManagedAccountLeaseAuthority({
      path: join(root, "authority.sqlite"),
      ownerId: "capacity-proof-owner",
      now: () => Date.parse("2026-08-02T12:00:00.000Z"),
    });
    try {
      const adoption = accountlessCodexRouteAtCeiling();
      const request = {
        intentFingerprint: digestManagedEconomicValue({ proof: "capacity" }),
        ...adoption,
      };
      expect(authority.acquireCommitment({
        ...request,
        jobId: "job-capacity-first",
        economicAttemptId: "economic-attempt-capacity-first",
      })).toMatchObject({ status: "committed", record: { state: "held" } });
      const denied = authority.acquireCommitment({
        ...request,
        jobId: "job-capacity-second",
        economicAttemptId: "economic-attempt-capacity-second",
      });
      if (denied.status !== "denied") throw new Error("Expected the consumed route capacity to deny a second commitment.");
      expect(denied.decision.rejected).toEqual([]);
      expect(denied.evidence.authorityRejections).toEqual([{
        stage: "local-capacity", routeId: "route-codex", reason: "route-capacity-exhausted",
      }]);
    } finally {
      authority.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  function settlement(dispatchFenceId: string): ManagedEconomicSettlement {
    return {
      kind: "subscription",
      reservationId: "reservation-a",
      dispatchFenceId,
      actualIdentity: commitment().reservation.selectedIdentity,
      units: [{ atoms: "12", scale: 0, unit: "input-token", scheme: { kind: "unit" } }],
      evidence: {
        sourceIdentity: "provider-usage",
        sourceRevision: "usage-1",
        sourceDigest: `sha256:${"d".repeat(64)}`,
        observedAt: "2026-08-01T00:00:00.000Z",
        validUntil: "2026-08-01T01:00:00.000Z",
        confidence: "high",
        authority: "provider-reported",
      },
    };
  }
});

function accountlessCompetingRoutes(codexCeilingAtoms = "0"): ManagedEconomicDispatchAdoption {
  const codex = createEconomicRouteProofAdoption({
    providerId: "codex-oauth",
    routeId: "route-codex",
    modelId: "codex-model",
    priceKind: "metered",
    quotaEvidence: unknownQuotaEvidence("route-codex"),
    quotaRequirement: "optional",
  });
  const openCode = createEconomicRouteProofAdoption({
    providerId: "opencode-go",
    routeId: "route-opencode",
    modelId: "open-model",
    priceKind: "metered",
    quotaEvidence: unknownQuotaEvidence("route-opencode"),
    quotaRequirement: "optional",
  });
  const comparisonDomain = codex.snapshot.routes[0]!.comparisonDomain;
  const accountless = (candidate: typeof codex.snapshot.routes[number]) => ({
    ...candidate,
    admittedIdentity: { ...candidate.admittedIdentity, accountPolicy: { kind: "accountless" as const } },
    route: { ...candidate.route, accountPolicyId: null },
    comparisonDomain,
  });
  const routes = [
    {
      ...accountless(codex.snapshot.routes[0]!),
      ceiling: {
        kind: "finite" as const,
        amount: { atoms: codexCeilingAtoms, scale: 2, unit: "currency", scheme: { kind: "currency" as const, currency: "USD" } },
      },
    },
    accountless(openCode.snapshot.routes[0]!),
  ];
  const snapshot = adoptManagedEconomicSnapshot({
    policy: { ...codex.snapshot.policy, comparisonDomains: [comparisonDomain] },
    adoptedAt: codex.snapshot.adoptedAt,
    adoptedDecisionAt: codex.snapshot.adoptedDecisionAt,
    callerConstraints: {},
    routes,
  });
  return {
    snapshot,
    expectation: {
      policyId: snapshot.policy.policyId,
      policyRevision: snapshot.policy.policyRevision,
      candidateSetDigest: snapshot.candidateSetDigest,
      admittedCandidates: snapshot.routes.map((route) => route.admittedIdentity),
      callerConstraints: snapshot.callerConstraints,
    },
    routeCapacity: snapshot.routes.map(({ route }) => ({ routeId: route.routeId })),
  };
}

function accountlessCodexRouteAtCeiling(): ManagedEconomicDispatchAdoption {
  const competing = accountlessCompetingRoutes("100");
  const route = competing.snapshot.routes.find((candidate) => candidate.route.routeId === "route-codex");
  if (route === undefined) throw new Error("Synthetic Codex route is required.");
  const snapshot = adoptManagedEconomicSnapshot({
    policy: competing.snapshot.policy,
    adoptedAt: competing.snapshot.adoptedAt,
    adoptedDecisionAt: competing.snapshot.adoptedDecisionAt,
    callerConstraints: competing.snapshot.callerConstraints,
    routes: [route],
  });
  return {
    snapshot,
    expectation: {
      policyId: snapshot.policy.policyId,
      policyRevision: snapshot.policy.policyRevision,
      candidateSetDigest: snapshot.candidateSetDigest,
      admittedCandidates: snapshot.routes.map((candidate) => candidate.admittedIdentity),
      callerConstraints: snapshot.callerConstraints,
    },
    routeCapacity: [{ routeId: "route-codex" }],
  };
}
