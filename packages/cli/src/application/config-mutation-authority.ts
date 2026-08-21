import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type {
  KilnConfigActivationClass,
  KilnConfigAppliedWrite,
  KilnConfigAuthorityImpact,
  KilnConfigMutationApproval,
  KilnConfigMutationOperation,
  KilnConfigMutationProposal,
  KilnConfigMutationResult,
  KilnConfigMutationScope,
  KilnConfigReconciliationEffect,
  KilnConfigReconciliationTarget,
  KilnConfigValidationDiagnostic,
  KilnEffectiveConfigSnapshot,
} from "@kilnai/gateway-contracts";
import {
  commitGlobalConfigBytes,
  GlobalConfigMutationError,
  resolveGlobalConfigPath,
} from "../config/global-config.js";
import {
  agentToolAuthorityImpact,
  hashStable,
  hashText,
  normalizeConfigMutation,
  renderPreviewDiff,
  type NormalizedConfigMutation,
} from "./config-mutation-operations.js";
import { parseAgentDefinitionContent } from "./agent-loader.js";
import {
  ConfigMutationStore,
  createConfigApprovalId,
  type ConfigMutationProposalRecord,
  type ConfigMutationRestorePoint,
  type ConfigMutationWrite,
  type StoredConfigMutationSettlement,
} from "./config-mutation-store.js";
import { reconcileConfigMutation } from "./config-mutation-reconciliation.js";
import { withConfigMutationLock } from "./config-mutation-lock.js";

/** Reads effective state after a commit. Injected so tests do not need real harness projections. */
export interface EffectiveStateReadBackPort {
  (projectPath: string): Promise<KilnEffectiveConfigSnapshot | undefined>;
}

export interface ProposeConfigMutationInput {
  readonly projectPath: string;
  readonly operation: KilnConfigMutationOperation;
  readonly payload: unknown;
  readonly globalConfigPath?: string;
  readonly now?: Date;
}

export interface ApproveConfigMutationInput {
  readonly projectPath: string;
  readonly proposalId: string;
  readonly approvedBy?: string;
  readonly surface?: KilnConfigMutationApproval["surface"];
  readonly now?: Date;
}

/**
 * Who is asking for the commit. ADR-014 lets a direct operator action commit a
 * bounded, non-authority-expanding change without approval, but a model-called
 * mutation always requires explicit operator approval.
 */
export type ConfigMutationRequester = "operator" | "model";

export interface ApplyConfigMutationInput {
  readonly projectPath: string;
  readonly proposalId: string;
  readonly approvalId?: string;
  /** Mandatory: an omitted requester must never silently mean operator authority. */
  readonly requester: ConfigMutationRequester;
  readonly globalConfigPath?: string;
  readonly now?: Date;
  readonly readEffectiveState?: EffectiveStateReadBackPort;
  readonly reconcile?: typeof reconcileConfigMutation;
}

/**
 * Builds a validated proposal without writing canonical configuration.
 *
 * Identity is derived from scope, operation, normalized payload, target path,
 * proposed content, and base revision, so the same intent against the same base
 * always yields the same proposal id. That is what makes a retried apply
 * recognisable as the same operation rather than a new one.
 */
