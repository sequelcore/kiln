export type ProjectedContextBlockKind =
  | "instruction"
  | "memory"
  | "summary"
  | "artifact"
  | "knowledge"
  | "ledger"
  | "procedural"
  | "coordination";

export type ModelFacingContextSemantics = "directive" | "guidance" | "evidence";

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
  readonly modelFacingSemantics: ModelFacingContextSemantics;
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
  readonly modelFacingSemantics: ModelFacingContextSemantics;
  readonly source: string;
  readonly contentHash: string;
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
  readonly modelFacingSemantics?: ModelFacingContextSemantics;
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

export interface PartitionedProjectedContext {
  readonly directives: readonly ProjectedContextBlock[];
  readonly guidance: readonly ProjectedContextBlock[];
  readonly evidence: readonly ProjectedContextBlock[];
}

export function validateModelFacingContextBlock(block: ProjectedContextBlock): void {
  if (block.modelFacingSemantics !== "directive"
    && block.modelFacingSemantics !== "guidance"
    && block.modelFacingSemantics !== "evidence") {
    throw new Error("Context blocks must declare a valid modelFacingSemantics");
  }
  const expected = block.kind === "instruction" ? "directive"
    : block.kind === "procedural" ? undefined
      : "evidence";
  if (expected && block.modelFacingSemantics !== expected) {
    throw new Error(`Context kind ${block.kind} cannot be promoted to ${block.modelFacingSemantics}`);
  }
}

export function validatePartitionedProjectedContext(partition: PartitionedProjectedContext): void {
  for (const [expected, blocks] of [
    ["directive", partition.directives],
    ["guidance", partition.guidance],
    ["evidence", partition.evidence],
  ] as const) {
    for (const block of blocks) {
      validateModelFacingContextBlock(block);
      if (block.modelFacingSemantics !== expected) {
        throw new Error(`Context block ${block.id} is in ${expected} partition but declares ${block.modelFacingSemantics}`);
      }
    }
  }
}

export function validateAdmittedContextBlocks(
  partition: PartitionedProjectedContext,
  audit: ContextAuditEntry,
): void {
  validatePartitionedProjectedContext(partition);
  const rendered = [...partition.directives, ...partition.guidance, ...partition.evidence];
  const renderedById = new Map<string, ProjectedContextBlock>();
  for (const block of rendered) {
    if (renderedById.has(block.id)) {
      throw new Error(`Rendered context block ${block.id} is duplicated`);
    }
    renderedById.set(block.id, block);
  }

  const selectedIds = new Set<string>();
  for (const id of audit.selectedBlockIds) {
    if (selectedIds.has(id)) throw new Error(`Context audit selected block ${id} is duplicated`);
    selectedIds.add(id);
  }
  const admittedById = new Map<string, ContextAuditBlock>();
  for (const block of audit.blocks) {
    if (block.decision !== "admitted") continue;
    if (admittedById.has(block.id)) throw new Error(`Context audit admitted block ${block.id} is duplicated`);
    admittedById.set(block.id, block);
  }
  if (selectedIds.size !== admittedById.size) {
    throw new Error("Context audit selected blocks do not match admitted audit blocks");
  }
  for (const id of selectedIds) {
    if (!admittedById.has(id)) throw new Error(`Context audit selected block ${id} is not admitted`);
  }
  if (renderedById.size !== admittedById.size) {
    throw new Error("Rendered context blocks do not exactly match admitted audit blocks");
  }
  for (const [id, renderedBlock] of renderedById) {
    if (!selectedIds.has(id)) throw new Error(`Rendered context block ${id} is not selected by the audit`);
    const admitted = admittedById.get(id);
    if (!admitted) throw new Error(`Rendered context block ${id} is not admitted by the audit`);
    if (renderedBlock.kind !== admitted.kind
      || renderedBlock.source !== admitted.source
      || renderedBlock.modelFacingSemantics !== admitted.modelFacingSemantics
      || renderedBlock.required !== admitted.required
      || renderedBlock.estimatedTokens !== admitted.estimatedTokens
      || renderedBlock.memoryRecordId !== admitted.memoryRecordId
      || renderedBlock.segmentId !== admitted.segmentId
      || sha256ContentIdentity(renderedBlock.content) !== admitted.contentHash) {
      throw new Error(`Rendered context block ${id} diverges from admitted audit metadata`);
    }
  }
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

export function renderContextBlocks(blocks: readonly ProjectedContextBlock[]): string | undefined {
  const rendered = blocks
    .map((block) => compactBlankLines(block.content))
    .filter((content) => content !== "")
    .join("\n\n");

  return rendered === "" ? undefined : rendered;
}

export function partitionProjectedContext(projectedContext: ProjectedContext): PartitionedProjectedContext {
  const directives: ProjectedContextBlock[] = [];
  const guidance: ProjectedContextBlock[] = [];
  const evidence: ProjectedContextBlock[] = [];
  for (const block of projectedContext.blocks) {
    validateModelFacingContextBlock(block);
    if (block.modelFacingSemantics === "directive") directives.push(block);
    else if (block.modelFacingSemantics === "guidance") guidance.push(block);
    else evidence.push(block);
  }
  const partition = { directives, guidance, evidence };
  validatePartitionedProjectedContext(partition);
  return partition;
}
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
