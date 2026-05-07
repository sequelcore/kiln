import { selectContextWithinBudget } from "../memory/context-budget.js";
import type { ContextBudgetCandidate } from "../memory/context-budget.js";
import type { ContextArtifactCache } from "../memory/context-cache.js";
import { getFieldStrength } from "../field/field-service.js";
import type {
  ContextAuditBlock,
  ContextAuditDecision,
  ContextAuditEntry,
  ContextCandidate,
  ProjectedContext,
  ProjectedContextBlock,
} from "./projected-context.js";
import { estimateTextTokens } from "./projected-context.js";

export const DEFAULT_PROJECTED_CONTEXT_TOKEN_BUDGET = 2000;
export const DEFAULT_SESSION_ARTIFACT_TTL_MS = 1000 * 60 * 60 * 12;

const PREFERRED_SOURCE_SCORE_BONUS = 0.2;
const FIELD_CATEGORY_BONUS = 0.35;

interface RankedContextBlock {
  readonly block: ProjectedContextBlock;
  readonly effectiveScore: number;
  readonly estimatedTokens: number;
}

export interface ContextAdmissionRecord {
  readonly id: string;
  readonly recordId: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly decision: ContextAuditDecision;
  readonly reason: string;
  readonly estimatedTokens: number;
  readonly baseScore: number;
  readonly effectiveScore: number;
  readonly createdAt: string;
}

export interface ContextAdmissionSink {
  saveContextAdmission(admission: ContextAdmissionRecord): ContextAdmissionRecord;
}

export type ContextAdmissionIdGenerator = (block: ContextAuditBlock) => string;

export interface ContextGovernor<
  TLedger,
  TSource extends string,
  TAggressiveness extends string,
> {
  project(input: ProjectContextInput<TLedger, TSource, TAggressiveness>): ProjectedContext;
}

export interface ProjectContextInput<
  TLedger,
  TSource extends string,
  TAggressiveness extends string,
> {
  readonly sessionLedger?: TLedger;
  readonly renderLedger?: (ledger: TLedger) => string | undefined;
  readonly artifacts?: readonly ContextCandidate[];
  readonly artifactCache?: ContextArtifactCache;
  readonly artifactKeys?: readonly string[];
  readonly tokenBudget?: number;
  readonly preferredSources?: readonly TSource[];
  readonly summaryAggressiveness?: TAggressiveness;
  readonly aggressivenessPolicy?: Record<
    TAggressiveness,
    { readonly summaryBonus: number; readonly artifactPenalty: number }
  >;
  readonly memorySnapshot?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly admissionSink?: ContextAdmissionSink;
  readonly admissionIdGenerator?: ContextAdmissionIdGenerator;
  readonly clock?: () => string;
  readonly exactArtifacts?: readonly string[];
  readonly moduleArtifactKeys?: readonly string[];
  readonly projectArtifactKey?: string;
  readonly planArtifactKey?: string;
  readonly sessionArtifactKey?: string;
}

function classifyGovernanceSource(block: ProjectedContextBlock): string {
  switch (block.kind) {
    case "instruction":
      return "instruction";
    case "ledger":
      return "ledger";
    case "artifact":
      return "artifact";
    case "summary":
      return "summary";
    case "memory":
      return "memory";
    case "knowledge":
      return "knowledge";
    case "procedural":
      return "procedural";
    case "coordination":
      return "coordination";
  }
}

function mapBlockToFieldCategory(block: ProjectedContextBlock): string {
  return `category:${block.kind}`;
}

function applySummaryAggressiveness<TAggressiveness extends string>(
  block: ProjectedContextBlock,
  aggressiveness: TAggressiveness,
  policy: Record<TAggressiveness, { readonly summaryBonus: number; readonly artifactPenalty: number }> | undefined,
): number {
  if (!policy) return 0;
  const adjustment = policy[aggressiveness];
  if (!adjustment) return 0;
  if (block.required) return 0;
  if (block.kind === "summary") return adjustment.summaryBonus;
  if (block.kind === "artifact") return -adjustment.artifactPenalty;
  return 0;
}