export function proposeConfigMutation(input: ProposeConfigMutationInput): ConfigMutationProposalRecord {
  const globalConfigPath = input.globalConfigPath ?? resolveGlobalConfigPath();
  const createdAt = (input.now ?? new Date()).toISOString();

  const resolution = input.operation === "mutation.rollback"
    ? resolveRollbackMutation(input.projectPath, input.payload, globalConfigPath)
    : { normalized: normalizeConfigMutation(input.operation, { projectPath: input.projectPath, globalConfigPath }, input.payload) };

  const normalized = resolution.normalized;
  const diagnostics: KilnConfigValidationDiagnostic[] = [...normalized.diagnostics];
  diagnostics.push(...validateWritePath({
    projectPath: input.projectPath,
    globalConfigPath,
    scope: normalized.scope,
    path: normalized.path,
  }));

  const previousContent = existsSync(normalized.path) ? readFileSync(normalized.path, "utf-8") : null;
  const baseRevision = revisionOf(previousContent);
  const status = diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "invalid" : "valid";
  const removesPath = resolution.removesPath === true;

  const proposalSeed = {
    scope: normalized.scope,
    operation: input.operation,
    payload: normalized.payload,
    path: normalized.path,
    nextContent: removesPath ? null : normalized.nextContent,
    baseRevision,
  };

  const proposal: KilnConfigMutationProposal = {
    proposalId: `cfg_${hashStable(proposalSeed).slice(0, 24)}`,
    createdAt,
    scope: normalized.scope,
    operation: input.operation,
    status,
    baseRevision,
    normalizedPayload: normalized.payload,
    affectedOwners: normalized.affectedOwners,
    affectedCanonicalPaths: [normalized.path],
    reconciliationTargets: normalized.reconciliationTargets,
    authorityImpact: normalized.authorityImpact,
    approvalRequired: normalized.authorityImpact !== "none",
    activation: normalized.activation,
    diagnostics,
    previewDiff: renderPreviewDiff(normalized.path, previousContent ?? "", removesPath ? "" : normalized.nextContent),
    rollback: {
      restorable: status === "valid",
      summary: previousContent === null
        ? `Rollback removes ${normalized.path}, which does not exist yet.`
        : `Rollback restores the exact prior bytes of ${normalized.path}.`,
    },
  };

  const writes: readonly ConfigMutationWrite[] = status === "valid"
    ? [{
      path: normalized.path,
      action: removesPath ? "delete" : "replace",
      previousHash: previousContent === null ? null : hashText(previousContent),
      nextHash: removesPath ? "" : hashText(normalized.nextContent),
      nextContent: removesPath ? "" : normalized.nextContent,
      previousContent,
    }]
    : [];

  return {
    proposal,
    proposalHash: hashStable({
      proposal,
      writes: writes.map((write) => ({ path: write.path, previousHash: write.previousHash, nextHash: write.nextHash })),
    }),
    writes,
  };
}

/**
 * Records durable operator approval for one exact proposal. The approval binds
 * the proposal hash, so an edited proposal can never reuse it.
 */
