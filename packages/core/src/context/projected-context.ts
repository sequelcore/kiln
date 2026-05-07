export type ProjectedContextBlockKind =
  | "instruction"
  | "memory"
  | "summary"
  | "artifact"
  | "knowledge"
  | "ledger"
  | "procedural"
  | "coordination";

export interface ProjectedContextBlock {
  readonly id: string;
  readonly kind: ProjectedContextBlockKind;
  readonly source: string;
  readonly content: string;
  readonly required: boolean;
  readonly score: number;
  readonly memoryRecordId?: string;
  readonly estimatedTokens?: number;
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
