import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import type {
  KilnConfigMutationApproval,
  KilnConfigMutationProposal,
  KilnConfigMutationSettlement,
} from "@kilnai/gateway-contracts";

/** Exact prior bytes for one canonical path, retained so rollback restores state rather than prose. */
export interface ConfigMutationRestorePoint {
  readonly path: string;
  /** Null when the path did not exist before the mutation; rollback then removes it. */
  readonly previousContent: string | null;
}

export interface ConfigMutationProposalRecord {
  readonly proposal: KilnConfigMutationProposal;
  readonly proposalHash: string;
  readonly writes: readonly ConfigMutationWrite[];
}

export interface ConfigMutationWrite {
  readonly path: string;
  /** `delete` removes the path; restoring non-existence is a real outcome. */
  readonly action: "replace" | "delete";
  readonly previousHash: string | null;
  readonly nextHash: string;
  readonly nextContent: string;
  readonly previousContent: string | null;
}

export interface StoredConfigMutationApproval extends KilnConfigMutationApproval {
  readonly status: "approved" | "consumed";
  readonly consumedAt?: string;
}

/**
 * Durable settlement plus the exact bytes rollback needs. The wire settlement
 * stays free of file content; restore points never leave this store.
 */
export interface StoredConfigMutationSettlement extends KilnConfigMutationSettlement {
  readonly restore: readonly ConfigMutationRestorePoint[];
}

/**
 * An apply that has entered its commit window but has not settled yet.
 *
 * The marker is what makes crash recovery honest: recovery resumes only an
 * interrupted commit this exact proposal started, instead of inferring intent
 * from file content that some other writer could have produced.
 */
export interface ConfigMutationProgressMarker {
  readonly proposalId: string;
  readonly path: string;
  /** Revision the canonical path holds once this commit lands. */
  readonly intendedRevision: string;
  readonly startedAt: string;
}

/**
 * Durable governance records for the configuration mutation authority.
 *
 * Records live under the operator-owned Kiln home, never inside the project
 * workspace: a model holding workspace write authority must not be able to
 * forge an approval, tamper with a proposal's stored content, or fabricate a
 * settlement. They are additionally namespaced per project, so a proposal
 * raised in one project cannot be approved or applied from another.
 *
 * Settlements are terminal: once written they are never rewritten, which is
 * what makes a retried apply safe.
 */
export class ConfigMutationStore {
  private readonly root: string;

  constructor(projectPath: string, options?: { readonly root?: string }) {
    const base = options?.root ?? join(dirname(resolveGlobalConfigPath()), "mutations", "config");
    this.root = join(base, projectNamespace(projectPath));
  }

  /** Lock file guarding the commit window for one canonical path. */
  lockPathFor(canonicalPath: string): string {
    return join(this.root, "locks", `${hashPath(canonicalPath)}.lock`);
  }

  readProgressMarker(proposalId: string): ConfigMutationProgressMarker | null {
    return readJson<ConfigMutationProgressMarker>(this.markerPath(proposalId));
  }

  writeProgressMarker(marker: ConfigMutationProgressMarker): void {
    writeJson(this.markerPath(marker.proposalId), marker);
  }

  clearProgressMarker(proposalId: string): void {
    rmSync(this.markerPath(proposalId), { force: true });
  }

  saveProposal(record: ConfigMutationProposalRecord): void {
    writeJson(this.proposalPath(record.proposal.proposalId), record);
  }

  readProposal(proposalId: string): ConfigMutationProposalRecord | null {
    return readJson<ConfigMutationProposalRecord>(this.proposalPath(proposalId));
  }

  saveApproval(approval: StoredConfigMutationApproval): void {
    writeJson(this.approvalPath(approval.approvalId), approval);
  }

  readApproval(approvalId: string): StoredConfigMutationApproval | null {
    return readJson<StoredConfigMutationApproval>(this.approvalPath(approvalId));
  }

  markApprovalConsumed(
    approval: StoredConfigMutationApproval,
    consumedAt: string,
  ): StoredConfigMutationApproval {
    const consumed = { ...approval, status: "consumed" as const, consumedAt };
    this.saveApproval(consumed);
    return consumed;
  }

  readSettlement(proposalId: string): StoredConfigMutationSettlement | null {
    return readJson<StoredConfigMutationSettlement>(this.settlementPath(proposalId));
  }

  /**
   * Records the terminal outcome for a proposal.
   *
   * The record is written in full to a temporary file and then linked into
   * place. Linking is both atomic and exclusive, so a crash can never leave a
   * truncated settlement that fails to parse on every later read, and two
   * concurrent applies cannot both believe they settled the same operation;
   * the loser reads the winner's record.
   */
  settle(settlement: StoredConfigMutationSettlement): StoredConfigMutationSettlement {
    const path = this.settlementPath(settlement.proposalId);
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(settlement, null, 2), "utf-8");
      linkSync(temporaryPath, path);
      return settlement;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      return this.readSettlement(settlement.proposalId) ?? settlement;
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  private proposalPath(proposalId: string): string {
    return join(this.root, "proposals", `${safeId(proposalId)}.json`);
  }

  private approvalPath(approvalId: string): string {
    return join(this.root, "approvals", `${safeId(approvalId)}.json`);
  }

  private settlementPath(proposalId: string): string {
    return join(this.root, "settlements", `${safeId(proposalId)}.json`);
  }

  private markerPath(proposalId: string): string {
    return join(this.root, "in-progress", `${safeId(proposalId)}.json`);
  }
}

export function createConfigApprovalId(input: {
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly approvedAt: string;
  readonly approvedBy: string;
}): string {
  return `cfgap_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(temporaryPath, path);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/** Stable per-project namespace derived from the canonical project path. */
function projectNamespace(projectPath: string): string {
  return hashPath(projectPath);
}

function hashPath(value: string): string {
  return createHash("sha256").update(resolve(value).toLowerCase()).digest("hex").slice(0, 16);
}

function safeId(value: string): string {
  if (!/^[a-z0-9_-]+$/iu.test(value)) {
    throw new Error(`Invalid config mutation id: ${value}`);
  }
  return value;
}
