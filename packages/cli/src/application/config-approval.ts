import type { KilnConfigChangeApproval } from "@kilnai/gateway-contracts";
import { ConfigMutationStore, createConfigApprovalId } from "./config-mutation-store.js";

export interface ApproveConfigChangeProposalInput {
  readonly projectPath: string;
  readonly proposalId: string;
  readonly approvedBy?: string;
  readonly surface?: KilnConfigChangeApproval["surface"];
  readonly now?: Date;
}

export function approveConfigChangeProposal(input: ApproveConfigChangeProposalInput): KilnConfigChangeApproval {
  const store = new ConfigMutationStore(input.projectPath);
  const record = store.readProposal(input.proposalId);
  if (!record) {
    throw new Error(`Config proposal not found: ${input.proposalId}`);
  }
  if (record.proposal.status !== "valid") {
    throw new Error(`Config proposal is not valid: ${input.proposalId}`);
  }

  const approvedAt = (input.now ?? new Date()).toISOString();
  const approvedBy = input.approvedBy?.trim() || "operator";
  const approval = {
    approvalId: createConfigApprovalId({
      proposalId: input.proposalId,
      proposalHash: record.proposalHash,
      approvedAt,
      approvedBy,
    }),
    proposalId: input.proposalId,
    proposalHash: record.proposalHash,
    approvedAt,
    approvedBy,
    surface: input.surface ?? "cli",
    status: "approved" as const,
  };
  store.saveApproval(approval);
  return approval;
}
