// MCP server: tool input schemas for the gateway MCP tools
// JSON Schema objects exposed through @modelcontextprotocol/server tool contracts

export const COST_SUMMARY_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [] as string[],
};

export const SAFETY_METRICS_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [] as string[],
};

export const INTEGRATION_LIST_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [] as string[],
};

export const ROUTING_TEST_SCHEMA = {
  type: "object" as const,
  properties: {
    tenantId: { type: "string", description: "Tenant ID to test routing for" },
    message: { type: "string", description: "Message text to route (dry-run, not sent to LLM)" },
  },
  required: ["tenantId", "message"],
};

export const EVAL_SCORE_SCHEMA = {
  type: "object" as const,
  properties: {
    input: { type: "string", description: "The user input or prompt" },
    output: { type: "string", description: "The LLM output to evaluate" },
    expected: { type: "string", description: "Optional expected/reference output" },
    scorers: {
      type: "array",
      items: { type: "string" },
      description: "Scorer names to apply. If omitted, all configured scorers are used.",
    },
  },
  required: ["input", "output"],
};

export const BUDGET_CHECK_SCHEMA = {
  type: "object" as const,
  properties: {
    tenantId: { type: "string", description: "Tenant ID to check budget for" },
    appName: { type: "string", description: "App name (locates the billing config)" },
  },
  required: ["tenantId", "appName"],
};

export const SWARM_JOIN_SCHEMA = {
  type: "object" as const,
  properties: {
    swarmId: { type: "string", description: "Swarm identifier" },
    agentId: { type: "string", description: "Joining agent identifier" },
    description: { type: "string", description: "Optional agent description for swarm status" },
    ttlSeconds: { type: "number", description: "Optional membership TTL in seconds" },
  },
  required: ["swarmId", "agentId"],
};

export const SWARM_LEAVE_SCHEMA = {
  type: "object" as const,
  properties: {
    swarmId: { type: "string", description: "Swarm identifier" },
    agentId: { type: "string", description: "Leaving agent identifier" },
  },
  required: ["swarmId", "agentId"],
};

export const SWARM_STATUS_SCHEMA = {
  type: "object" as const,
  properties: {
    swarmId: { type: "string", description: "Swarm identifier" },
  },
  required: ["swarmId"],
};

export const SWARM_BROADCAST_SCHEMA = {
  type: "object" as const,
  properties: {
    swarmId: { type: "string", description: "Swarm identifier" },
    agentId: { type: "string", description: "Sending agent identifier" },
    message: { type: "string", description: "Broadcast message body" },
  },
  required: ["swarmId", "agentId", "message"],
};

export const SWARM_CLAIM_SCHEMA = {
  type: "object" as const,
  properties: {
    swarmId: { type: "string", description: "Swarm identifier" },
    agentId: { type: "string", description: "Claiming agent identifier" },
    resourceId: { type: "string", description: "Resource identifier to claim" },
  },
  required: ["swarmId", "agentId", "resourceId"],
};

export const SWARM_RELEASE_SCHEMA = {
  type: "object" as const,
  properties: {
    swarmId: { type: "string", description: "Swarm identifier" },
    agentId: { type: "string", description: "Releasing agent identifier" },
    resourceId: { type: "string", description: "Resource identifier to release" },
  },
  required: ["swarmId", "agentId", "resourceId"],
};

/** All tool definitions for the gateway MCP server */
export const GATEWAY_MCP_TOOLS = [
  {
    name: "cost_summary",
    description: "Get the current cost summary including total tokens, cost in USD, and per-role:model breakdown",
    inputSchema: COST_SUMMARY_SCHEMA,
  },
  {
    name: "safety_metrics",
    description: "Get safety pipeline metrics including PII detections, content classifications, and rail triggers",
    inputSchema: SAFETY_METRICS_SCHEMA,
  },
  {
    name: "safety_check",
    description: "Get safety pipeline metrics including PII detections, content classifications, and rail triggers (alias for safety_metrics)",
    inputSchema: SAFETY_METRICS_SCHEMA,
  },
  {
    name: "integration_list",
    description: "List all registered integration adapters and their available operations",
    inputSchema: INTEGRATION_LIST_SCHEMA,
  },
  {
    name: "routing_test",
    description: "Dry-run tenant message routing: returns agentId, tier, matched pattern, and per-rule diagnostics",
    inputSchema: ROUTING_TEST_SCHEMA,
  },
  {
    name: "eval_score",
    description: "Score a single input/output pair using the gateway's configured eval scorers",
    inputSchema: EVAL_SCORE_SCHEMA,
  },
  {
    name: "budget_check",
    description: "Check remaining budget for a tenant against the app's billing endpoint",
    inputSchema: BUDGET_CHECK_SCHEMA,
  },
  {
    name: "swarm_join",
    description: "Join a named agent swarm and get current membership list",
    inputSchema: SWARM_JOIN_SCHEMA,
  },
  {
    name: "swarm_leave",
    description: "Leave a swarm and release all held claims",
    inputSchema: SWARM_LEAVE_SCHEMA,
  },
  {
    name: "swarm_status",
    description: "Get current swarm members and active resource claims",
    inputSchema: SWARM_STATUS_SCHEMA,
  },
  {
    name: "swarm_broadcast",
    description: "Broadcast a message to all agents in a swarm",
    inputSchema: SWARM_BROADCAST_SCHEMA,
  },
  {
    name: "swarm_claim",
    description: "Claim exclusive ownership of a resource (optimistic lock)",
    inputSchema: SWARM_CLAIM_SCHEMA,
  },
  {
    name: "swarm_release",
    description: "Release a previously claimed resource",
    inputSchema: SWARM_RELEASE_SCHEMA,
  },
] as const;

export type GatewayMcpToolName = (typeof GATEWAY_MCP_TOOLS)[number]["name"];
