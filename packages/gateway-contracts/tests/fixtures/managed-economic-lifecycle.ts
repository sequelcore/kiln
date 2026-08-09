import type { OperatorSessionEvent } from "../../src/frames.js";

/** Portable authority evidence shared by every active operator surface. */
export const MANAGED_ECONOMIC_LIFECYCLE_FIXTURE = {
  instanceId: "economic-lifecycle:instance:1",
  sessionId: "economic-lifecycle:session:1",
  jobId: "managed-economic-job:lifecycle-fixture",
  economicAttemptId: "economic-attempt:lifecycle-fixture:1",
  policyId: "economic-lifecycle-policy",
  policyRevision: "1",
  policyDigest: "sha256:economic-lifecycle-policy",
} as const;

function lifecycleEvent(
  sequence: number,
  transition: string,
  overrides: Record<string, unknown> = {},
): OperatorSessionEvent {
  return {
    eventId: `economic-lifecycle:event:${sequence}`,
    kilnSessionId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.sessionId,
    sequence,
    timestamp: `2026-08-08T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    kind: "managed_economic_lifecycle",
    turnId: "economic-lifecycle:turn:1",
    payload: {
      instanceId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.instanceId,
      sessionId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.sessionId,
      evidenceVersion: 1,
      jobId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.jobId,
      economicAttemptId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.economicAttemptId,
      transition,
      policyId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.policyId,
      policyRevision: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.policyRevision,
      policyDigest: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.policyDigest,
      ...overrides,
    },
  };
}

export const managedEconomicLifecycleEvents: readonly OperatorSessionEvent[] = [
  lifecycleEvent(1, "denied", { rejections: [
    { stage: "economic-selection", routeId: "route-codex", reason: "ceiling-exceeded" },
    { stage: "account-selection", routeId: "route-opencode", reason: "lease-conflict", count: 2 },
    { stage: "local-capacity", routeId: "route-opencode", reason: "route-capacity-exhausted" },
    { stage: "commitment-conflict", reason: "identity-revision-conflict" },
  ] }),
  lifecycleEvent(2, "held", { commitmentId: "commitment:lifecycle:1", reservationId: "reservation:lifecycle:1" }),
  lifecycleEvent(3, "dispatch-fenced", { dispatchFenceId: "fence:lifecycle:1" }),
  lifecycleEvent(4, "settlement-pending", { settlementKind: "pending" }),
  lifecycleEvent(5, "release-failed", { reason: "settlement-provider-unavailable" }),
  lifecycleEvent(6, "leaked", { reason: "settlement-unresolved" }),
  lifecycleEvent(7, "released", { settlementKind: "charged", settlementAuthority: "provider-reported" }),
];

/** Invalid evidence must remain visible, without retaining its sensitive-shaped values. */
export const managedEconomicLifecycleUnprojectableEvents: readonly OperatorSessionEvent[] = [
  lifecycleEvent(8, "held", { evidenceVersion: undefined }),
  lifecycleEvent(9, "held", { evidenceVersion: "one" }),
  lifecycleEvent(10, "held", { evidenceVersion: 99 }),
  lifecycleEvent(11, "denied", { rejections: [{
    stage: "account-selection", routeId: "route-opencode", reason: "lease-conflict", count: 1,
    accountRef: "secret-account-shaped-value", credential: "secret-credential-shaped-value",
    workingDirectoryPath: "C:\\synthetic\\private-path",
  }], jobId: "managed-economic-job:lifecycle-fixture:invalid", economicAttemptId: "economic-attempt:lifecycle-fixture:invalid" }),
];
