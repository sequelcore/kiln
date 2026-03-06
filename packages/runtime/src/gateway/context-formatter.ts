// Context formatting utilities -- shared by WS tenant, WhatsApp webhook, and Mode B routes

import type { VectorResult, ContactFact } from "@kilnai/core";

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
