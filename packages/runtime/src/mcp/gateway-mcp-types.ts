// MCP server: dependency injection interface for gateway capabilities
// Decouples tool handlers from concrete gateway wiring

import type { CostSummary } from "@kilnai/core";

/** Dependencies injected into the MCP server from the gateway */
export interface GatewayMcpDeps {
  /** Recall memory entries by scope, with optional FTS query and tag filter */
  readonly getMemoryByScope?: (
    scope: string,
    query?: string,
    tags?: string,
  ) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>;

  /** Create a memory entry; returns the new entry ID */
  readonly createMemoryEntry?: (
    entry: Record<string, unknown>,
  ) => { id: string } | Promise<{ id: string }>;

  /** Delete a memory entry by ID; returns true if found and deleted */
  readonly deleteMemoryEntry?: (id: string) => boolean | Promise<boolean>;

  /** Search the knowledge base via the retrieval pipeline */
  readonly searchKnowledge?: (
    appName: string,
    query: string,
    limit?: number,
  ) => Promise<{ results: readonly { content: string; score: number; source?: string }[] }>;

  /** List knowledge sources for an app */
  readonly listKnowledgeSources?: (appName: string) => { sources: readonly Record<string, unknown>[] };

  /** Get the current cost summary */
  readonly getCostSummary?: () => CostSummary;

  /** Get safety pipeline metrics */
  readonly getSafetyMetrics?: () => Record<string, unknown>;
}
