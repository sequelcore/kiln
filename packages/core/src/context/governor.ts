import { selectContextWithinBudget } from "../memory/context-budget.js";
import type { ContextBudgetCandidate } from "../memory/context-budget.js";
import type { ContextArtifactCache } from "../memory/context-cache.js";
import { getFieldStrength } from "../field/field-service.js";
import type {
  ContextCandidate,
  ProjectedContext,
  ProjectedContextBlock,
} from "./projected-context.js";
import { estimateTextTokens } from "./projected-context.js";

export const DEFAULT_PROJECTED_CONTEXT_TOKEN_BUDGET = 2000;
export const DEFAULT_SESSION_ARTIFACT_TTL_MS = 1000 * 60 * 60 * 12;

const PREFERRED_SOURCE_SCORE_BONUS = 0.2;
const FIELD_CATEGORY_BONUS = 0.35;

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

    const candidates: ContextBudgetCandidate<ProjectedContextBlock>[] = blocks.map((block) => {
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
        meta: block,
      };
    });

    const selection = selectContextWithinBudget(candidates, tokenBudget);
    const selectedBlocks = selection.selected.map((candidate) => candidate.meta);
    const deferredBlocks = selection.deferred.map((candidate) => candidate.meta);

    return {
      blocks: selectedBlocks,
      estimatedTokens: selection.selectedTokens,
      tokenBudget,
      deferredBlocks,
      overflow: selection.overflow || deferredBlocks.length > 0,
    };
  }
}