export function approveConfigMutation(input: ApproveConfigMutationInput): KilnConfigMutationApproval {
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

/**
 * Commits an approved proposal and settles it honestly.
 *
 * A previously committed proposal replays its durable settlement instead of
 * writing again. Rejections are not settled durably, so an operator can retry
 * the same intent once the conflict that caused the rejection clears.
 */
export async function applyConfigMutation(input: ApplyConfigMutationInput): Promise<KilnConfigMutationResult> {
  const store = new ConfigMutationStore(input.projectPath);
  const settledAt = (input.now ?? new Date()).toISOString();
  const globalConfigPath = input.globalConfigPath ?? resolveGlobalConfigPath();

  const existingSettlement = store.readSettlement(input.proposalId);
  if (existingSettlement) {
    return await withReadBack(input, existingSettlement, true);
  }

  const record = store.readProposal(input.proposalId);
  if (!record) {
    return rejected(input, settledAt, "project", [diagnostic("proposalId", "Config proposal not found.")]);
  }
  const proposal = record.proposal;
  if (proposal.status !== "valid") {
    return rejected(input, settledAt, proposal.scope, [diagnostic("proposal", "Only valid config proposals can be applied.")], proposal);
  }

  const approvalDiagnostics = checkApproval(store, record, input.approvalId, input.requester);
  if (approvalDiagnostics.length > 0) {
    return rejected(input, settledAt, proposal.scope, approvalDiagnostics, proposal);
  }

  const pathDiagnostics = validateWritePath({
    projectPath: input.projectPath,
    globalConfigPath,
    scope: proposal.scope,
    path: record.writes[0]?.path ?? "",
  });
  if (pathDiagnostics.length > 0) {
    return rejected(input, settledAt, proposal.scope, pathDiagnostics, proposal);
  }

  const write = record.writes[0];
  if (!write) {
    return rejected(input, settledAt, proposal.scope, [diagnostic("write", "Valid proposal carries no canonical write.")], proposal);
  }

  // Everything from the fence recheck through settlement runs under one lock
  // for this canonical path, so two applies cannot both pass the fence and
  // overwrite each other while each believes it settled the only change.
  let commitOutcome: CommitOutcome | KilnConfigMutationResult;
  try {
    commitOutcome = withConfigMutationLock(store.lockPathFor(write.path), () => {
      const currentContent = existsSync(write.path) ? readFileSync(write.path, "utf-8") : null;
      const currentRevision = revisionOf(currentContent);
      const marker = store.readProgressMarker(proposal.proposalId);
      const interrupted = marker !== null
        && marker.path === write.path
        && currentRevision === marker.intendedRevision;

      if (interrupted) {
        // This exact proposal entered its commit window and the canonical path
        // already holds the content it intended. Resume settlement rather than
        // rejecting a change that did land.
        return { appliedWrites: appliedWritesFor(write), committedRevision: currentRevision } satisfies CommitOutcome;
      }
      if (currentRevision !== proposal.baseRevision) {
        return rejected(input, settledAt, proposal.scope, [diagnostic(
          write.path,
          "Config proposal is stale; the canonical revision changed after the proposal was created.",
        )], proposal);
      }

      store.writeProgressMarker({
        proposalId: proposal.proposalId,
        path: write.path,
        intendedRevision: intendedRevision(write),
        startedAt: settledAt,
      });
      return proposal.scope === "global"
        ? commitGlobalWrite(record.writes, proposal.baseRevision)
        : commitProjectWrites(record.writes);
    });
  } catch (error) {
    return rejected(input, settledAt, proposal.scope, [diagnostic("write", commitErrorMessage(error))], proposal);
  }
  if (!isCommitOutcome(commitOutcome)) {
    return commitOutcome;
  }
  const { appliedWrites, committedRevision } = commitOutcome;

  const reconcile = input.reconcile ?? reconcileConfigMutation;
  const reconciliationEffects = await reconcile(input.projectPath, proposal.reconciliationTargets);
  const approval = input.approvalId ? store.readApproval(input.approvalId) : null;
  if (approval && approval.status === "approved") {
    store.markApprovalConsumed(approval, settledAt);
  }

  const failedReconciliation = reconciliationEffects.some((effect) => effect.status === "failed");
  const settlement = store.settle({
    proposalId: proposal.proposalId,
    approvalId: input.approvalId ?? null,
    scope: proposal.scope,
    operation: proposal.operation,
    settledAt,
    outcome: failedReconciliation ? "committed-reconciliation-failed" : "committed",
    baseRevision: proposal.baseRevision,
    committedRevision,
    appliedWrites,
    reconciliationEffects,
    diagnostics: reconciliationEffects.flatMap((effect) => effect.errors.map((error) => diagnostic(effect.target, error, "warning"))),
    rollbackToken: proposal.proposalId,
    activation: proposal.activation,
    restore: record.writes.map((write): ConfigMutationRestorePoint => ({
      path: write.path,
      previousContent: write.previousContent,
    })),
  });
  store.clearProgressMarker(proposal.proposalId);

  return await withReadBack(input, settlement, false);
}

interface CommitOutcome {
  readonly appliedWrites: readonly KilnConfigAppliedWrite[];
  readonly committedRevision: string;
}

function isCommitOutcome(value: CommitOutcome | KilnConfigMutationResult): value is CommitOutcome {
  return "appliedWrites" in value;
}

function appliedWritesFor(write: ConfigMutationWrite): readonly KilnConfigAppliedWrite[] {
  return [{
    path: write.path,
    previousHash: write.previousHash,
    nextHash: write.action === "delete" ? "" : write.nextHash,
  }];
}

/**
 * Rebuilds a mutation that restores the exact prior bytes recorded by a
 * committed settlement. Rollback is a governed operation, not a file copy.
 */
function resolveRollbackMutation(
  projectPath: string,
  payload: unknown,
  globalConfigPath: string,
): { readonly normalized: NormalizedConfigMutation; readonly removesPath?: boolean } {
  const token = typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>).token
    : undefined;
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  if (typeof token !== "string" || token.trim().length === 0) {
    diagnostics.push(diagnostic("token", "Rollback requires the rollbackToken of a committed mutation."));
    return { normalized: invalidRollback(globalConfigPath, diagnostics) };
  }

  const settlement = new ConfigMutationStore(projectPath).readSettlement(token.trim());
  if (!settlement) {
    diagnostics.push(diagnostic("token", `No committed mutation settlement found for token: ${token}`));
    return { normalized: invalidRollback(globalConfigPath, diagnostics) };
  }
  const restore = settlement.restore[0];
  if (!restore) {
    diagnostics.push(diagnostic("token", "Settlement retains no restore point."));
    return { normalized: invalidRollback(globalConfigPath, diagnostics) };
  }

  return {
    removesPath: restore.previousContent === null,
    normalized: {
      scope: settlement.scope,
      payload: { token: token.trim(), path: restore.path },
      path: restore.path,
      nextContent: restore.previousContent ?? "",
      diagnostics,
      authorityImpact: restoredAuthorityImpact(settlement.operation, restore.path, restore.previousContent),
      affectedOwners: ["config-mutation-authority"],
      reconciliationTargets: settlement.reconciliationEffects.map((effect) => effect.target),
      activation: settlement.activation,
    },
  };
}

