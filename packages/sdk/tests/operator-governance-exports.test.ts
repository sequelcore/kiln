import { describe, expect, it } from "vitest";
import {
  createOperatorCockpitReadOnlyViewState,
  createOperatorWorkspaceHomeProjection,
  normalizeManagedAgentOperatorReplayEvents,
  projectOperatorCockpitReadOnlyView,
  projectOperatorGovernedWorkItems,
} from "../src/index.js";
import {
  EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE,
  externalRuntimeGovernanceEvents,
} from "../../gateway-contracts/tests/fixtures/external-runtime-governance.js";
import {
  MANAGED_ACCOUNT_LEASE_FIXTURE,
  managedAccountLeaseEvents,
} from "../../gateway-contracts/tests/fixtures/managed-account-lease.js";

describe("SDK operator governance exports", () => {
  it("projects the canonical replay without a surface-local interpretation", () => {
    const events = normalizeManagedAgentOperatorReplayEvents(
      externalRuntimeGovernanceEvents,
      { defaultInstanceId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.instanceId },
    );
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T09:01:00.000Z",
      attachTargets: [{
        instanceId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.instanceId,
        label: "Synthetic external runtime",
        kind: "local",
      }],
      events,
    });
    const cockpitView = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });
    const home = createOperatorWorkspaceHomeProjection({
      projectedAt: projection.projectedAt,
      cockpitView,
      events,
    });

    expect(projectOperatorGovernedWorkItems(events)[0]).toMatchObject({
      id: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.workItemId,
      status: "completed",
      providedEvidence: ["runtime-observation"],
      pendingPauseRequirementCount: 0,
    });
    expect(cockpitView.managedAgents.items.find(
      (item) => item.managedInvocationId === EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.invocationId,
    )).toMatchObject({
      externalRuntimeAttachment: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment,
      externalToolFailures: [{
        diagnostic: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.safeFailureDiagnostic,
      }],
    });
    expect(home).toMatchObject({
      work: { blockedCount: 0, activeGoalCount: 0 },
      approvals: { pendingCount: 0, resolvedCount: 2 },
    });
  });

  it("exports canonical managed account lease projection without reinterpreting policy", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T12:01:00.000Z",
      attachTargets: [{
        instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
        label: "Synthetic managed account runtime",
        kind: "local",
      }],
      events: managedAccountLeaseEvents,
    });

    expect(projection.invocations[0]?.accountLease).toMatchObject({
      leaseId: MANAGED_ACCOUNT_LEASE_FIXTURE.leaseId,
      accountPolicyId: MANAGED_ACCOUNT_LEASE_FIXTURE.accountPolicyId,
      accountRef: MANAGED_ACCOUNT_LEASE_FIXTURE.accountRef,
      lifecycleState: MANAGED_ACCOUNT_LEASE_FIXTURE.lifecycleState,
      selectionReason: MANAGED_ACCOUNT_LEASE_FIXTURE.selectionReason,
    });
  });
});