function buildContextAuditEntry(input: {
  readonly selected: readonly RankedContextBlock[];
  readonly deferred: readonly RankedContextBlock[];
  readonly requiredTokens: number;
  readonly selectedTokens: number;
  readonly tokenBudget: number;
  readonly overflow: boolean;
}): ContextAuditEntry {
  const selectedBlockIds = input.selected.map((candidate) => candidate.block.id);
  const deferredBlockIds = input.deferred.map((candidate) => candidate.block.id);
  const requiredBlockIds = [...input.selected, ...input.deferred]
    .filter((candidate) => candidate.block.required)
    .map((candidate) => candidate.block.id);
  const preservedRequiredBlockIds = input.selected
    .filter((candidate) => candidate.block.required)
    .map((candidate) => candidate.block.id);
  const overflowReason = input.requiredTokens > input.tokenBudget
    ? "required-overflow"
    : input.deferred.length > 0
      ? "budget-cap"
      : undefined;

  const blocks: ContextAuditBlock[] = [];

  for (const [index, candidate] of input.selected.entries()) {
    blocks.push({
      id: candidate.block.id,
      kind: candidate.block.kind,
      source: candidate.block.source,
      required: candidate.block.required,
      memoryRecordId: candidate.block.memoryRecordId,
      estimatedTokens: candidate.estimatedTokens,
      baseScore: candidate.block.score,
      effectiveScore: candidate.effectiveScore,
      decision: "admitted",
      reason: candidate.block.required ? "required-preserved" : "within-budget",
      order: index,
    });
  }

  for (const [index, candidate] of input.deferred.entries()) {
    blocks.push({
      id: candidate.block.id,
      kind: candidate.block.kind,
      source: candidate.block.source,
      required: candidate.block.required,
      memoryRecordId: candidate.block.memoryRecordId,
      estimatedTokens: candidate.estimatedTokens,
      baseScore: candidate.block.score,
      effectiveScore: candidate.effectiveScore,
      decision: "deferred",
      reason: overflowReason ?? "budget-cap",
      order: input.selected.length + index,
    });
  }

  return {
    governor: "DefaultContextGovernor",
    selectedBlockIds,
    deferredBlockIds,
    requiredBlockIds,
    preservedRequiredBlockIds,
    selectedTokens: input.selectedTokens,
    requiredTokens: input.requiredTokens,
    tokenBudget: input.tokenBudget,
    overflow: input.overflow || input.deferred.length > 0,
    overflowReason,
    blocks,
  };
}

export class DefaultContextGovernor<
  TLedger,
  TSource extends string,
  TAggressiveness extends string,
> implements ContextGovernor<TLedger, TSource, TAggressiveness> {
  project(input: ProjectContextInput<TLedger, TSource, TAggressiveness>): ProjectedContext {
    const blocks: ProjectedContextBlock[] = [];
    const blockIds = new Map<string, number>();

    for (const candidate of input.artifacts ?? []) {
      if (candidate.content.trim() === "") continue;
      const memoryRecordId = normalizeMemoryRecordId(candidate.memoryRecordId);
      const baseId = memoryRecordId
        ? `memory:${memoryRecordId}`
        : `candidate:${candidate.kind}:${stableHash(`${candidate.source}\n${candidate.content}`)}`;
      blocks.push({
        id: uniqueBlockId(baseId, blockIds),
        kind: candidate.kind,
        source: candidate.source,
        content: candidate.content,
        required: candidate.required ?? false,
        score: candidate.score ?? 0,
        memoryRecordId,
        estimatedTokens: candidate.estimatedTokens ?? estimateTextTokens(candidate.content),
      });
    }

    // Cache-backed module summaries
    for (const key of input.moduleArtifactKeys ?? []) {
      const cachedModuleSummary = input.artifactCache?.get(key);
      if (cachedModuleSummary && cachedModuleSummary.content.trim() !== "") {
        blocks.push({
          id: uniqueBlockId(`summary:cached-module:${stableHash(key)}`, blockIds),
          kind: "summary",
          source: "context-artifact-cache",
          content: cachedModuleSummary.content,
          required: false,
          score: 0.78,
          estimatedTokens: estimateTextTokens(cachedModuleSummary.content),
        });
      }
    }

    const cachedPlanSummary =
      input.planArtifactKey && input.artifactCache
        ? input.artifactCache.get(input.planArtifactKey)
        : undefined;
    if (cachedPlanSummary && cachedPlanSummary.content.trim() !== "") {
      blocks.push({
        id: uniqueBlockId("summary:cached-plan", blockIds),
        kind: "summary",
        source: "context-artifact-cache",
        content: cachedPlanSummary.content,
        required: false,
        score: 0.85,
        estimatedTokens: estimateTextTokens(cachedPlanSummary.content),
      });
    }

    const cachedProjectSummary =
      input.projectArtifactKey && input.artifactCache
        ? input.artifactCache.get(input.projectArtifactKey)
        : undefined;
    if (cachedProjectSummary && cachedProjectSummary.content.trim() !== "") {
      blocks.push({
        id: uniqueBlockId("summary:cached-project", blockIds),
        kind: "summary",
        source: "context-artifact-cache",
        content: cachedProjectSummary.content,
        required: false,
        score: 0.75,
        estimatedTokens: estimateTextTokens(cachedProjectSummary.content),
      });
    }

    const cachedSessionSummary =
      input.sessionArtifactKey && input.artifactCache
        ? input.artifactCache.get(input.sessionArtifactKey)
        : undefined;
    if (cachedSessionSummary && cachedSessionSummary.content.trim() !== "") {
      blocks.push({
        id: uniqueBlockId("summary:cached-session", blockIds),
        kind: "summary",
        source: "context-artifact-cache",
        content: cachedSessionSummary.content,
        required: false,
        score: 0.8,
        estimatedTokens: estimateTextTokens(cachedSessionSummary.content),
      });
    }

    // Ledger rendered via callback
    const renderedLedger =
      input.sessionLedger !== undefined
        ? input.renderLedger?.(input.sessionLedger)
        : undefined;
    if (renderedLedger) {
      blocks.push({
        id: uniqueBlockId("ledger:session", blockIds),
        kind: "ledger",
        source: "session-ledger",
        content: renderedLedger,
        required: true,
        score: 1,
        estimatedTokens: estimateTextTokens(renderedLedger),
      });
    }

    // Exact string artifacts (required)
    for (const artifact of input.exactArtifacts ?? []) {
      if (artifact.trim() === "") continue;
      blocks.push({
        id: uniqueBlockId(`artifact:${stableHash(artifact)}`, blockIds),
        kind: "artifact",
        source: "session-artifact",
        content: artifact,
        required: true,
        score: 0.95,
        estimatedTokens: estimateTextTokens(artifact),
      });
    }

    // Memory snapshot
    if (input.memorySnapshot && input.memorySnapshot.trim() !== "") {
      blocks.push({
        id: uniqueBlockId("memory:snapshot", blockIds),
        kind: "memory",
        source: "session-memory-snapshot",
        content: input.memorySnapshot,
        required: false,
        score: 0.6,
        estimatedTokens: estimateTextTokens(input.memorySnapshot),
      });
    }

    const tokenBudget = input.tokenBudget ?? DEFAULT_PROJECTED_CONTEXT_TOKEN_BUDGET;
    const preferredSources = new Set<string>(input.preferredSources ?? []);
    const summaryAggressiveness = input.summaryAggressiveness;

    const candidates: ContextBudgetCandidate<RankedContextBlock>[] = blocks.map((block) => {
      const preferredBonus = preferredSources.has(classifyGovernanceSource(block))
        ? PREFERRED_SOURCE_SCORE_BONUS
        : 0;
      const summaryAdjustment =
        summaryAggressiveness !== undefined
          ? applySummaryAggressiveness(block, summaryAggressiveness, input.aggressivenessPolicy)
          : 0;
      const fieldBoost = FIELD_CATEGORY_BONUS * getFieldStrength(mapBlockToFieldCategory(block));
      const effectiveScore = block.score + preferredBonus + summaryAdjustment + fieldBoost;
      const contentTokens = block.estimatedTokens ?? estimateTextTokens(block.content);
      return {
        id: block.id,
        required: block.required,
        estimatedTokens: contentTokens,
        score: effectiveScore,
        meta: {
          block,
          effectiveScore,
          estimatedTokens: contentTokens,
        },
      };
    });

    const selection = selectContextWithinBudget(candidates, tokenBudget);
    const selected = selection.selected.map((candidate) => candidate.meta);
    const deferred = selection.deferred.map((candidate) => candidate.meta);
    const selectedBlocks = selected.map((candidate) => candidate.block);
    const deferredBlocks = deferred.map((candidate) => candidate.block);
    const auditEntry = buildContextAuditEntry({
      selected,
      deferred,
      requiredTokens: selection.requiredTokens,
      selectedTokens: selection.selectedTokens,
      tokenBudget,
      overflow: selection.overflow,
    });
    recordMemoryAdmissions({
      sink: input.admissionSink,
      auditBlocks: auditEntry.blocks,
      sessionId: input.sessionId,
      turnId: input.turnId,
      idGenerator: input.admissionIdGenerator,
      clock: input.clock,
    });

    return {
      blocks: selectedBlocks,
      estimatedTokens: selection.selectedTokens,
      tokenBudget,
      deferredBlocks,
      overflow: selection.overflow || deferredBlocks.length > 0,
      auditTrail: [auditEntry],
    };
  }
}

