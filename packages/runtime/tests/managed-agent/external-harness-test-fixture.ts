import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core";
import {
  createManagedExternalInvocationPermit,
  type ManagedExternalInvocationActionClaim,
  type ManagedExternalInvocationActionClaimContext,
  type ManagedExternalInvocationClaimSettlement,
} from "../../src/agents/managed-invocation/external-invocation-action-claim.js";
import {
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeInvocationLifecycleOptions,
} from "../../src/agents/managed-invocation/invocation-service.js";
import type { RuntimeManagedAgentInvocationServiceOptions } from "../../src/agents/managed-invocation/invocation-service.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";

const READ_AUTHORITY: AuthorityDescriptor = {
  level: 1,
  allowed: true,
  requiresApproval: false,
  reason: "managed harness test",
};

const READ_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};

/** The complete persisted parent-turn bundle shared by the CLI harness cases. */
export function externalHarnessTestAdmission(): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-parent",
    turnId: "session-parent:turn:1",
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "managed-harness-test-session", revisions: { routes: "r1" } },
      turnRevision: { revisionSetId: "managed-harness-test-turn", revisions: { routes: "r1" } },
    },
    session: {
      skillCatalog: { catalogId: "managed-harness-test", revision: "s1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "audited", reason: "managed harness test" },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "audited",
        admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection",
        reason: "managed harness test",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{
          toolName: "managed_agent.invoke",
          authority: READ_AUTHORITY,
          effectEnvelope: READ_EFFECT,
        }],
        deniedToolNames: [],
      },
      effectCeiling: READ_EFFECT,
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

/**
 * Strict in-memory stand-in for the durable owner. It verifies permit use and
 * rejects duplicate immutable effect identities so tests cannot hide a retry.
 */
export class ExternalHarnessTestClaimStore {
  readonly claims: ManagedExternalInvocationActionClaim[] = [];
  readonly settlements: ManagedExternalInvocationClaimSettlement[] = [];
  private readonly permits = new WeakMap<object, { readonly claimId: string; consumed: boolean; settled: boolean }>();
  private readonly slots = new Set<string>();
  private closed = false;

  claim(input: ManagedExternalInvocationActionClaim) {
    if (this.closed) throw new Error("External harness test claim store is closed.");
    const slot = `${input.admissionId}\u0000${input.attemptId}\u0000${input.round}\u0000${input.effectKind}`;
    if (this.slots.has(slot)) {
      throw new Error("External harness test action claim already exists; no redispatch.");
    }
    this.slots.add(slot);
    this.claims.push(input);
    const state = { claimId: input.claimId, consumed: false, settled: false };
    const issuedPermit = createManagedExternalInvocationPermit(input.claimId, `managed-harness-test:${this.claims.length}`);
    const permit = {
      ...issuedPermit,
      consume: () => {
        issuedPermit.consume();
        state.consumed = true;
      },
    } as typeof issuedPermit;
    this.permits.set(permit, state);
    return permit;
  }

  settle(
    permit: ReturnType<typeof createManagedExternalInvocationPermit>,
    settlement: ManagedExternalInvocationClaimSettlement,
  ): void {
    const state = this.permits.get(permit);
    if (!state || state.claimId !== permit.claimId || !state.consumed || state.settled) {
      throw new Error("External harness test settlement requires one consumed, unsettled permit.");
    }
    state.settled = true;
    this.settlements.push(settlement);
  }

  close(): void {
    this.closed = true;
  }
}

export function externalHarnessTestClaimContext(
  admission: EffectiveAuthorityAdmissionBundle,
  store: ExternalHarnessTestClaimStore,
): ManagedExternalInvocationActionClaimContext {
  return {
    ownerGeneration: "managed-harness-test-owner",
    store,
    readAdmission: async ({ admissionId, sessionId, turnId }) =>
      admission.admissionId === admissionId
        && admission.sessionId === sessionId
        && admission.turnId === turnId
        ? admission
        : undefined,
  };
}

/**
 * Test composition for an external CLI harness. Every invocation receives the
 * exact persisted child bundle and the same composition-owned claim context.
 */
export class ExternalHarnessTestService {
  readonly authorityAdmission: { readonly bundle: EffectiveAuthorityAdmissionBundle };
  readonly claims: ExternalHarnessTestClaimStore;

  constructor(private readonly service: RuntimeManagedAgentInvocationService, admission: EffectiveAuthorityAdmissionBundle, claims: ExternalHarnessTestClaimStore) {
    this.authorityAdmission = { bundle: admission };
    this.claims = claims;
  }

  invoke(
    request: Parameters<RuntimeManagedAgentInvocationService["invoke"]>[0],
    adapter: Parameters<RuntimeManagedAgentInvocationService["invoke"]>[1],
    capabilitySnapshotInput: Parameters<RuntimeManagedAgentInvocationService["invoke"]>[2],
    lifecycleOptions: ManagedAgentRuntimeInvocationLifecycleOptions = {},
  ): ReturnType<RuntimeManagedAgentInvocationService["invoke"]> {
    return this.service.invoke(request, adapter, capabilitySnapshotInput, {
      ...lifecycleOptions,
      childAuthorityAdmission: this.authorityAdmission,
    });
  }

  start(
    request: Parameters<RuntimeManagedAgentInvocationService["start"]>[0],
    adapter: Parameters<RuntimeManagedAgentInvocationService["start"]>[1],
    capabilitySnapshotInput: Parameters<RuntimeManagedAgentInvocationService["start"]>[2],
    lifecycleOptions: ManagedAgentRuntimeInvocationLifecycleOptions = {},
  ): ReturnType<RuntimeManagedAgentInvocationService["start"]> {
    return this.service.start(request, adapter, capabilitySnapshotInput, {
      ...lifecycleOptions,
      childAuthorityAdmission: this.authorityAdmission,
    });
  }

  cancel(
    ...input: Parameters<RuntimeManagedAgentInvocationService["cancel"]>
  ): ReturnType<RuntimeManagedAgentInvocationService["cancel"]> {
    return this.service.cancel(...input);
  }

  join(
    ...input: Parameters<RuntimeManagedAgentInvocationService["join"]>
  ): ReturnType<RuntimeManagedAgentInvocationService["join"]> {
    return this.service.join(...input);
  }

  status(invocationId: string): ReturnType<RuntimeManagedAgentInvocationService["status"]> {
    return this.service.status(invocationId);
  }
}

export function createExternalHarnessTestService(
  options: Omit<RuntimeManagedAgentInvocationServiceOptions, "externalActionClaim"> = {},
): ExternalHarnessTestService {
  const admission = externalHarnessTestAdmission();
  const claims = new ExternalHarnessTestClaimStore();
  const service = new RuntimeManagedAgentInvocationService({
    ...options,
    externalActionClaim: externalHarnessTestClaimContext(admission, claims),
  });
  return new ExternalHarnessTestService(service, admission, claims);
}
