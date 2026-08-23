import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptManagedEconomicSnapshot,
  createExecutionAccountRef,
  digestManagedEconomicValue,
  type CanonicalSessionEvent,
  type ManagedEconomicAmount,
  type ManagedEconomicClass,
  type ManagedEconomicEvidenceIdentity,
  type ManagedEconomicPriceEvidence,
  type ManagedEconomicQuotaEvidence,
} from "@kilnai/core";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import {
  ManagedEconomicDispatchCoordinator,
  type ManagedEconomicLifecycleEventPort,
} from "../../src/agents/managed-invocation/economic-dispatch-coordinator.js";
import { appendManagedEconomicLifecycleSessionEvent } from "../../src/agents/managed-invocation/session-events.js";
import { toOperatorSessionEventFrame } from "../../src/gateway/operator-session-event-frame.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import { deserializeSession, serializeSession } from "../../src/session/persistence/session-serializer.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { managedEconomicAdmissionBundle } from "./managed-economic-admission-fixture.js";

const DECISION_AT = "2026-08-02T12:00:00.000Z";

export interface EconomicRouteProofInput {
  readonly providerId: "codex-oauth" | "opencode-go" | "opencode-zen";
  readonly routeId: string;
  readonly modelId: string;
  readonly priceKind: "metered" | "subscription";
  readonly quotaEvidence: ManagedEconomicQuotaEvidence;
  readonly quotaRequirement: "optional" | "required-for-account-bound";
}

