import { selectContextWithinBudget } from "../memory/context-budget.js";
import type { ContextBudgetCandidate } from "../memory/context-budget.js";
import type { ContextArtifactCache } from "../memory/context-cache.js";
import { getFieldStrength } from "../field/field-service.js";
import type {
  ContextAuditBlock,
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
  readonly exactArtifacts?: readonly string[];
  readonly moduleArtifactKeys?: readonly string[];
  readonly projectArtifactKey?: string;
  readonly planArtifactKey?: string;
  readonly sessionArtifactKey?: string;
}

function classifyGovernanceSource(block: ProjectedContextBlock): string {
  switch (block.kind) {
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

    for (const [index, candidate] of (input.artifacts ?? []).entries()) {
      if (candidate.content.trim() === "") continue;
      blocks.push({
        id: `candidate:${index}`,
        kind: candidate.kind,
        source: candidate.source,
        content: candidate.content,
        required: candidate.required ?? false,
        score: candidate.score ?? 0,
        estimatedTokens: candidate.estimatedTokens ?? estimateTextTokens(candidate.content),
      });
    }

    // Cache-backed module summaries
    for (const [index, key] of (input.moduleArtifactKeys ?? []).entries()) {
      const cachedModuleSummary = input.artifactCache?.get(key);
      if (cachedModuleSummary && cachedModuleSummary.content.trim() !== "") {
        blocks.push({
          id: `summary:cached-module:${index}`,
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
        id: "summary:cached-plan",
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
        id: "summary:cached-project",
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
        id: "summary:cached-session",
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
        id: "ledger:session",
        kind: "ledger",
        source: "session-ledger",
        content: renderedLedger,
        required: true,
        score: 1,
        estimatedTokens: estimateTextTokens(renderedLedger),
      });
    }

    // Exact string artifacts (required)
    for (const [index, artifact] of (input.exactArtifacts ?? []).entries()) {
      if (artifact.trim() === "") continue;
      blocks.push({
        id: `artifact:${index}`,
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
        id: "memory:snapshot",
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