function invalidRollback(
  globalConfigPath: string,
  diagnostics: readonly KilnConfigValidationDiagnostic[],
): NormalizedConfigMutation {
  return {
    scope: "global",
    payload: {},
    path: globalConfigPath,
    nextContent: "",
    diagnostics,
    authorityImpact: "none",
    affectedOwners: ["config-mutation-authority"],
    reconciliationTargets: [],
    activation: "hot",
  };
}

function checkApproval(
  store: ConfigMutationStore,
  record: ConfigMutationProposalRecord,
  approvalId: string | undefined,
  requester: ConfigMutationRequester,
): readonly KilnConfigValidationDiagnostic[] {
  const proposal = record.proposal;
  if (!approvalId) {
    if (requester === "model") {
      return [diagnostic("approvalId", "Model-called configuration mutations always require an explicit operator approval.")];
    }
    return proposal.approvalRequired
      ? [diagnostic("approvalId", `Operation expands authority (${proposal.authorityImpact}) and requires an approval.`)]
      : [];
  }
  const approval = store.readApproval(approvalId);
  if (!approval) {
    return [diagnostic("approvalId", "Config approval not found.")];
  }
  if (approval.status !== "approved") {
    return [diagnostic("approvalId", "Config approval is not active.")];
  }
  if (approval.proposalId !== proposal.proposalId || approval.proposalHash !== record.proposalHash) {
    return [diagnostic("approvalId", "Config approval does not match the stored proposal.")];
  }
  return [];
}

