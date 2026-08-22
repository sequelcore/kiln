import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import type {
  KilnConfigMutationApproval,
  KilnConfigMutationOperation,
  KilnConfigMutationProposal,
  KilnConfigReconciliationTarget,
  KilnConfigMutationSettlement,
} from "@kilnai/gateway-contracts";

/** Exact prior bytes for one canonical path, retained so rollback restores state rather than prose. */
export interface ConfigMutationRestorePoint {
  readonly path: string;
  /** Null when the path did not exist before the mutation; rollback then removes it. */
  readonly previousContent: string | null;
}

export interface ConfigMutationProposalRecord {
  /** Missing only on pre-keyed-reset records retained for honest crash recovery. */
  readonly recordVersion?: 2;
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
  /** Stable generation evidence captured by the reconciliation owner. */
  readonly reconciliationGenerations?: readonly ConfigMutationReconciliationGeneration[];
}

export interface ConfigMutationReconciliationGeneration {
  readonly target: KilnConfigReconciliationTarget;
  readonly generation: `sha256:${string}`;
}

const RECONCILIATION_TARGETS = [
  "native-agents",
  "native-skills",
  "native-permissions",
  "repo-shims",
  "execution-routes",
] as const;

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

export interface InterruptedConfigMutation {
  readonly record: ConfigMutationProposalRecord;
  readonly marker: ConfigMutationProgressMarker;
  readonly approvalId?: string;
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
  private readonly base: string;
  private readonly root: string;
  private readonly globalConfigPath: string;
  /** Stable non-path identity used to qualify project-specific global evidence. */
  readonly projectIdentity: string;

  constructor(projectPath: string, options?: { readonly root?: string; readonly globalConfigPath?: string }) {
    const base = options?.root ?? join(dirname(resolveGlobalConfigPath()), "mutations", "config");
    this.base = base;
    this.root = join(base, projectNamespace(projectPath));
    this.globalConfigPath = options?.globalConfigPath ?? resolveGlobalConfigPath();
    this.projectIdentity = projectNamespace(projectPath);
  }

  /** Lock file guarding the commit window for one canonical path. */
  lockPathFor(canonicalPath: string): string {
    return join(this.isGlobalPath(canonicalPath) ? this.base : this.root, "locks", `${hashPath(canonicalPath)}.lock`);
  }

  /** Cross-process lock for one owned reconciliation target. */
  reconciliationLockPathFor(target: string): string {
    return join(this.root, "reconciliation-locks", `${hashPath(target)}.lock`);
  }

  /** Lock shared user-home projection outputs across every project namespace. */
  globalReconciliationLockPathFor(target: string): string {
    return join(this.base, "reconciliation-locks-global", `${hashPath(target)}.lock`);
  }

  readProgressMarker(proposalId: string): ConfigMutationProgressMarker | null {
    return readJson<ConfigMutationProgressMarker>(this.markerPath(proposalId))
      ?? readJson<ConfigMutationProgressMarker>(this.globalMarkerPath(proposalId));
  }

  writeProgressMarker(marker: ConfigMutationProgressMarker): void {
    writeJson(this.markerPathFor(marker.path, marker.proposalId), marker);
  }

  clearProgressMarker(proposalId: string): void {
    rmSync(this.markerPath(proposalId), { force: true });
    rmSync(this.globalMarkerPath(proposalId), { force: true });
  }

  /** Whether an operation has entered its commit window without settling yet. */
  hasActiveProgress(operation: KilnConfigMutationOperation): boolean {
    return this.readInterruptedMutation(operation) !== null;
  }

  /** Exact proposal and approval whose commit window was interrupted. */
  readInterruptedMutation(operation: KilnConfigMutationOperation): InterruptedConfigMutation | null {
    return this.readInterruptedMutationMatching({ operation }, `operation ${operation}`);
  }

  /** Any unresolved proposal that owns the commit window for this canonical path. */
  readInterruptedMutationForPath(canonicalPath: string): InterruptedConfigMutation | null {
    return this.readInterruptedMutationMatching({ canonicalPath }, "canonical path");
  }

