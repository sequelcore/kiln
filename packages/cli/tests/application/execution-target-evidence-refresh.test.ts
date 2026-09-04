import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshExecutionTargetEvidence } from "../../src/application/execution-target-evidence-refresh.js";
import { executionTargetEvidenceRevision } from "../../src/config/execution-target-evidence-store.js";
import { managedAgentTargetEvidence } from "../config/managed-agent-intent-config-fixture.js";

const mutationMocks = vi.hoisted(() => ({
  propose: vi.fn(),
  approve: vi.fn(),
  apply: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../src/application/config-mutation-authority.js", () => ({
  proposeConfigMutation: mutationMocks.propose,
  approveConfigMutation: mutationMocks.approve,
  applyConfigMutation: mutationMocks.apply,
}));

vi.mock("../../src/application/config-mutation-store.js", () => ({
  ConfigMutationStore: class {
    saveProposal = mutationMocks.save;
  },
}));

describe("refreshExecutionTargetEvidence", () => {
  beforeEach(() => {
    mutationMocks.propose.mockReset().mockReturnValue({
      proposal: { proposalId: "cfg_target_refresh", status: "valid", diagnostics: [] },
    });
    mutationMocks.approve.mockReset().mockReturnValue({ approvalId: "approval_target_refresh" });
    mutationMocks.apply.mockReset().mockResolvedValue({
      settlement: { outcome: "committed", committedRevision: "sha256:next", diagnostics: [] },
    });
    mutationMocks.save.mockReset();
  });

  it("publishes and binds one exact renewed evidence revision through mutation authority", async () => {
    const renewedEvidence = managedAgentTargetEvidence();
    const evidenceRevision = executionTargetEvidenceRevision(renewedEvidence);
    const publishEvidence = vi.fn(() => ({
      revision: evidenceRevision,
      path: "fixture-evidence.json",
      created: true,
    }));
    const result = await refreshExecutionTargetEvidence({
      projectPath: "C:/fixture/project",
      expectedConfigurationRevision: "sha256:expected",
      priorEvidenceRevision: `sha256:${"1".repeat(64)}`,
      renewedEvidence,
      approvalSurface: "cli",
      operatorApproved: true,
      globalConfigPath: "C:/fixture/home/kiln/config.yaml",
      publishEvidence,
    });

    expect(publishEvidence).toHaveBeenCalledOnce();
    expect(mutationMocks.propose).toHaveBeenCalledWith(expect.objectContaining({
      operation: "target.refresh_evidence",
      payload: {
        evidenceRevision,
        priorEvidenceRevision: `sha256:${"1".repeat(64)}`,
        expectedRevision: "sha256:expected",
      },
    }));
    expect(mutationMocks.approve).toHaveBeenCalledWith(expect.objectContaining({ surface: "cli" }));
    expect(mutationMocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: "approval_target_refresh",
      requester: "operator",
    }));
    expect(result).toEqual({
      outcome: "committed",
      evidenceRevision,
      committedConfigurationRevision: "sha256:next",
    });
  });

  it("does not publish or mint approval without the operator decision", async () => {
    const publishEvidence = vi.fn();
    await expect(refreshExecutionTargetEvidence({
      projectPath: "C:/fixture/project",
      expectedConfigurationRevision: "sha256:expected",
      priorEvidenceRevision: `sha256:${"1".repeat(64)}`,
      renewedEvidence: managedAgentTargetEvidence(),
      approvalSurface: "cli",
      operatorApproved: false,
      publishEvidence,
    })).rejects.toThrow(/explicit operator approval/u);
    expect(publishEvidence).not.toHaveBeenCalled();
    expect(mutationMocks.propose).not.toHaveBeenCalled();
  });
});