/** Project writes replace canonical files through a temporary file so a failure cannot leave a partial file. */
function commitProjectWrites(writes: readonly ConfigMutationWrite[]): {
  readonly appliedWrites: readonly KilnConfigAppliedWrite[];
  readonly committedRevision: string;
} {
  const appliedWrites: KilnConfigAppliedWrite[] = [];
  let committedRevision = "absent";
  for (const write of writes) {
    if (write.action === "delete") {
      if (existsSync(write.path)) {
        unlinkSync(write.path);
      }
      appliedWrites.push({ path: write.path, previousHash: write.previousHash, nextHash: "" });
      committedRevision = "absent";
      continue;
    }
    mkdirSync(dirname(write.path), { recursive: true });
    const temporaryPath = `${write.path}.${process.pid}.tmp`;
    try {
      writeFileSync(temporaryPath, write.nextContent, "utf-8");
      renameSync(temporaryPath, write.path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    appliedWrites.push({ path: write.path, previousHash: write.previousHash, nextHash: write.nextHash });
    committedRevision = revisionOf(write.nextContent);
  }
  return { appliedWrites, committedRevision };
}

/** Global writes delegate to the global configuration owner, which holds the lock, fence, validation, and atomic replace. */
function commitGlobalWrite(
  writes: readonly ConfigMutationWrite[],
  baseRevision: string,
): {
  readonly appliedWrites: readonly KilnConfigAppliedWrite[];
  readonly committedRevision: string;
} {
  const write = writes[0];
  if (!write) {
    return { appliedWrites: [], committedRevision: baseRevision };
  }
  if (write.action === "delete") {
    throw new Error("Global configuration cannot be removed by a mutation; adoption owns its lifecycle.");
  }
  const result = commitGlobalConfigBytes({ content: write.nextContent, expectedRevision: baseRevision });
  return {
    appliedWrites: [{ path: write.path, previousHash: write.previousHash, nextHash: write.nextHash }],
    committedRevision: result.revision,
  };
}

async function withReadBack(
  input: ApplyConfigMutationInput,
  settlement: StoredConfigMutationSettlement,
  replayed: boolean,
): Promise<KilnConfigMutationResult> {
  const snapshot = await readEffectiveState(input);
  const wire = toWireSettlement(settlement);
  return {
    settlement: wire,
    replayed,
    readBackSchemaRevision: snapshot?.schemaRevision ?? null,
    readBackVerified: snapshot !== undefined && observedRevision(settlement) === settlement.committedRevision,
  };
}

async function readEffectiveState(
  input: ApplyConfigMutationInput,
): Promise<KilnEffectiveConfigSnapshot | undefined> {
  const port = input.readEffectiveState ?? defaultEffectiveStateReadBack;
  try {
    return await port(input.projectPath);
  } catch {
    return undefined;
  }
}

const defaultEffectiveStateReadBack: EffectiveStateReadBackPort = async (projectPath) => {
  const { readConfigStatusSnapshot } = await import("./config-status.js");
  const snapshot = await readConfigStatusSnapshot({ projectPath });
  return snapshot.effectiveConfig;
};

/** Re-reads the canonical bytes so the reported commit is observed, not assumed. */
function observedRevision(settlement: StoredConfigMutationSettlement): string {
  const path = settlement.appliedWrites[0]?.path;
  if (!path) {
    return settlement.committedRevision ?? "absent";
  }
  if (settlement.scope === "global") {
    return existsSync(path) ? `sha256:${hashText(readFileSync(path, "utf-8"))}` : "absent";
  }
  return revisionOf(existsSync(path) ? readFileSync(path, "utf-8") : null);
}

function toWireSettlement(settlement: StoredConfigMutationSettlement): KilnConfigMutationResult["settlement"] {
  const { restore: _restore, ...wire } = settlement;
  return wire;
}

function rejected(
  input: ApplyConfigMutationInput,
  settledAt: string,
  scope: KilnConfigMutationScope,
  diagnostics: readonly KilnConfigValidationDiagnostic[],
  proposal?: KilnConfigMutationProposal,
): KilnConfigMutationResult {
  return {
    settlement: {
      proposalId: input.proposalId,
      approvalId: input.approvalId ?? null,
      scope,
      operation: proposal?.operation ?? null,
      settledAt,
      outcome: "rejected",
      baseRevision: proposal?.baseRevision ?? "absent",
      committedRevision: null,
      appliedWrites: [],
      reconciliationEffects: [],
      diagnostics,
      rollbackToken: null,
      activation: proposal?.activation ?? ("hot" satisfies KilnConfigActivationClass),
    },
    replayed: false,
    readBackSchemaRevision: null,
    readBackVerified: false,
  };
}

function validateWritePath(input: {
  readonly projectPath: string;
  readonly globalConfigPath: string;
  readonly scope: KilnConfigMutationScope;
  readonly path: string;
}): readonly KilnConfigValidationDiagnostic[] {
  const resolvedPath = resolve(input.path);
  if (input.scope === "global") {
    return resolvedPath === resolve(input.globalConfigPath)
      ? []
      : [diagnostic(input.path, "Global mutations may only write the canonical global configuration file.")];
  }

  const projectRoot = resolve(input.projectPath);
  const canonicalRoots = [
    resolve(join(projectRoot, ".kiln", "agents")),
    resolve(join(projectRoot, ".kiln", "skills")),
  ];
  const canonicalFiles = new Set([resolve(join(projectRoot, ".kiln", "kiln.yaml"))]);
  if (!canonicalFiles.has(resolvedPath) && !canonicalRoots.some((root) => isInside(root, resolvedPath))) {
    return [diagnostic(
      input.path,
      "Project mutations may only write .kiln/agents, .kiln/skills, or .kiln/kiln.yaml canonical configuration.",
    )];
  }
  if (!isPhysicallyInsideProject(projectRoot, resolvedPath)) {
    return [diagnostic(input.path, "Refused a canonical path whose physical target escapes the project root.")];
  }
  return [];
}

function isPhysicallyInsideProject(projectRoot: string, candidate: string): boolean {
  try {
    const realProjectRoot = realpathSync(projectRoot);
    let existingAncestor = candidate;
    while (!existsSync(existingAncestor)) {
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) return false;
      existingAncestor = parent;
    }
    const realAncestor = realpathSync(existingAncestor);
    const physicalCandidate = resolve(realAncestor, relative(existingAncestor, candidate));
    return isInside(realProjectRoot, physicalCandidate);
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !/^[A-Za-z]:/.test(relativePath));
}

/**
 * The revision the canonical path will hold once this write commits. Used to
 * recognise an apply that already committed but never settled.
 */
function intendedRevision(write: ConfigMutationWrite): string {
  return write.action === "delete" ? "absent" : revisionOf(write.nextContent);
}

/**
 * Authority impact of restoring earlier state.
 *
 * Rollback is not automatically safe: restoring a profile that held `bash`
 * re-grants it. The evaluator is chosen by the operation whose state is being
 * restored, because that operation defines what the restored bytes govern.
 * Anything without a complete evaluator fails closed as `unknown`, which
 * requires approval - a whole-file restore of `.kiln/kiln.yaml` can revert
 * permission material an unrelated change made afterwards.
 */
function restoredAuthorityImpact(
  operation: KilnConfigMutationOperation | null,
  path: string,
  restoredContent: string | null,
): KilnConfigAuthorityImpact {
  switch (operation) {
    case "agent.upsert":
    case "agent.attach_skills": {
      const currentTools = existsSync(path)
        ? (parseAgentDefinitionContent(readFileSync(path, "utf-8"), "project")?.tools ?? [])
        : [];
      const restoredTools = restoredContent === null
        ? []
        : (parseAgentDefinitionContent(restoredContent, "project")?.tools ?? []);
      return agentToolAuthorityImpact(currentTools, restoredTools);
    }
    case "skill.upsert":
      // Skill content carries instructions, never a tool grant.
      return "none";
    case "preference.set":
      // The preference surface is a bounded key set with no authority material.
      return "none";
    default:
      return "unknown";
  }
}

function revisionOf(content: string | null): string {
  return content === null ? "absent" : `sha256:${hashText(content)}`;
}

function commitErrorMessage(error: unknown): string {
  if (error instanceof GlobalConfigMutationError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function diagnostic(
  field: string,
  message: string,
  severity: "error" | "warning" = "error",
): KilnConfigValidationDiagnostic {
  return { severity, field, message };
}

export type { KilnConfigReconciliationEffect, KilnConfigReconciliationTarget };