  private readInterruptedMutationMatching(
    filter: { readonly operation?: KilnConfigMutationOperation; readonly canonicalPath?: string },
    description: string,
  ): InterruptedConfigMutation | null {
    const candidates = [join(this.root, "in-progress"), join(this.base, "in-progress-global")]
      .flatMap((directory) => !existsSync(directory) ? [] : readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readJson<ConfigMutationProgressMarker>(join(directory, entry.name))))
      .flatMap((marker) => {
        if (marker === null || this.readSettlement(marker.proposalId) !== null) return [];
        const record = this.readProposal(marker.proposalId);
        if (record === null) return [];
        if (filter.operation !== undefined && record.proposal.operation !== filter.operation) return [];
        if (filter.canonicalPath !== undefined && !samePath(marker.path, filter.canonicalPath)) return [];
        return [{ marker, record }];
      })
      .sort((left, right) => left.marker.startedAt.localeCompare(right.marker.startedAt)
        || left.marker.proposalId.localeCompare(right.marker.proposalId));
    if (candidates.length > 1) {
      throw new Error(`Multiple interrupted configuration mutations exist for ${description}.`);
    }
    const interrupted = candidates[0];
    if (!interrupted) return null;
    const approval = this.readApprovalForProposal(interrupted.record);
    return {
      ...interrupted,
      ...(approval === null ? {} : { approvalId: approval.approvalId }),
    };
  }

  saveProposal(record: ConfigMutationProposalRecord): void {
    writeJson(this.proposalPath(record.proposal.proposalId), record);
  }

  readProposal(proposalId: string): ConfigMutationProposalRecord | null {
    const candidate = readJson<unknown>(this.proposalPath(proposalId));
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const record = candidate as Partial<ConfigMutationProposalRecord>;
    if (!record.proposal
      || typeof record.proposal !== "object"
      || typeof record.proposalHash !== "string"
      || !Array.isArray(record.writes)) return null;
    return record as ConfigMutationProposalRecord;
  }

  saveApproval(approval: StoredConfigMutationApproval): void {
    writeJson(this.approvalPath(approval.approvalId), approval);
  }

  readApproval(approvalId: string): StoredConfigMutationApproval | null {
    return readJson<StoredConfigMutationApproval>(this.approvalPath(approvalId));
  }

  private readApprovalForProposal(record: ConfigMutationProposalRecord): StoredConfigMutationApproval | null {
    const directory = join(this.root, "approvals");
    if (!existsSync(directory)) return null;
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<StoredConfigMutationApproval>(join(directory, entry.name)))
      .filter((approval): approval is StoredConfigMutationApproval => approval !== null
        && approval.proposalId === record.proposal.proposalId
        && approval.proposalHash === record.proposalHash
        && approval.status === "approved")
      .sort((left, right) => left.approvedAt.localeCompare(right.approvedAt) || left.approvalId.localeCompare(right.approvalId))
      .at(-1) ?? null;
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
    return normalizeStoredConfigMutationSettlement(readJson<unknown>(this.projectSettlementPath(proposalId)))
      ?? normalizeStoredConfigMutationSettlement(readJson<unknown>(this.globalSettlementPath(proposalId)))
      // Read pre-qualification records only for replay; status projection uses
      // the project-qualified directory and therefore fails closed for them.
      ?? normalizeStoredConfigMutationSettlement(readJson<unknown>(this.legacyGlobalSettlementPath(proposalId)));
  }

  /** Latest durable outcome for one operation in this project namespace. */
  readLatestSettlement(operation: KilnConfigMutationOperation): StoredConfigMutationSettlement | null {
    const directory = join(this.root, "settlements");
    if (!existsSync(directory)) return null;
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => normalizeStoredConfigMutationSettlement(readJson<unknown>(join(directory, entry.name))))
      .filter((settlement): settlement is StoredConfigMutationSettlement => settlement?.operation === operation)
      .sort((left, right) => left.settledAt.localeCompare(right.settledAt) || left.proposalId.localeCompare(right.proposalId))
      .at(-1) ?? null;
  }

  /**
   * Latest immutable settlement for one canonical path and committed revision.
   * The path fence is the ordering boundary; operation timestamps from another
   * canonical path must never win this query.
   */
  readLatestSettlementForPath(
    canonicalPath: string,
    committedRevision?: string,
  ): StoredConfigMutationSettlement | null {
    const directories = this.settlementDirectoriesForPath(canonicalPath);
    const latest = directories.flatMap((directory) => !existsSync(directory) ? [] : readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => normalizeStoredConfigMutationSettlement(readJson<unknown>(join(directory, entry.name)))))
      .filter((settlement): settlement is StoredConfigMutationSettlement => settlement !== null
        && settlement.appliedWrites.some((write) => samePath(write.path, canonicalPath)))
      .sort((left, right) => left.settledAt.localeCompare(right.settledAt) || left.proposalId.localeCompare(right.proposalId))
      .at(-1) ?? null;
    // The newest settlement for this path is the ordering fence. Only after
    // selecting it may the current bytes qualify as that settlement's
    // committed revision; otherwise an old A record could resurrect after an
    // ungoverned A -> B -> A byte change.
    return latest !== null
      && (committedRevision === undefined || latest.committedRevision === committedRevision)
      ? latest
      : null;
  }

  /** Reads the immutable terminal settlements relevant to this project. */
  readSettlements(): readonly StoredConfigMutationSettlement[] {
    const records = [
      ...readSettlementDirectory(join(this.root, "settlements")),
      // A global settlement is also the evidence for the project-specific
      // native projection produced while that project held reconciliation.
      // Only that project namespace may use it for activation status.
      ...readSettlementDirectory(this.globalSettlementDirectory()),
    ];
    const byProposal = new Map<string, StoredConfigMutationSettlement>();
    for (const settlement of records) {
      const previous = byProposal.get(settlement.proposalId);
      if (!previous || previous.settledAt.localeCompare(settlement.settledAt) < 0) {
        byProposal.set(settlement.proposalId, settlement);
      }
    }
    return [...byProposal.values()].sort((left, right) =>
      left.settledAt.localeCompare(right.settledAt) || left.proposalId.localeCompare(right.proposalId));
  }

  /** Reads unresolved commit markers without treating canonical bytes as proof of completion. */
  readProgressMarkers(): readonly ConfigMutationProgressMarker[] {
    return [join(this.root, "in-progress"), join(this.base, "in-progress-global")]
      .flatMap((directory) => !existsSync(directory) ? [] : readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readJson<ConfigMutationProgressMarker>(join(directory, entry.name))))
      .filter((marker): marker is ConfigMutationProgressMarker => marker !== null)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.proposalId.localeCompare(right.proposalId));
  }

  /** Reads proposals only to name the activation boundary for an in-flight marker. */
  readProposals(): readonly ConfigMutationProposalRecord[] {
    const directory = join(this.root, "proposals");
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<ConfigMutationProposalRecord>(join(directory, entry.name)))
      .filter((record): record is ConfigMutationProposalRecord => record !== null)
      .sort((left, right) => left.proposal.createdAt.localeCompare(right.proposal.createdAt)
        || left.proposal.proposalId.localeCompare(right.proposal.proposalId));
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
    const normalized = normalizeStoredConfigMutationSettlement(settlement);
    if (normalized === null) {
      throw new TypeError("Config mutation settlement has invalid activation observation evidence.");
    }
    const path = settlement.scope === "global"
      ? this.globalSettlementPath(settlement.proposalId)
      : this.projectSettlementPath(settlement.proposalId);
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), "utf-8");
      linkSync(temporaryPath, path);
      return normalized;
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

  private projectSettlementPath(proposalId: string): string {
    return join(this.root, "settlements", `${safeId(proposalId)}.json`);
  }

  private globalSettlementPath(proposalId: string): string {
    return join(this.globalSettlementDirectory(), `${safeId(proposalId)}.json`);
  }

  private legacyGlobalSettlementPath(proposalId: string): string {
    return join(this.base, "settlements-global", `${safeId(proposalId)}.json`);
  }

  private globalSettlementDirectory(): string {
    return join(this.base, "settlements-global", this.projectIdentity);
  }

  private settlementDirectoriesForPath(canonicalPath: string): readonly string[] {
    if (!this.isGlobalPath(canonicalPath)) return [join(this.root, "settlements")];
    const root = join(this.base, "settlements-global");
    if (!existsSync(root)) return [root];
    const namespaces = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
    return [...namespaces, root];
  }

  private isGlobalPath(canonicalPath: string): boolean {
    return samePath(canonicalPath, this.globalConfigPath);
  }

  private markerPath(proposalId: string): string {
    return join(this.root, "in-progress", `${safeId(proposalId)}.json`);
  }

  private globalMarkerPath(proposalId: string): string {
    return join(this.base, "in-progress-global", `${safeId(proposalId)}.json`);
  }

  private markerPathFor(canonicalPath: string, proposalId: string): string {
    return this.isGlobalPath(canonicalPath) ? this.globalMarkerPath(proposalId) : this.markerPath(proposalId);
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

function readSettlementDirectory(directory: string): readonly StoredConfigMutationSettlement[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => normalizeStoredConfigMutationSettlement(readJson<unknown>(join(directory, entry.name))))
    .filter((settlement): settlement is StoredConfigMutationSettlement => settlement !== null);
}

