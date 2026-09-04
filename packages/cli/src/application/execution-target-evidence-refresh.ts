import type { KilnConfigApprovalSurface } from "@kilnai/gateway-contracts";
import {
  executionTargetEvidenceRevision,
  writeExecutionTargetEvidenceSnapshot,
  type ExecutionTargetEvidenceRevision,
  type ExecutionTargetEvidenceSnapshot,
} from "../config/execution-target-evidence-store.js";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import { applyConfigMutation, approveConfigMutation, proposeConfigMutation } from "./config-mutation-authority.js";
import { ConfigMutationStore } from "./config-mutation-store.js";

export interface ExecutionTargetEvidenceRefreshResult {
  readonly outcome: "committed" | "committed-reconciliation-failed";
  readonly evidenceRevision: ExecutionTargetEvidenceRevision;
  readonly committedConfigurationRevision: string;
}

export async function refreshExecutionTargetEvidence(input: {
  readonly projectPath: string;
  readonly expectedConfigurationRevision: string;
  readonly priorEvidenceRevision: ExecutionTargetEvidenceRevision;
  readonly renewedEvidence: ExecutionTargetEvidenceSnapshot;
  readonly approvalSurface: KilnConfigApprovalSurface;
  readonly operatorApproved: boolean;
  readonly globalConfigPath?: string;
  readonly publishEvidence?: typeof writeExecutionTargetEvidenceSnapshot;
}): Promise<ExecutionTargetEvidenceRefreshResult> {
  if (!input.operatorApproved) {
    throw new Error("Execution-target evidence refresh requires explicit operator approval.");
  }
  const globalConfigPath = input.globalConfigPath ?? resolveGlobalConfigPath();
  const evidenceRevision = executionTargetEvidenceRevision(input.renewedEvidence);
  const published = (input.publishEvidence ?? writeExecutionTargetEvidenceSnapshot)({
    globalConfigPath,
    snapshot: input.renewedEvidence,
  });
  if (published.revision !== evidenceRevision) {
    throw new Error("Published execution-target renewal revision changed after validation.");
  }
  const record = proposeConfigMutation({
    projectPath: input.projectPath,
    globalConfigPath,
    operation: "target.refresh_evidence",
    payload: {
      evidenceRevision,
      priorEvidenceRevision: input.priorEvidenceRevision,
      expectedRevision: input.expectedConfigurationRevision,
    },
  });
  if (record.proposal.status !== "valid") {
    throw new Error(`Execution-target evidence refresh rejected: ${record.proposal.diagnostics.map((entry) => entry.message).join("; ")}`);
  }
  new ConfigMutationStore(input.projectPath).saveProposal(record);
  const approval = approveConfigMutation({
    projectPath: input.projectPath,
    proposalId: record.proposal.proposalId,
    surface: input.approvalSurface,
  });
  const result = await applyConfigMutation({
    projectPath: input.projectPath,
    globalConfigPath,
    proposalId: record.proposal.proposalId,
    approvalId: approval.approvalId,
    requester: "operator",
  });
  const settlement = result.settlement;
  if (settlement.outcome === "rejected" || !settlement.committedRevision) {
    throw new Error(`Execution-target evidence refresh rejected: ${settlement.diagnostics.map((entry) => entry.message).join("; ")}`);
  }
  return {
    outcome: settlement.outcome,
    evidenceRevision,
    committedConfigurationRevision: settlement.committedRevision,
  };
}
