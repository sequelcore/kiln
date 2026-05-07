import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KilnConfigChangeApproval } from "@kilnai/gateway-contracts";
import type { ConfigChangeProposalRecord } from "./config-proposal.js";

export interface StoredConfigChangeApproval extends KilnConfigChangeApproval {
  readonly status: "approved" | "consumed";
  readonly consumedAt?: string;
}

export class ConfigMutationStore {
  private readonly proposalsDir: string;
  private readonly approvalsDir: string;

  constructor(projectPath: string) {
    this.proposalsDir = join(projectPath, ".kiln", "proposals", "config");
    this.approvalsDir = join(projectPath, ".kiln", "approvals", "config");
  }

  saveProposal(record: ConfigChangeProposalRecord): void {
    mkdirSync(this.proposalsDir, { recursive: true });
    writeFileSync(this.proposalPath(record.proposal.proposalId), JSON.stringify(record, null, 2), "utf-8");
  }

  readProposal(proposalId: string): ConfigChangeProposalRecord | null {
    const path = this.proposalPath(proposalId);
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, "utf-8")) as ConfigChangeProposalRecord;
  }

  saveApproval(approval: StoredConfigChangeApproval): void {
    mkdirSync(this.approvalsDir, { recursive: true });
    writeFileSync(this.approvalPath(approval.approvalId), JSON.stringify(approval, null, 2), "utf-8");
  }

  readApproval(approvalId: string): StoredConfigChangeApproval | null {
    const path = this.approvalPath(approvalId);
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, "utf-8")) as StoredConfigChangeApproval;
  }

  markApprovalConsumed(approval: StoredConfigChangeApproval, consumedAt: string): StoredConfigChangeApproval {
    const consumed = {
      ...approval,
      status: "consumed" as const,
      consumedAt,
    };
    this.saveApproval(consumed);
    return consumed;
  }

  private proposalPath(proposalId: string): string {
    return join(this.proposalsDir, `${safeId(proposalId)}.json`);
  }

  private approvalPath(approvalId: string): string {
    return join(this.approvalsDir, `${safeId(approvalId)}.json`);
  }
}

export function createConfigApprovalId(input: {
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly approvedAt: string;
  readonly approvedBy: string;
}): string {
  const seed = JSON.stringify(input);
  return `cfgap_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function safeId(value: string): string {
  if (!/^[a-z0-9_-]+$/iu.test(value)) {
    throw new Error(`Invalid config mutation id: ${value}`);
  }
  return value;
}