/**
 * Read-normalize settlements written before activation observation became a
 * required part of the terminal contract. Historical records cannot prove
 * activation from a committed revision or its hash, so they are explicitly
 * projected as unsupported rather than reported active. The durable terminal
 * record remains immutable; normalization is only a compatibility read at the
 * one existing store boundary.
 */
function normalizeStoredConfigMutationSettlement(value: unknown): StoredConfigMutationSettlement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const settlement = value as Partial<StoredConfigMutationSettlement>;
  if (settlement.reconciliationGenerations !== undefined) {
    if (!Array.isArray(settlement.reconciliationGenerations)) return null;
    const generations = settlement.reconciliationGenerations;
    if (generations.some((entry) => !isReconciliationGeneration(entry))) return null;
  }
  if (settlement.activationObservation !== undefined) {
    return isValidActivationObservation(settlement)
      ? settlement as StoredConfigMutationSettlement
      : null;
  }

  const committedRevision = settlement.committedRevision;
  if (committedRevision !== null
    && committedRevision !== "absent"
    && (typeof committedRevision !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(committedRevision))) {
    return null;
  }
  const activation = settlement.activation === "hot"
    || settlement.activation === "next-turn"
    || settlement.activation === "next-session"
    || settlement.activation === "reconcile"
    || settlement.activation === "restart-required"
    ? settlement.activation
    : "restart-required";

  if (committedRevision === null) {
    return {
      ...settlement,
      activation,
      activationObservation: {
        state: "not-started",
        boundary: activation,
        committedRevision: null,
        activeRevision: null,
        summary: "Historical settlement lacks activation evidence; activation is unproven.",
      },
    } as StoredConfigMutationSettlement;
  }
  return {
    ...settlement,
    activation,
    activationObservation: {
      state: "unsupported",
      boundary: activation,
      committedRevision,
      activeRevision: null,
      summary: "Historical settlement lacks activation evidence; activation is unproven.",
    },
  } as StoredConfigMutationSettlement;
}

