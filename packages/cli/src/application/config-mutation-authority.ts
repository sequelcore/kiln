import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type {
  KilnConfigActivationClass,
  KilnConfigActivationObservation,
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
  type ConfigMutationReconciliationGeneration,
  type ConfigMutationRestorePoint,
  type ConfigMutationWrite,
  type StoredConfigMutationSettlement,
} from "./config-mutation-store.js";
import { reconcileConfigMutation } from "./config-mutation-reconciliation.js";
import { ConfigMutationLockUnavailableError, withConfigMutationLock } from "./config-mutation-lock.js";
import {
  type ProjectStateBinding,
  type ProjectStateRootOptions,
  resolveProjectStateBinding,
} from "./project-state-root.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "./private-project-state-filesystem.js";

/** Reads effective state after a commit. Injected so tests do not need real harness projections. */
export interface EffectiveStateReadBackPort {
  (projectPath: string): Promise<KilnEffectiveConfigSnapshot | undefined>;
}

export interface ProposeConfigMutationInput {
  readonly projectPath: string;
  readonly operation: KilnConfigMutationOperation;
  readonly payload: unknown;
  readonly globalConfigPath?: string;
  readonly projectStateBinding?: ProjectStateBinding;
  readonly kilnHome?: string;
  readonly now?: Date;
}

export interface ApproveConfigMutationInput {
  readonly projectPath: string;
  readonly proposalId: string;
  readonly approvedBy?: string;
  readonly surface?: KilnConfigMutationApproval["surface"];
  readonly projectStateBinding?: ProjectStateBinding;
  readonly kilnHome?: string;
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
  readonly projectStateBinding?: ProjectStateBinding;
  readonly kilnHome?: string;
  readonly now?: Date;
  readonly readEffectiveState?: EffectiveStateReadBackPort;
  readonly reconcile?: typeof reconcileConfigMutation;
}

/**
 * Builds a validated proposal without writing canonical configuration.
 *
 * Identity is derived from scope, operation, normalized payload, target path,
 * proposed content, base revision, and creation instant. Apply retries reuse
 * the stored proposal id; a later decision to apply the same intent after a
 * rollback receives a new identity rather than replaying an obsolete outcome.
 */
export function proposeConfigMutation(input: ProposeConfigMutationInput): ConfigMutationProposalRecord {
  const globalConfigPath = input.globalConfigPath ?? resolveGlobalConfigPath();
  const projectStateBinding = resolveMutationBinding(input.projectPath, input);
  const createdAt = (input.now ?? new Date()).toISOString();

  const resolution = input.operation === "mutation.rollback"
    ? resolveRollbackMutation(input.projectPath, input.payload, globalConfigPath, projectStateBinding)
    : {
        normalized: normalizeConfigMutation(
          input.operation,
          { projectPath: input.projectPath, globalConfigPath, projectStateBinding },
          input.payload,
        ),
      };

  const normalized = resolution.normalized;
  const diagnostics: KilnConfigValidationDiagnostic[] = [...normalized.diagnostics];
  diagnostics.push(...validateWritePath({
    globalConfigPath,
    scope: normalized.scope,
    operation: input.operation,
    path: normalized.path,
    projectStateRoot: projectStateBinding.projectStateRoot,
  }));

  const previousContent = existsSync(normalized.path) ? readFileSync(normalized.path, "utf-8") : null;
  const baseRevision = revisionOf(previousContent);
  const expectedRevision = input.operation === "setting.set" || input.operation === "setting.reset"
    ? expectedRevisionFromPayload(input.payload)
    : { present: false } as const;
  if (expectedRevision.present && expectedRevision.value !== baseRevision) {
    diagnostics.push({
      severity: "error",
      field: "expectedRevision",
      message: "Configuration changed after the settings snapshot was loaded. Refresh and propose again.",
    });
  }
  const status = diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "invalid" : "valid";
  const removesPath = resolution.removesPath === true;

  const proposalSeed = {
    scope: normalized.scope,
    operation: input.operation,
    payload: normalized.payload,
    path: normalized.path,
    nextContent: removesPath ? null : normalized.nextContent,
    baseRevision,
    createdAt,
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
    recordVersion: 2,
    proposal,
    proposalHash: hashStable({
      proposal,
      writes: writes.map((write) => ({ path: write.path, previousHash: write.previousHash, nextHash: write.nextHash })),
    }),
    writes,
  };
}

