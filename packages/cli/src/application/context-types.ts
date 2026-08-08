import type {
  ProjectedContext as CoreProjectedContext,
  ProjectedContextBlock as CoreProjectedContextBlock,
  ProjectedContextBlockKind as CoreProjectedContextBlockKind,
} from "@kilnai/core";

export type ProjectedContextBlockKind = CoreProjectedContextBlockKind;
export type ProjectedContextBlock = CoreProjectedContextBlock;
export type ProjectedContext = CoreProjectedContext;

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