function isValidActivationObservation(
  settlement: Partial<StoredConfigMutationSettlement>,
): boolean {
  const observation = settlement.activationObservation;
  if (!isRecord(observation) || !isActivationClass(settlement.activation)
    || !isSettlementRevision(settlement.committedRevision)
    || observation.boundary !== settlement.activation
    || observation.committedRevision !== settlement.committedRevision
    || typeof observation.summary !== "string" || observation.summary.trim().length === 0) return false;
  const allowed = ["state", "boundary", "committedRevision", "activeRevision", "summary"];
  if (Object.keys(observation).some((key) => !allowed.includes(key))) return false;
  if (observation.state === "not-started") {
    return observation.committedRevision === null && observation.activeRevision === null;
  }
  if (observation.state !== "active" && observation.state !== "scheduled"
    && observation.state !== "failed" && observation.state !== "superseded"
    && observation.state !== "unsupported") return false;
  if (!isSettlementRevision(observation.committedRevision) || observation.committedRevision === null) return false;
  if (observation.state === "active") {
    return (observation.boundary === "hot" || observation.boundary === "reconcile")
      && settlement.outcome === "committed"
      && isSettlementRevision(observation.activeRevision)
      && observation.activeRevision === observation.committedRevision;
  }
  if (observation.state === "scheduled") {
    return (observation.boundary === "next-turn" || observation.boundary === "next-session")
      && settlement.outcome === "committed"
      && observation.activeRevision === null;
  }
  return observation.activeRevision === null;
}

function isSettlementRevision(value: unknown): value is string | null {
  return value === null || value === "absent" || (typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value));
}

function isActivationClass(value: unknown): value is "hot" | "next-turn" | "next-session" | "reconcile" | "restart-required" {
  return value === "hot" || value === "next-turn" || value === "next-session"
    || value === "reconcile" || value === "restart-required";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReconciliationGeneration(value: unknown): value is ConfigMutationReconciliationGeneration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ConfigMutationReconciliationGeneration>;
  return typeof candidate.target === "string"
    && candidate.target.trim().length > 0
    && RECONCILIATION_TARGETS.some((target) => target === candidate.target)
    && typeof candidate.generation === "string"
    && /^sha256:[a-f0-9]{64}$/u.test(candidate.generation);
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function safeId(value: string): string {
  if (!/^[a-z0-9_-]+$/iu.test(value)) {
    throw new Error(`Invalid config mutation id: ${value}`);
  }
  return value;
}
