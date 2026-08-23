// MCP server: dependency injection interface for gateway capabilities
// Decouples tool handlers from concrete gateway wiring

import type { CostSummary } from "@kilnai/core";

/** Dependencies injected into the MCP server from the gateway */
export interface GatewayMcpDeps {
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

  readonly swarmJoin?: (
    swarmId: string,
    agentId: string,
    description?: string,
  ) => Promise<{ members: string[] }>;

  readonly swarmLeave?: (
    swarmId: string,
    agentId: string,
  ) => Promise<void>;

  readonly swarmStatus?: (
    swarmId: string,
  ) => Promise<{
    members: { agentId: string; description?: string; joinedAt: string }[];
    claims: { resourceId: string; agentId: string; claimedAt: string }[];
  }>;

  readonly swarmBroadcast?: (
    swarmId: string,
    agentId: string,
    message: string,
  ) => Promise<{ id: string }>;

  readonly swarmClaim?: (
    swarmId: string,
    agentId: string,
    resourceId: string,
  ) => Promise<{ claimed: boolean; claimedBy?: string }>;

  readonly swarmRelease?: (
    swarmId: string,
    agentId: string,
    resourceId: string,
  ) => Promise<void>;

  readonly checkBudget?: (
    tenantId: string,
    appName: string,
  ) => Promise<{ allowed: boolean; remaining: number; unit: string }>;

}
