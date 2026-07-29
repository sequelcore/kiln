import type { OperatorSessionEvent } from "../../src/index.js";

export const MANAGED_ACCOUNT_LEASE_FIXTURE = {
  instanceId: "local",
  sessionId: "fixture-session",
  invocationId: "fixture-managed-job",
  accountRef: "configured:fixture-account:opaque",
  accountPolicyId: "fixture-managed-policy",
  leaseId: "fixture-account-lease",
  lifecycleState: "released",
  pendingLifecycleState: "settlement-pending",
  selectionReason: "least-pressure",
} as const;

export const managedAccountLeaseEvents: readonly OperatorSessionEvent[] = [{
  eventId: "fixture-account-lease-event",
  kilnSessionId: MANAGED_ACCOUNT_LEASE_FIXTURE.sessionId,
  sequence: 1,
  timestamp: "2026-07-28T12:00:00.000Z",
  kind: "agent_invocation_failed",
  turnId: "fixture-parent-turn",
  payload: {
    instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
    sessionId: MANAGED_ACCOUNT_LEASE_FIXTURE.sessionId,
    managedInvocationId: MANAGED_ACCOUNT_LEASE_FIXTURE.invocationId,
    lifecycleState: "timed_out",
    providerRoute: { providerId: "openai", model: "gpt-test" },
    managedInvocationEvidence: {
      lifecycle: {
        accountLease: {
          leaseId: MANAGED_ACCOUNT_LEASE_FIXTURE.leaseId,
          accountPolicyId: MANAGED_ACCOUNT_LEASE_FIXTURE.accountPolicyId,
          accountRef: MANAGED_ACCOUNT_LEASE_FIXTURE.accountRef,
          route: {
            providerId: "openai",
            providerModelId: "gpt-test",
            scope: "virtual:fixture-managed-policy",
          },
          jobId: MANAGED_ACCOUNT_LEASE_FIXTURE.invocationId,
          runtimeInvocationId: MANAGED_ACCOUNT_LEASE_FIXTURE.invocationId,
          credentialRevisionId: "a".repeat(64),
          selectionReason: MANAGED_ACCOUNT_LEASE_FIXTURE.selectionReason,
          candidateRejections: [{
            account: "configured:fixture-rejected:opaque",
            reason: "unhealthy",
          }],
          usageEvidence: {
            health: "healthy",
            freshness: "fresh",
            availability: "available",
            observedAt: "2026-07-28T11:58:00.000Z",
            validUntil: "2026-07-28T12:03:00.000Z",
            source: "provider-endpoint",
            confidence: "authoritative",
          },
          acquiredAt: "2026-07-28T11:59:00.000Z",
          lifecycleState: MANAGED_ACCOUNT_LEASE_FIXTURE.pendingLifecycleState,
          resourceUris: ["kiln://managed-accounts/leases/fixture-account-lease"],
          diagnosticUris: ["kiln://managed-accounts/leases/fixture-account-lease/settlement-pending"],
        },
      },
    },
  },
}, {
  eventId: "fixture-account-lease-settled-event",
  kilnSessionId: MANAGED_ACCOUNT_LEASE_FIXTURE.sessionId,
  sequence: 2,
  timestamp: "2026-07-28T12:00:01.000Z",
  kind: "agent_invocation_failed",
  turnId: "fixture-parent-turn",
  payload: {
    instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
    sessionId: MANAGED_ACCOUNT_LEASE_FIXTURE.sessionId,
    managedInvocationId: MANAGED_ACCOUNT_LEASE_FIXTURE.invocationId,
    lifecycleState: "timed_out",
    providerRoute: { providerId: "openai", model: "gpt-test" },
    managedInvocationEvidence: {
      lifecycle: {
        accountLease: {
          leaseId: MANAGED_ACCOUNT_LEASE_FIXTURE.leaseId,
          accountPolicyId: MANAGED_ACCOUNT_LEASE_FIXTURE.accountPolicyId,
          accountRef: MANAGED_ACCOUNT_LEASE_FIXTURE.accountRef,
          route: {
            providerId: "openai",
            providerModelId: "gpt-test",
            scope: "virtual:fixture-managed-policy",
          },
          jobId: MANAGED_ACCOUNT_LEASE_FIXTURE.invocationId,
          runtimeInvocationId: MANAGED_ACCOUNT_LEASE_FIXTURE.invocationId,
          credentialRevisionId: "a".repeat(64),
          selectionReason: MANAGED_ACCOUNT_LEASE_FIXTURE.selectionReason,
          candidateRejections: [{
            account: "configured:fixture-rejected:opaque",
            reason: "unhealthy",
          }],
          usageEvidence: {
            health: "healthy",
            freshness: "fresh",
            availability: "available",
            observedAt: "2026-07-28T11:58:00.000Z",
            validUntil: "2026-07-28T12:03:00.000Z",
            source: "provider-endpoint",
            confidence: "authoritative",
          },
          acquiredAt: "2026-07-28T11:59:00.000Z",
          lifecycleState: MANAGED_ACCOUNT_LEASE_FIXTURE.lifecycleState,
          releasedAt: "2026-07-28T12:00:01.000Z",
          resourceUris: ["kiln://managed-accounts/leases/fixture-account-lease"],
          diagnosticUris: ["kiln://managed-accounts/leases/fixture-account-lease/settlement-pending"],
        },
      },
    },
  },
}];
