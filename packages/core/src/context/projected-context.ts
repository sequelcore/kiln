export type ProjectedContextBlockKind =
  | "instruction"
  | "memory"
  | "summary"
  | "artifact"
  | "knowledge"
  | "ledger"
  | "procedural"
  | "coordination";

export type ContextProjectionMode = "full" | "lossless" | "reversible";
export type ContextTaskPhase = "orient" | "plan" | "execute" | "verify" | "handoff";
export type ContextAllocationMode = "whole-block" | "segmented" | "retrieval-on-demand";
export type ContextPositionProfile = "balanced" | "edge-biased";
export type RequiredContextOverflowPolicy = "admit-and-report" | "reject";

export interface ContextUtilitySignals {
  readonly semanticRelevance: number;
  readonly authorityValue: number;
  readonly verificationValue: number;
  readonly recency: number;
  readonly novelty: number;
  readonly retrievalCost: number;
  readonly redundancy: number;
  readonly taskPhases: readonly ContextTaskPhase[];
}

export interface ContextUtilityEvidence {
  readonly policyId: "context-utility-v1";
  readonly taskPhase: ContextTaskPhase;
  readonly semanticRelevance: number;
  readonly authorityValue: number;
  readonly verificationValue: number;
  readonly recency: number;
  readonly novelty: number;
  readonly retrievalCost: number;
  readonly redundancy: number;
  readonly phaseMatch: number;
  readonly totalScore: number;
}

export interface ContextCandidateSegment {
  readonly id: string;
  readonly content: string;
  readonly score?: number;
  readonly estimatedTokens?: number;
  readonly utilitySignals?: ContextUtilitySignals;
}

export interface ContextProjectionEvidence {
  readonly mode: ContextProjectionMode;
  readonly transformationMode: "none" | "lossless" | "reversible";
  readonly canonicalArtifactUri: string;
  readonly sourceHash: string;
  readonly retrievalHandle?: string;
  readonly omissionDisclosed: boolean;
}

export interface ContextProjectionOption extends ContextProjectionEvidence {
  readonly content: string;
  readonly estimatedTokens?: number;
}

export interface ProjectedContextBlock {
  readonly id: string;
  readonly kind: ProjectedContextBlockKind;
  readonly source: string;
  readonly content: string;
  readonly required: boolean;
  readonly score: number;
  readonly memoryRecordId?: string;
  readonly estimatedTokens?: number;
  readonly projectionEvidence?: ContextProjectionEvidence;
  readonly segmentId?: string;
  readonly utilitySignals?: ContextUtilitySignals;
}

export type ContextAuditDecision = "admitted" | "deferred";

export type ContextAuditReason =
  | "within-budget"
  | "required-preserved"
  | "budget-cap"
  | "required-overflow";

export interface ContextAuditBlock {
  readonly id: string;
  readonly kind: ProjectedContextBlockKind;
  readonly source: string;
  readonly required: boolean;
  readonly memoryRecordId?: string;
  readonly estimatedTokens: number;
  readonly baseScore: number;
  readonly effectiveScore: number;
  readonly decision: ContextAuditDecision;
  readonly reason: ContextAuditReason;
  readonly order: number;
  readonly projectionEvidence?: ContextProjectionEvidence;
  readonly segmentId?: string;
  readonly utilityEvidence?: ContextUtilityEvidence;
}

export interface ContextAuditEntry {
  readonly governor: "DefaultContextGovernor";
  readonly selectedBlockIds: readonly string[];
  readonly deferredBlockIds: readonly string[];
  readonly requiredBlockIds: readonly string[];
  readonly preservedRequiredBlockIds: readonly string[];
  readonly selectedTokens: number;
  readonly requiredTokens: number;
  readonly tokenBudget: number;
  readonly overflow: boolean;
  readonly overflowReason?: Extract<ContextAuditReason, "budget-cap" | "required-overflow">;
  readonly allocationMode: ContextAllocationMode;
  readonly positionProfile: ContextPositionProfile;
  readonly requiredOverflowPolicy: RequiredContextOverflowPolicy;
  readonly utilityPolicyId?: "context-utility-v1";
  readonly blocks: readonly ContextAuditBlock[];
}

export interface ProjectedContext {
  readonly blocks: readonly ProjectedContextBlock[];
  readonly estimatedTokens: number;
  readonly tokenBudget?: number;
  readonly deferredBlocks?: readonly ProjectedContextBlock[];
  readonly overflow?: boolean;
  readonly auditTrail?: readonly ContextAuditEntry[];
}

export interface ContextCandidate {
  readonly kind: ProjectedContextBlockKind;
  readonly source: string;
  readonly content: string;
  readonly required?: boolean;
  readonly score?: number;
  readonly memoryRecordId?: string;
  readonly estimatedTokens?: number;
  readonly projectionOptions?: readonly ContextProjectionOption[];
  readonly utilitySignals?: ContextUtilitySignals;
  readonly segments?: readonly ContextCandidateSegment[];
}

function compactBlankLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function estimateTextTokens(text: string): number {
  const normalized = compactBlankLines(text);
  if (normalized === "") return 0;
  return Math.ceil(normalized.length / 4);
}

export function renderProjectedContext(projectedContext: ProjectedContext): string | undefined {
  const rendered = projectedContext.blocks
    .map((block) => compactBlankLines(block.content))
    .filter((content) => content !== "")
    .join("\n\n");

  return rendered === "" ? undefined : rendered;
}