function expectedRevisionFromPayload(payload: unknown):
  | { readonly present: false }
  | { readonly present: true; readonly value: unknown } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !Object.prototype.hasOwnProperty.call(payload, "expectedRevision")) {
    return { present: false };
  }
  return { present: true, value: (payload as Record<string, unknown>).expectedRevision };
}

/**
 * Records durable operator approval for one exact proposal. The approval binds
 * the proposal hash, so an edited proposal can never reuse it.
 */
export function approveConfigMutation(input: ApproveConfigMutationInput): KilnConfigMutationApproval {
  const binding = resolveMutationBinding(input.projectPath, input);
  const store = mutationStore(input.projectPath, binding);
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
  const attemptedAt = (input.now ?? new Date()).toISOString();
  const globalConfigPath = input.globalConfigPath ?? resolveGlobalConfigPath();
  const projectStateBinding = resolveMutationBinding(input.projectPath, input);
  const store = mutationStore(input.projectPath, projectStateBinding, globalConfigPath);

  const record = store.readProposal(input.proposalId);
  if (!record) {
    return rejected(input, attemptedAt, "project", [diagnostic("proposalId", "Config proposal not found.")]);
  }
  const existingSettlement = store.readSettlement(input.proposalId);
  if (existingSettlement) {
    const replayDiagnostics = checkReplayAuthorization(store, record, existingSettlement, input.approvalId, input.requester);
    const write = record.writes[0];
    if (!write) replayDiagnostics.push(diagnostic("write", "Settled config proposal carries no canonical write."));
    if (write) {
      const currentContent = existsSync(write.path) ? readFileSync(write.path, "utf-8") : null;
      if (revisionOf(currentContent) !== existingSettlement.committedRevision) {
        replayDiagnostics.push(diagnostic(write.path, "The settled proposal is no longer the effective canonical revision; create a new proposal."));
      }
    }
    if (replayDiagnostics.length > 0) {
      return rejected(input, attemptedAt, record.proposal.scope, replayDiagnostics, record.proposal);
    }
    // A crash can occur after terminal publication but before marker cleanup.
    // Terminal settlement is authoritative, so replay may safely retire it.
    store.clearProgressMarker(input.proposalId);
    return await withReadBack(input, existingSettlement, true);
  }
  const proposal = record.proposal;
  if (proposal.status !== "valid") {
    return rejected(input, attemptedAt, proposal.scope, [diagnostic("proposal", "Only valid config proposals can be applied.")], proposal);
  }

  const reconciliationTargets = resolvePersistedReconciliationTargets(proposal.reconciliationTargets);
  if (reconciliationTargets === null) {
    return rejected(input, attemptedAt, proposal.scope, [diagnostic(
      "reconciliationTargets",
      "The stored proposal contains an unsupported reconciliation target; create a new proposal.",
    )], proposal);
  }

  const approvalDiagnostics = checkApproval(store, record, input.approvalId, input.requester);
  if (approvalDiagnostics.length > 0) {
    return rejected(input, attemptedAt, proposal.scope, approvalDiagnostics, proposal);
  }

  const pathDiagnostics = validateWritePath({
    globalConfigPath,
    scope: proposal.scope,
    operation: proposal.operation,
    path: record.writes[0]?.path ?? "",
    projectStateRoot: projectStateBinding.projectStateRoot,
  });
  if (pathDiagnostics.length > 0) {
    return rejected(input, attemptedAt, proposal.scope, pathDiagnostics, proposal);
  }

  const write = record.writes[0];
  if (!write) {
    return rejected(input, attemptedAt, proposal.scope, [diagnostic("write", "Valid proposal carries no canonical write.")], proposal);
  }

  try {
    // The existing path lock owns the complete commit/reconcile/settle window.
    // A second recovery attempt fails closed instead of publishing a competing
    // reconciliation result for the same canonical revision.
    const lockPath = store.lockPathFor(write.path);
    return await withConfigMutationLock(lockPath, async () => {
      let commitOutcome: CommitOutcome;
      try {
        const currentContent = existsSync(write.path) ? readFileSync(write.path, "utf-8") : null;
        const currentRevision = revisionOf(currentContent);
        const marker = store.readProgressMarker(proposal.proposalId);
        const interruptedForPath = store.readInterruptedMutationForPath(write.path);
        if (interruptedForPath !== null
          && interruptedForPath.record.proposal.proposalId !== proposal.proposalId) {
          return rejected(input, attemptedAt, proposal.scope, [diagnostic(
            "proposalId",
            "An interrupted configuration mutation must be resumed before a new proposal can apply.",
          )], proposal);
        }
        const interrupted = marker !== null
          && marker.path === write.path
          && currentRevision === marker.intendedRevision;

        if (interrupted) {
          // This exact proposal entered its commit window and the canonical path
          // already holds the content it intended. Resume settlement rather than
          // rejecting a change that did land.
          commitOutcome = { appliedWrites: appliedWritesFor(write), committedRevision: currentRevision };
        } else if (currentRevision !== proposal.baseRevision) {
          return rejected(input, attemptedAt, proposal.scope, [diagnostic(
            write.path,
            "Config proposal is stale; the canonical revision changed after the proposal was created.",
          )], proposal);
        } else {
          store.writeProgressMarker({
            proposalId: proposal.proposalId,
            path: write.path,
            intendedRevision: intendedRevision(write),
            startedAt: attemptedAt,
          });
          commitOutcome = proposal.scope === "global" && resolve(write.path) === resolve(globalConfigPath)
            ? commitGlobalWrite(record.writes, proposal.baseRevision)
            : commitProjectWrites(record.writes, projectStateBinding.projectStateRoot);
        }
      } catch (error) {
        return rejected(input, attemptedAt, proposal.scope, [diagnostic("write", commitErrorMessage(error))], proposal);
      }

      const { appliedWrites, committedRevision } = commitOutcome;
      const recoveryDiagnostics: readonly KilnConfigValidationDiagnostic[] = commitOutcome.invalidBackupPath
        ? [diagnostic("configuration", `Previous invalid configuration backed up to ${commitOutcome.invalidBackupPath}`, "warning")]
        : [];
      const reconcile = input.reconcile
        ?? ((projectPath: string, targets: readonly KilnConfigReconciliationTarget[]) =>
          reconcileConfigMutation(projectPath, targets, { projectStateBinding }));
      const reconciliationOutcomes = await reconcile(input.projectPath, reconciliationTargets);
      const reconciliationEffects = reconciliationOutcomes.map(({ generation: _generation, ...effect }) => effect);
      const reconciliationGenerations = reconciliationOutcomes.flatMap((effect) =>
        effect.status === "ok" && effect.generation !== undefined
          ? [{ target: effect.target, generation: effect.generation } satisfies ConfigMutationReconciliationGeneration]
          : []);
      const settledAt = nextSettlementTime(store, write.path, input.now ?? new Date());
      const approval = input.approvalId ? store.readApproval(input.approvalId) : null;

      const reconciliationState = reconciliationEffects.some((effect) => effect.status === "failed")
        ? "failed"
        : reconciliationEffects.some((effect) => effect.status === "skipped")
          ? "superseded"
          : "converged";
      const readBackSnapshot = await readEffectiveState(input);
      const readBackVerified = readBackSnapshot !== undefined && observedRevision({
        appliedWrites,
        scope: proposal.scope,
        committedRevision,
      }) === committedRevision;
      const activationObservation = observeActivation(
        proposal.activation,
        committedRevision,
        reconciliationState,
        readBackVerified,
      );
      const settlement = store.settle({
        proposalId: proposal.proposalId,
        approvalId: input.approvalId ?? null,
        scope: proposal.scope,
        operation: proposal.operation,
        settledAt,
        outcome: reconciliationState === "failed" ? "committed-reconciliation-failed" : "committed",
        baseRevision: proposal.baseRevision,
        committedRevision,
        appliedWrites,
        reconciliationEffects,
        diagnostics: [
          ...recoveryDiagnostics,
          ...reconciliationEffects.flatMap((effect) => effect.errors.map((error) => diagnostic(effect.target, error, "warning"))),
        ],
        rollbackToken: proposal.proposalId,
        activation: proposal.activation,
        activationObservation,
        reconciliationGenerations,
        restore: record.writes.map((write): ConfigMutationRestorePoint => ({
          path: write.path,
          previousContent: write.previousContent,
        })),
      });
      if (approval && approval.status === "approved") {
        store.markApprovalConsumed(approval, settledAt);
      }
      store.clearProgressMarker(proposal.proposalId);
      return withReadBackSnapshot(settlement, false, readBackSnapshot);
    }, proposal.scope === "project"
      ? { privateStateRoot: projectStateBinding.projectStateRoot }
      : undefined);
  } catch (error) {
    if (error instanceof ConfigMutationLockUnavailableError) {
      return rejected(input, attemptedAt, proposal.scope, [diagnostic("write", commitErrorMessage(error))], proposal);
    }
    throw error;
  }
}