export async function proveEconomicRouteLifecycle(input: EconomicRouteProofInput) {
  const root = mkdtempSync(join(tmpdir(), `kiln-${input.providerId}-economic-proof-`));
  const authority = new SqliteManagedAccountLeaseAuthority({
    path: join(root, "authority.sqlite"),
    ownerId: `owner-${input.providerId}`,
    now: () => Date.parse(DECISION_AT),
  });
  try {
    const adoption = createEconomicRouteProofAdoption(input);
    const session = new RuntimeSession({
      appName: "economic-route-proof",
      tenantId: "proof-tenant",
      userId: "proof-user",
      systemPrompt: "economic route lifecycle proof",
      sessionId: `economic-route-proof-${input.providerId}`,
    });
    const jobId = `job-${input.providerId}`;
    const economicAttemptId = `economic-attempt-${input.providerId}`;
    const admissionBundle = managedEconomicAdmissionBundle({
      sessionId: session.id,
      turnId: `economic-route-proof-turn-${input.providerId}`,
    });
    const lifecycleEvents: ManagedEconomicLifecycleEventPort = {
      record: (recordInput) => {
        appendManagedEconomicLifecycleSessionEvent({
          session,
          workspaceRoot: root,
          jobId,
          economicAttemptId,
          ...recordInput,
        });
      },
    };
    let record: ReturnType<typeof authority.settleExecution> | undefined;
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: {
        acquire: (request) => authority.acquireCommitment(request),
        releasePreFence: (jobId2, economicAttemptId2) =>
          authority.releaseCommitmentPreFence(jobId2, economicAttemptId2),
        fenceDispatch: (jobId2, economicAttemptId2, dispatchFenceId, actionClaim) =>
          authority.fenceDispatch(jobId2, economicAttemptId2, dispatchFenceId, actionClaim),
        settleExecution: (jobId2, economicAttemptId2, dispatchFenceId, settlement) => {
          record = authority.settleExecution(jobId2, economicAttemptId2, dispatchFenceId, settlement);
          return record;
        },
        recordExecutionSettlementPending: (jobId2, economicAttemptId2, dispatchFenceId, reason) =>
          authority.recordExecutionSettlementPending(jobId2, economicAttemptId2, dispatchFenceId, reason),
      },
      resolveLifecycleTimeoutMs: () => 5_000,
      createAdapter: async ({ commitment }) => {
        return new ManagedDirectProviderRuntimeAdapter({
          providerId: input.providerId,
          model: input.modelId,
          provider: unusedProvider(input.providerId),
          tools: [],
          builtinTools: new Map(),
          economicIdentity: commitment.reservation.selectedIdentity,
          now: () => new Date(DECISION_AT),
        });
      },
    });
    const prepared = await coordinator.prepare({
      jobId,
      economicAttemptId,
      intentFingerprint: digestManagedEconomicValue(input),
      admissionBundle,
      effectIdentity: "managed-economic-proof:provider-dispatch",
      adoption,
      admissionProfile: "foundation-readonly-plan",
      lifecycleEvents,
    });
    if (prepared.status !== "prepared") {
      throw new Error(`Expected ${input.providerId} economic route to be prepared.`);
    }
    const settlement = prepared.createExecutionSettlement({
      actualIdentity: prepared.commitment.reservation.selectedIdentity,
      usage: {
        kind: "complete",
        units: [{ atoms: "20", scale: 0, unit: "input-token", scheme: { kind: "unit" } }],
      },
      evidence: executionEvidence(input.providerId),
    });
    prepared.registerEconomicSettlement(Promise.resolve(settlement));
    await waitForSettlement();
    if (record === undefined) throw new Error("Expected durable economic commitment record.");
    const replayedSession = deserializeSession(serializeSession(session));
    const replayedEvents: readonly CanonicalSessionEvent[] = replayedSession.sessionEvents;
    const frames: readonly Extract<GuiInboundFrame, { type: "session_event" }>[] = replayedEvents.map(
      (event, index) => toOperatorSessionEventFrame(event, { eventId: event.eventId, sequence: index + 1 }),
    );
    return { session, replayedEvents, frames, record, settlement };
  } finally {
    authority.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** Builds completed, synthetic adoption evidence for focused economic-route tests. */
export function createEconomicRouteProofAdoption(input: EconomicRouteProofInput) {
  const evidence = configuredEvidence(input.providerId);
  const scheme = { kind: "currency" as const, currency: "USD" };
  const unitRates = input.priceKind === "metered"
    ? [{ usageUnit: "input-token", price: { atoms: "1", scale: 2, unit: "input-token", scheme } }]
    : [];
  const auxiliaryCharges: never[] = [];
  const unitScheduleDigest = digestManagedEconomicValue(unitRates);
  const auxiliaryScheduleDigest = digestManagedEconomicValue(auxiliaryCharges);
  const priceIdentity = {
    providerId: input.providerId,
    modelId: input.modelId,
    authBillingChannel: "direct",
    executionMode: "standard",
    serviceTier: "default",
    rateCardId: `${input.providerId}-rate-card`,
    rateCardRevision: "2026-08-02",
    unit: "currency",
    scheme,
    unitScheduleDigest,
    contextClass: "standard",
    cacheClass: "default",
    auxiliaryScheduleDigest,
    evidence,
  };
  const priceEvidence: ManagedEconomicPriceEvidence = input.priceKind === "metered"
    ? { kind: "metered", identity: priceIdentity }
    : { kind: "subscription", identity: priceIdentity };
  const comparisonDomain = {
    id: `${input.providerId}-usd`,
    rank: 0,
    basis: {
      unit: "currency",
      scheme,
      rateCardBasis: `${priceIdentity.rateCardId}:${priceIdentity.rateCardRevision}`,
      envelopeSemantics: "worst-case-v1",
    },
  };
  const envelope = {
    kind: "bounded" as const,
    digest: digestManagedEconomicValue({ providerId: input.providerId, maxInputTokens: 100 }),
    limits: [{ atoms: "100", scale: 0, unit: "input-token", scheme: { kind: "unit" as const } }],
  };
  const route = {
    routeId: input.routeId,
    providerId: input.providerId,
    modelId: input.modelId,
    adapterCapabilityId: "direct-provider",
    adapterCapabilityVersion: "1",
    authBillingChannel: "direct",
    executionMode: "standard",
    serviceTier: "default",
    accountPolicyId: `${input.providerId}-accounts`,
    fallbackPosture: "disabled" as const,
    overagePosture: "disabled" as const,
    rateCardId: priceIdentity.rateCardId,
    rateCardRevision: priceIdentity.rateCardRevision,
    priceEvidenceDigest: evidence.sourceDigest,
    unit: "currency",
    scheme,
    contextClass: "standard",
    cacheClass: "default",
    auxiliaryScheduleDigest,
    envelopeDigest: envelope.digest,
  };
  const snapshot = adoptManagedEconomicSnapshot({
    policy: {
      policyId: `${input.providerId}-policy`,
      schemaVersion: 1,
      policyRevision: "revision-1",
      policyDigest: digestManagedEconomicValue({ providerId: input.providerId, policy: 1 }),
      comparisonDomains: [comparisonDomain],
      noRouteAction: "deny",
      evidenceRequirements: {
        quota: input.quotaRequirement,
        price: "required",
      },
    },
    adoptedAt: DECISION_AT,
    adoptedDecisionAt: DECISION_AT,
    callerConstraints: { providerIds: [input.providerId], modelIds: [input.modelId] },
    routes: [{
      admittedIdentity: {
        routeId: input.routeId,
        sourceIdentity: "managed-route-config",
        providerId: input.providerId,
        modelId: input.modelId,
        adapterCapabilityId: "direct-provider",
        adapterCapabilityVersion: "1",
        accountPolicy: { kind: "account-bound", accountPolicyId: `${input.providerId}-accounts` },
        profileAuthorityDigest: `sha256:${"9".repeat(64)}`,
      },
      route,
      comparisonDomain,
      priorityRank: 0,
      priceEvidence,
      rateSchedule: { unitRates, auxiliaryCharges },
      executionEnvelope: envelope,
      worstCaseReservation: input.priceKind === "metered"
        ? { kind: "exact", amount: currencyAmount("100") }
        : { kind: "not-comparable", reason: "subscription-basis" },
      ceiling: input.priceKind === "metered"
        ? { kind: "finite", amount: currencyAmount("100") }
        : { kind: "none" },
    }],
  });
  const accountRoute = {
    providerId: input.providerId,
    providerModelId: input.modelId,
    scope: `economic:${input.routeId}`,
  };
  return {
    snapshot,
    expectation: {
      policyId: snapshot.policy.policyId,
      policyRevision: snapshot.policy.policyRevision,
      candidateSetDigest: snapshot.candidateSetDigest,
      admittedCandidates: snapshot.routes.map(({ admittedIdentity }) => admittedIdentity),
      callerConstraints: snapshot.callerConstraints,
    },
    routeCapacity: [{
      routeId: input.routeId,
      route: accountRoute,
      candidates: [{
        candidate: {
          account: createExecutionAccountRef(`configured:${input.providerId}-account`),
          route: accountRoute,
          health: "healthy" as const,
          leaseCapacity: "available" as const,
          pressure: 0,
          reservedForNewWork: false,
        },
        capacityIdentity: `${input.providerId}-capacity`,
        credentialRevisionId: digestManagedEconomicValue({ providerId: input.providerId, credential: 1 }).slice("sha256:".length),
        usageEvidence: { health: "healthy" as const, freshness: "missing" as const },
        accountEconomics: {
          capacityIdentity: `${input.providerId}-capacity`,
          subscriptionClass: subscriptionClass(input),
          quotaClassId: `${input.providerId}-quota`,
          creditPosture: "disabled" as const,
          overagePosture: "disabled" as const,
        },
        quotaEvidence: input.quotaEvidence,
        capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 },
      }],
    }],
  };
}

