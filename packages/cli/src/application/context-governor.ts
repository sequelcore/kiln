import { getFieldStrength, selectContextWithinBudget } from "@kilnai/core";
import type { ContextArtifactCache, ContextBudgetCandidate } from "@kilnai/core";
import type { ProjectedContext, ProjectedContextBlock } from "./context-types.js";
import { estimateTextTokens } from "./context-types.js";
import type { SessionLedger } from "./session-ledger.js";
import { renderSessionLedger } from "./session-ledger.js";
import type {
  KilnContextGovernanceAggressiveness,
  KilnContextGovernanceSource,
} from "../kiln-yaml-types.js";

export interface ProjectContextInput {
  readonly memorySnapshot?: string;
  readonly sessionLedger?: SessionLedger;
  readonly exactArtifacts?: readonly string[];
  readonly cache?: ContextArtifactCache;
  readonly moduleArtifactKeys?: readonly string[];
  readonly projectArtifactKey?: string;
  readonly planArtifactKey?: string;
  readonly sessionArtifactKey?: string;
  readonly tokenBudget?: number;
  readonly preferredSources?: readonly KilnContextGovernanceSource[];
  readonly summaryAggressiveness?: KilnContextGovernanceAggressiveness;
}

export interface ContextGovernor {
  project(input: ProjectContextInput): ProjectedContext;
}

export const DEFAULT_PROJECTED_CONTEXT_TOKEN_BUDGET = 2000;
export const DEFAULT_SESSION_ARTIFACT_TTL_MS = 1000 * 60 * 60 * 12;
const PREFERRED_SOURCE_SCORE_BONUS = 0.2;
const FIELD_CATEGORY_BONUS = 0.35;
const SUMMARY_AGGRESSIVENESS_ADJUSTMENTS: Record<
  KilnContextGovernanceAggressiveness,
  { readonly summaryBonus: number; readonly artifactPenalty: number }
> = {
  low: { summaryBonus: -0.08, artifactPenalty: 0 },
  medium: { summaryBonus: 0, artifactPenalty: 0 },
  high: { summaryBonus: 0.12, artifactPenalty: -0.08 },
};

function classifyGovernanceSource(block: ProjectedContextBlock): KilnContextGovernanceSource {
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

function applySummaryAggressiveness(
  block: ProjectedContextBlock,
  aggressiveness: KilnContextGovernanceAggressiveness,
): number {
  const adjustment = SUMMARY_AGGRESSIVENESS_ADJUSTMENTS[aggressiveness];
  if (block.required) return 0;
  if (block.kind === "summary") return adjustment.summaryBonus;
  if (block.kind === "artifact") return adjustment.artifactPenalty;
  return 0;
}

export class DefaultContextGovernor implements ContextGovernor {
  project(input: ProjectContextInput): ProjectedContext {
    const blocks: ProjectedContextBlock[] = [];

    for (const [index, key] of (input.moduleArtifactKeys ?? []).entries()) {
      const cachedModuleSummary = input.cache?.get(key);
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

    const cachedPlanSummary = input.planArtifactKey && input.cache
      ? input.cache.get(input.planArtifactKey)
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

    const cachedProjectSummary = input.projectArtifactKey && input.cache
      ? input.cache.get(input.projectArtifactKey)
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

    const cachedSummary = input.sessionArtifactKey && input.cache
      ? input.cache.get(input.sessionArtifactKey)
      : undefined;
    if (cachedSummary && cachedSummary.content.trim() !== "") {
      blocks.push({
        id: "summary:cached-session",
        kind: "summary",
        source: "context-artifact-cache",
        content: cachedSummary.content,
        required: false,
        score: 0.8,
        estimatedTokens: estimateTextTokens(cachedSummary.content),
      });
    }

    const renderedLedger = input.sessionLedger ? renderSessionLedger(input.sessionLedger) : undefined;
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
    const preferredSources = new Set(input.preferredSources ?? []);
    const summaryAggressiveness = input.summaryAggressiveness ?? "medium";
    const candidates: ContextBudgetCandidate<ProjectedContextBlock>[] = blocks.map((block) => {
      const preferredBonus = preferredSources.has(classifyGovernanceSource(block))
        ? PREFERRED_SOURCE_SCORE_BONUS
        : 0;
      const summaryAdjustment = applySummaryAggressiveness(block, summaryAggressiveness);
      const fieldBoost = FIELD_CATEGORY_BONUS * getFieldStrength(mapBlockToFieldCategory(block));
      return {
        id: block.id,
        required: block.required,
        estimatedTokens: block.estimatedTokens ?? estimateTextTokens(block.content),
        score: block.score + preferredBonus + summaryAdjustment + fieldBoost,
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
      overflow: selection.overflow,
    };
  }
}