interface CommitOutcome {
  readonly appliedWrites: readonly KilnConfigAppliedWrite[];
  readonly committedRevision: string;
  /** Set when an unreadable configuration was retained before being replaced. */
  readonly invalidBackupPath?: string;
}

function resolvePersistedReconciliationTargets(
  observed: readonly KilnConfigReconciliationTarget[],
): readonly KilnConfigReconciliationTarget[] | null {
  const current = new Set<KilnConfigReconciliationTarget>([
    "native-agents",
    "native-skills",
    "native-permissions",
    "workflow-snapshot",
    "execution-targets",
  ]);
  const resolved: KilnConfigReconciliationTarget[] = [];
  for (const value of observed as readonly unknown[]) {
    if (typeof value !== "string" || !current.has(value as KilnConfigReconciliationTarget)) {
      return null;
    }
    if (!resolved.includes(value as KilnConfigReconciliationTarget)) {
      resolved.push(value as KilnConfigReconciliationTarget);
    }
  }
  return resolved;
}

type MutationBindingInput = ProjectStateRootOptions & {
  readonly projectStateBinding?: ProjectStateBinding;
};

function resolveMutationBinding(
  projectPath: string,
  input: MutationBindingInput,
): ProjectStateBinding {
  return input.projectStateBinding ?? resolveProjectStateBinding(projectPath, input);
}