function normalizeMemoryRecordId(recordId: string | undefined): string | undefined {
  if (recordId === undefined) return undefined;
  const trimmed = recordId.trim();
  if (trimmed.length === 0) {
    throw new Error("Memory context record id is required");
  }
  return trimmed;
}

function uniqueBlockId(baseId: string, seen: Map<string, number>): string {
  const count = seen.get(baseId) ?? 0;
  seen.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}:${count + 1}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function recordMemoryAdmissions(input: {
  readonly sink?: ContextAdmissionSink;
  readonly auditBlocks: readonly ContextAuditBlock[];
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly idGenerator?: ContextAdmissionIdGenerator;
  readonly clock?: () => string;
}): void {
  if (!input.sink) return;

  const createdAt = input.clock?.() ?? new Date().toISOString();
  for (const block of input.auditBlocks) {
    if (block.kind !== "memory" || !block.memoryRecordId) {
      continue;
    }

    input.sink.saveContextAdmission({
      id: input.idGenerator?.(block) ?? defaultAdmissionId(block, input.sessionId, input.turnId),
      recordId: block.memoryRecordId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      decision: block.decision,
      reason: block.reason,
      estimatedTokens: block.estimatedTokens,
      baseScore: block.baseScore,
      effectiveScore: block.effectiveScore,
      createdAt,
    });
  }
}

function defaultAdmissionId(block: ContextAuditBlock, sessionId: string | undefined, turnId: string | undefined): string {
  const sessionPart = sessionId ?? "sessionless";
  const turnPart = turnId ?? "turnless";
  return `context-admission:${sessionPart}:${turnPart}:${block.id}`;
}
