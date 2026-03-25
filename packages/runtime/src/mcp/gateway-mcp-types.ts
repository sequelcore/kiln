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

  // Integration Runtime Phase 4
  readonly listIntegrations?: () => readonly {
    provider: string;
    version: string;
    operations: readonly { name: string; description: string }[];
  }[];

  readonly executeIntegration?: (
    provider: string,
    operation: string,
    tenantId: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;

  // MCP-First Orchestration Phase 2
  readonly testRouting?: (
    tenantId: string,
    message: string,
  ) => Promise<{
    agentId: string;
    agentName: string;
    tier: string;
    matchedPattern: string | null;
    confidence: number | null;
    allRules: readonly { pattern: string; agent: string; matched: boolean }[];
  }>;

  readonly evalScore?: (
    input: string,
    output: string,
    expected?: string,
    scorerNames?: readonly string[],
  ) => Promise<readonly { name: string; score: number; reasoning?: string }[]>;

  readonly getEnrichment?: (
    sessionId: string,
  ) => Promise<Record<string, unknown> | undefined>;

  readonly listEnrichments?: (
    tenantId: string,
    limit?: number,
    cursor?: string,
  ) => Promise<{
    enrichments: readonly Record<string, unknown>[];
    nextCursor?: string;
  }>;

  readonly checkBudget?: (
    tenantId: string,
    appName: string,
  ) => Promise<{ allowed: boolean; remaining: number; unit: string }>;

  readonly reportUsage?: (
    tenantId: string,
    appName: string,
    messages: number,
    tokens: number,
    model: string,
  ) => Promise<void>;
}