function mutationStore(
  projectPath: string,
  binding: ProjectStateBinding,
  globalConfigPath = resolveGlobalConfigPath(),
): ConfigMutationStore {
  return new ConfigMutationStore(projectPath, {
    root: binding.mutationsPath,
    globalConfigPath,
  });
}

/** Keeps operation settlements totally ordered even when a deterministic test clock is reused. */
function nextSettlementTime(
  store: ConfigMutationStore,
  canonicalPath: string,
  candidate: Date,
): string {
  const latest = store.readLatestSettlementForPath(canonicalPath);
  const latestTime = latest === null ? Number.NEGATIVE_INFINITY : Date.parse(latest.settledAt);
  return new Date(Math.max(candidate.getTime(), latestTime + 1)).toISOString();
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
  binding: ProjectStateBinding,
): { readonly normalized: NormalizedConfigMutation; readonly removesPath?: boolean } {
  const token = typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>).token
    : undefined;
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  if (typeof token !== "string" || token.trim().length === 0) {
    diagnostics.push(diagnostic("token", "Rollback requires the rollbackToken of a committed mutation."));
    return { normalized: invalidRollback(globalConfigPath, diagnostics) };
  }

  const settlement = mutationStore(projectPath, binding, globalConfigPath).readSettlement(token.trim());
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

function checkReplayAuthorization(
  store: ConfigMutationStore,
  record: ConfigMutationProposalRecord,
  settlement: StoredConfigMutationSettlement,
  approvalId: string | undefined,
  requester: ConfigMutationRequester,
): KilnConfigValidationDiagnostic[] {
  const requiresApproval = requester === "model" || record.proposal.approvalRequired;
  if (!approvalId) {
    return requiresApproval
      ? [diagnostic("approvalId", "Replaying this configuration settlement requires its matching operator approval.")]
      : [];
  }
  if (settlement.approvalId !== approvalId) {
    return [diagnostic("approvalId", "Config approval does not match the durable settlement.")];
  }
  const approval = store.readApproval(approvalId);
  if (!approval
    || approval.proposalId !== record.proposal.proposalId
    || approval.proposalHash !== record.proposalHash) {
    return [diagnostic("approvalId", "Config approval does not match the stored proposal.")];
  }
  return [];
}

