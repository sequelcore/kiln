export type ProjectedContextBlockKind =
  | "memory"
  | "summary"
  | "artifact"
  | "knowledge"
  | "ledger";

export interface ProjectedContextBlock {
  readonly id: string;
  readonly kind: ProjectedContextBlockKind;
  readonly source: string;
  readonly content: string;
  readonly required: boolean;
  readonly score: number;
  readonly estimatedTokens?: number;
}

export interface ProjectedContext {
  readonly blocks: readonly ProjectedContextBlock[];
  readonly estimatedTokens: number;
  readonly tokenBudget?: number;
  readonly deferredBlocks?: readonly ProjectedContextBlock[];
  readonly overflow?: boolean;
}

export interface ContextCandidate {
  readonly kind: ProjectedContextBlockKind;
  readonly source: string;
  readonly content: string;
  readonly required?: boolean;
  readonly score?: number;
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