function subscriptionClass(input: EconomicRouteProofInput): Exclude<ManagedEconomicClass, "estimated"> {
  return input.priceKind === "subscription" ? "subscription" : "metered";
}

function currencyAmount(atoms: string): ManagedEconomicAmount {
  return { atoms, scale: 2, unit: "currency", scheme: { kind: "currency", currency: "USD" } };
}

function configuredEvidence(providerId: string): ManagedEconomicEvidenceIdentity {
  return {
    sourceIdentity: `${providerId}-configured-economics`,
    sourceRevision: "revision-1",
    sourceDigest: digestManagedEconomicValue({ providerId, evidence: 1 }),
    observedAt: DECISION_AT,
    validUntil: "2026-08-02T13:00:00.000Z",
    confidence: "high",
    authority: "configured",
  };
}

function executionEvidence(providerId: string): ManagedEconomicEvidenceIdentity {
  return {
    sourceIdentity: `${providerId}-direct-runtime-usage`,
    sourceRevision: "revision-1",
    sourceDigest: digestManagedEconomicValue({ providerId, usage: 20 }),
    observedAt: DECISION_AT,
    validUntil: "2026-08-02T12:05:00.000Z",
    confidence: "medium",
    authority: "calculated-estimate",
  };
}

function unusedProvider(providerId: string) {
  return {
    name: providerId,
    createMessage: async (): Promise<never> => {
      throw new Error("Economic proof fixture must not call a provider.");
    },
    streamMessage: async function* (): AsyncGenerator<never> {
      throw new Error("Economic proof fixture must not call a provider.");
    },
  };
}

async function waitForSettlement(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
