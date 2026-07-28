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
      status: "blocked",
      pendingPauseRequirementCount: 1,
    });
    expect(cockpitView.managedAgents.items[0]).toMatchObject({
      externalRuntimeAttachment: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment,
      externalToolFailures: [{
        diagnostic: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.safeFailureDiagnostic,
      }],
    });
    expect(home).toMatchObject({
      work: { blockedCount: 1, activeGoalCount: 1 },
      approvals: { pendingCount: 0, resolvedCount: 1 },
    });
  });
});