/** Project writes replace canonical files through a temporary file so a failure cannot leave a partial file. */
function commitProjectWrites(
  writes: readonly ConfigMutationWrite[],
  projectStateRoot: string,
): {
  readonly appliedWrites: readonly KilnConfigAppliedWrite[];
  readonly committedRevision: string;
} {
  const appliedWrites: KilnConfigAppliedWrite[] = [];
  let committedRevision = "absent";
  for (const write of writes) {
    const isPrivateStateWrite = isInside(resolve(projectStateRoot), resolve(write.path));
    if (write.action === "delete") {
      if (isPrivateStateWrite) {
        assertPrivateStateFileTargetSync(projectStateRoot, write.path);
      }
      if (existsSync(write.path)) {
        unlinkSync(write.path);
      }
      appliedWrites.push({ path: write.path, previousHash: write.previousHash, nextHash: "" });
      committedRevision = "absent";
      continue;
    }
    if (isPrivateStateWrite) {
      ensurePrivateStateDirectorySync(projectStateRoot, dirname(write.path));
    } else {
      mkdirSync(dirname(write.path), { recursive: true });
    }
    const temporaryPath = `${write.path}.${process.pid}.tmp`;
    try {
      if (isPrivateStateWrite) {
        assertPrivateStateFileTargetSync(projectStateRoot, write.path);
        assertPrivateStateFileTargetSync(projectStateRoot, temporaryPath);
      }
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
  readonly invalidBackupPath?: string;
} {
  const write = writes[0];
  if (!write) {
    return { appliedWrites: [], committedRevision: baseRevision };
  }
  if (write.action === "delete") {
    throw new Error("Global configuration cannot be removed by a mutation; adoption owns its lifecycle.");
  }
  const result = commitGlobalConfigBytes({
    content: write.nextContent,
    expectedRevision: baseRevision,
  });
  return {
    appliedWrites: [{ path: write.path, previousHash: write.previousHash, nextHash: write.nextHash }],
    committedRevision: result.revision,
    ...(result.invalidBackupPath === undefined ? {} : { invalidBackupPath: result.invalidBackupPath }),
  };
}

async function withReadBack(
  input: ApplyConfigMutationInput,
  settlement: StoredConfigMutationSettlement,
  replayed: boolean,
): Promise<KilnConfigMutationResult> {
  const snapshot = await readEffectiveState(input);
  return withReadBackSnapshot(settlement, replayed, snapshot);
}

function withReadBackSnapshot(
  settlement: StoredConfigMutationSettlement,
  replayed: boolean,
  snapshot: KilnEffectiveConfigSnapshot | undefined,
): KilnConfigMutationResult {
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
  const snapshot = await readConfigStatusSnapshot({ projectPath, view: "effective" });
  return snapshot.effectiveConfig;
};

/** Re-reads the canonical bytes so the reported commit is observed, not assumed. */
function observedRevision(settlement: Pick<StoredConfigMutationSettlement, "appliedWrites" | "scope" | "committedRevision">): string {
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
  const { restore: _restore, reconciliationGenerations: _reconciliationGenerations, ...wire } = settlement;
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
      activationObservation: {
        state: "not-started",
        boundary: proposal?.activation ?? ("hot" satisfies KilnConfigActivationClass),
        committedRevision: null,
        activeRevision: null,
        summary: "Configuration was not committed.",
      },
    },
    replayed: false,
    readBackSchemaRevision: null,
    readBackVerified: false,
  };
}

