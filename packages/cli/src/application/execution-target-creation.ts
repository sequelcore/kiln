import type { KilnConfigApprovalSurface } from "@kilnai/gateway-contracts";
import {
  defineExecutionTargetEvidenceSnapshot,
  executionTargetEvidenceRevision,
  projectExecutionTargetCatalogFromIntent,
  writeExecutionTargetEvidenceSnapshot,
  type ExecutionTargetCatalogIntent,
  type ExecutionTargetEvidenceSnapshot,
} from "../config/execution-target-evidence-store.js";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import type { CompleteExecutionTargetDraft } from "./execution-target-draft.js";
import { applyConfigMutation, approveConfigMutation, proposeConfigMutation } from "./config-mutation-authority.js";
import { ConfigMutationStore } from "./config-mutation-store.js";

export interface ExecutionTargetCreationCommitResult {
  readonly status: "created" | "committed-refresh-failed";
  readonly revision: string;
}

export async function createExecutionTarget(input: {
  readonly draft: CompleteExecutionTargetDraft;
  readonly expectedRevision: string;
  readonly currentIntent: ExecutionTargetCatalogIntent;
  readonly currentEvidence: ExecutionTargetEvidenceSnapshot;
  readonly projectPath: string;
  readonly approvalSurface: KilnConfigApprovalSurface;
  /** True only after the owning operator surface confirms this exact create request. */
  readonly operatorApproved: boolean;
  readonly publishEvidence?: typeof writeExecutionTargetEvidenceSnapshot;
  readonly globalConfigPath?: string;
}): Promise<ExecutionTargetCreationCommitResult> {
  const nextEvidence = defineExecutionTargetEvidenceSnapshot({
    ...input.currentEvidence,
    targets: [...input.currentEvidence.targets, input.draft.evidence],
  });
  const nextEvidenceRevision = executionTargetEvidenceRevision(nextEvidence);
  const nextIntent: ExecutionTargetCatalogIntent = {
    ...input.currentIntent,
    evidenceRevision: nextEvidenceRevision,
    targets: [...input.currentIntent.targets, input.draft.intent],
  };
  projectExecutionTargetCatalogFromIntent(nextIntent, nextEvidence, nextEvidenceRevision);
  const published = (input.publishEvidence ?? writeExecutionTargetEvidenceSnapshot)({
    globalConfigPath: input.globalConfigPath ?? resolveGlobalConfigPath(),
    snapshot: nextEvidence,
  });
  if (published.revision !== nextEvidenceRevision) {
    throw new Error("Published execution-target evidence revision changed after validation.");
  }
  const globalConfigPath = input.globalConfigPath ?? resolveGlobalConfigPath();
  const record = proposeConfigMutation({
    projectPath: input.projectPath,
    globalConfigPath,
    operation: "target.create",
    payload: {
      target: input.draft.intent,
      evidenceRevision: nextEvidenceRevision,
      expectedRevision: input.expectedRevision,
    },
  });
  if (record.proposal.status !== "valid") {
    throw new Error(`Execution target creation rejected: ${record.proposal.diagnostics.map((entry) => entry.message).join("; ")}`);
  }
  if (record.proposal.approvalRequired && !input.operatorApproved) {
    throw new Error("Execution target creation requires explicit operator approval.");
  }
  new ConfigMutationStore(input.projectPath).saveProposal(record);
  const approval = record.proposal.approvalRequired
    ? approveConfigMutation({
        projectPath: input.projectPath,
        proposalId: record.proposal.proposalId,
        surface: input.approvalSurface,
      })
    : undefined;
  const result = await applyConfigMutation({
    projectPath: input.projectPath,
    globalConfigPath,
    proposalId: record.proposal.proposalId,
    ...(approval ? { approvalId: approval.approvalId } : {}),
    requester: "operator",
  });
  if (result.settlement.outcome === "rejected" || !result.settlement.committedRevision) {
    throw new Error(`Execution target creation rejected: ${result.settlement.diagnostics.map((entry) => entry.message).join("; ")}`);
  }
  return {
    status: result.settlement.outcome === "committed" ? "created" : "committed-refresh-failed",
    revision: result.settlement.committedRevision,
  };
}
