// Context formatting utilities -- shared by WS tenant, WhatsApp webhook, and Mode B routes

import type { VectorResult, ContactFact, GroundingMode } from "@kilnai/core";

const GROUNDING_DIRECTIVE =
  "--- Grounding Rules ---\n" +
  "Answer ONLY from the knowledge context, configured services, and FAQs provided above.\n" +
  "If the answer is not in your provided context, say you don't have that information " +
  "and offer to connect the user with the human team.\n" +
  "Never fabricate specific data (regulations, prices, dates, legal references).";

export function formatKnowledgeContext(results: readonly VectorResult[]): string | undefined {
  if (results.length === 0) return undefined;
  return "[Knowledge context]:\n" + results.map((r) => r.content).join("\n---\n");
}

export function formatContactContext(facts: readonly ContactFact[]): string | undefined {
  if (facts.length === 0) return undefined;
  return "--- Customer Context ---\n" + facts.map((f) => f.content).join("\n") + "\n---";
}

export function mergeContextSources(...sources: (string | undefined)[]): string | undefined {
  const filtered = sources.filter(Boolean);
  return filtered.length > 0 ? filtered.join("\n\n") : undefined;
}

export function appendGroundingDirective(
  context: string | undefined,
  groundingMode: GroundingMode | undefined,
): string | undefined {
  if (!context || (groundingMode !== "strict" && groundingMode !== "verified")) return context;
  return context + "\n\n" + GROUNDING_DIRECTIVE;
}