function observeActivation(
  activation: KilnConfigActivationClass,
  committedRevision: string,
  reconciliationState: "converged" | "failed" | "superseded",
  readBackVerified: boolean,
): KilnConfigActivationObservation {
  if (reconciliationState === "failed") {
    return {
      state: "failed",
      boundary: activation,
      committedRevision,
      activeRevision: null,
      summary: "Canonical configuration committed, but activation did not converge.",
    };
  }
  if (reconciliationState === "superseded") {
    return {
      state: "superseded",
      boundary: activation,
      committedRevision,
      activeRevision: null,
      summary: "A newer canonical revision superseded this activation attempt.",
    };
  }
  switch (activation) {
    case "hot":
      return readBackVerified
        ? {
            state: "active",
            boundary: activation,
            committedRevision,
            activeRevision: committedRevision,
            summary: "The committed revision is active immediately.",
          }
        : {
            state: "failed",
            boundary: activation,
            committedRevision,
            activeRevision: null,
            summary: "Canonical configuration committed, but owner read-back did not prove hot activation.",
          };
    case "next-turn":
      return {
        state: "scheduled",
        boundary: activation,
        committedRevision,
        activeRevision: null,
        summary: "The committed revision activates at the next turn boundary.",
      };
    case "next-session":
      return {
        state: "scheduled",
        boundary: activation,
        committedRevision,
        activeRevision: null,
        summary: "The committed revision activates at the next session boundary.",
      };
    case "reconcile":
      return {
        state: "active",
        boundary: activation,
        committedRevision,
        activeRevision: committedRevision,
        summary: "Owned projections converged on the committed revision.",
      };
    case "restart-required":
      return {
        state: "unsupported",
        boundary: activation,
        committedRevision,
        activeRevision: null,
        summary: "No admitted restart-required configuration owner is available.",
      };
  }
}

function validateWritePath(input: {
  readonly globalConfigPath: string;
  readonly projectStateRoot: string;
  readonly scope: KilnConfigMutationScope;
  readonly operation: KilnConfigMutationOperation | null;
  readonly path: string;
}): readonly KilnConfigValidationDiagnostic[] {
  const resolvedPath = resolve(input.path);
  if (input.scope === "global") {
    if (resolvedPath === resolve(input.globalConfigPath)) return [];
    const globalRoot = resolve(dirname(input.globalConfigPath));
    const userSkillsRoot = resolve(join(globalRoot, "skills"));
    if ((input.operation === "skill.upsert" || input.operation === "mutation.rollback")
      && isInside(userSkillsRoot, resolvedPath)) {
      if (!isPhysicallyInsideRoot(globalRoot, resolvedPath)) {
        return [diagnostic(input.path, "Refused a user skill path whose physical target escapes the global Kiln root.")];
      }
      return [];
    }
    return [diagnostic(input.path, "Global mutations may only write the canonical global configuration file or user-owned skills.")];
  }

  const projectRoot = resolve(input.projectStateRoot);
  const canonicalRoots = [
    resolve(join(projectRoot, "agents")),
    resolve(join(projectRoot, "skills")),
  ];
  const canonicalFiles = new Set([resolve(join(projectRoot, "config.yaml"))]);
  if (!canonicalFiles.has(resolvedPath) && !canonicalRoots.some((root) => isInside(root, resolvedPath))) {
    return [diagnostic(
      input.path,
      "Project mutations may only write private agents, skills, or config.yaml canonical state.",
    )];
  }
  if (!isPhysicallyInsideRoot(projectRoot, resolvedPath)) {
    return [diagnostic(input.path, "Refused a canonical path whose physical target escapes private project state.")];
  }
  return [];
}

function isPhysicallyInsideRoot(projectRoot: string, candidate: string): boolean {
  try {
    let existingRoot = projectRoot;
    while (!existsSync(existingRoot)) {
      const parent = dirname(existingRoot);
      if (parent === existingRoot) return false;
      existingRoot = parent;
    }
    const realRootAncestor = realpathSync(existingRoot);
    const physicalRoot = resolve(realRootAncestor, relative(existingRoot, projectRoot));
    let existingAncestor = candidate;
    while (!existsSync(existingAncestor)) {
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) return false;
      existingAncestor = parent;
    }
    const realAncestor = realpathSync(existingAncestor);
    const physicalCandidate = resolve(realAncestor, relative(existingAncestor, candidate));
    return isInside(physicalRoot, physicalCandidate);
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
 * requires approval - a whole-file restore of private project config can revert
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
    case "setting.set":
      // Restoring a settings document reverts whatever that key governs, and a
      // whole-file restore can also revert unrelated authority material written
      // afterwards, so this fails closed.
      return "unknown";
    case "setting.reset":
      return "unknown";
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
