// MCP server: tool input schemas for the gateway MCP tools
// JSON Schema objects used by @modelcontextprotocol/sdk CallToolRequest validation

export const MEMORY_RECALL_SCHEMA = {
  type: "object" as const,
  properties: {
    scope: {
      type: "string",
      description: "Memory scope to recall from (user, agent, team, project, org)",
    },
    query: {
      type: "string",
      description: "Optional FTS5 search query to filter entries",
    },
    tags: {
      type: "string",
      description: "Optional comma-separated tag filter",
    },
  },
  required: ["scope"],
};

export const MEMORY_STORE_SCHEMA = {
  type: "object" as const,
  properties: {
    scope: {
      type: "string",
      description: "Memory scope (user, agent, team, project, org)",
    },
    key: {
      type: "string",
      description: "Unique key for the memory entry",
    },
    topic_key: {
      type: "string",
      description: "Hierarchical key for this memory (e.g. 'architecture/auth-model'). If a memory with this key already exists in the same scope, it will be updated rather than duplicated.",
    },
    content: {
      type: "string",
      description: "Content to store. Use What/Why/Where/Learned format: **What** (the fact), **Why** (the reasoning), **Where** (affected files or locations), **Learned** (insight for future reference).",
    },
    tags: {
      type: "string",
      description: "Optional comma-separated tags",
    },
  },
  required: ["scope", "key", "content"],
};

export const MEMORY_DELETE_SCHEMA = {
  type: "object" as const,
  properties: {
    id: {
      type: "string",
      description: "ID of the memory entry to delete",
    },
  },
  required: ["id"],
};

export const MEMORY_SEARCH_SCHEMA = {
  type: "object" as const,
  properties: {
    query: {
      type: "string",
      description: "BM25 search query — type indicates what to save (user: feedback, agent: insight/pattern, project: decision/reference)",
    },
    scope: {
      type: "string",
      description: "Scope filter — user, agent:{role}, team:{name}, project:{id}, or org (omit for all scopes)",
    },
    limit: {
      type: "number",
      description: "Max results to return (default: 10)",
    },
  },
  required: ["query"],
};

export const MEMORY_LIST_SCHEMA = {
  type: "object" as const,
  properties: {
    scope: {
      type: "string",
      description: "Memory scope to list (user, agent:{role}, team:{name}, project:{id}, org)",
    },
    tags: {
      type: "string",
      description: "Optional comma-separated tag filter",
    },
    limit: {
      type: "number",
      description: "Maximum entries to return (default: 50)",
    },
  },
  required: ["scope"],
};

export const MEMORY_FORGET_SCHEMA = {
  type: "object" as const,
  properties: {
    id: {
      type: "string",
      description: "ID of the memory entry to delete",
    },
  },
  required: ["id"],
};

export const KNOWLEDGE_SEARCH_SCHEMA = {
  type: "object" as const,
  properties: {
    appName: {
      type: "string",
      description: "Name of the app whose knowledge base to search",
    },
    query: {
      type: "string",
      description: "Natural language search query",
    },
    limit: {
      type: "number",
      description: "Maximum number of results to return (default: 5)",
    },
  },
  required: ["appName", "query"],
};

export const KNOWLEDGE_SOURCES_SCHEMA = {
  type: "object" as const,
  properties: {
    appName: {
      type: "string",
      description: "Name of the app whose knowledge sources to list",
    },
  },
  required: ["appName"],
};

export const KNOWLEDGE_INGEST_SCHEMA = {
  type: "object" as const,
  properties: {
    appName: {
      type: "string",
      description: "Name of the app to ingest content into",
    },
    source: {
      type: "string",
      description: "URL or file path to ingest",
    },
    content: {
      type: "string",
      description: "Raw text content to ingest (use source for URLs/files)",
    },
    tags: {
      type: "string",
      description: "Optional comma-separated tags for this content",
    },
  },
  required: ["appName"],
};

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

export const INTEGRATION_EXECUTE_SCHEMA = {
  type: "object" as const,
  properties: {
    provider: { type: "string", description: "Integration provider name (e.g. 'stripe')" },
    operation: { type: "string", description: "Operation name within the provider (e.g. 'create_link')" },
    tenantId: { type: "string", description: "Tenant ID whose credentials will be used" },
    input: { type: "object", description: "Input parameters for the operation (provider-defined schema)" },
  },
  required: ["provider", "operation", "tenantId", "input"],
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
    context: {
      type: "array",
      items: { type: "string" },
      description: "Context passages for faithfulness/context-relevance scorers",
    },
    scorerOptions: {
      type: "object",
      description: "Scorer-specific options (e.g. { policies: string[] } for policy-adherence, { prompt: string } for custom-prompt)",
    },
  },
  required: ["input", "output"],
};

export const ENRICHMENT_GET_SCHEMA = {
  type: "object" as const,
  properties: {
    sessionId: { type: "string", description: "Session ID of the completed conversation" },
  },
  required: ["sessionId"],
};

export const ENRICHMENT_LIST_SCHEMA = {
  type: "object" as const,
  properties: {
    tenantId: { type: "string", description: "Tenant ID to list enrichments for" },
    limit: { type: "number", description: "Maximum number of results (default: 20)" },
    cursor: { type: "string", description: "Pagination cursor (enrichedAt timestamp from prior response)" },
  },
  required: ["tenantId"],
};

export const CROSS_AGENT_MEMORY_RECALL_SCHEMA = {
  type: "object" as const,
  properties: {
    teamId: { type: "string", description: "Team ID scoping this memory (injected as _team:<teamId> tag)" },
    key: { type: "string", description: "Exact key for tag-based lookup" },
    query: { type: "string", description: "FTS5 search query when exact key is unknown" },
    tags: { type: "string", description: "Optional additional tag filter" },
  },
  required: ["teamId"],
};

export const CROSS_AGENT_MEMORY_STORE_SCHEMA = {
  type: "object" as const,
  properties: {
    teamId: { type: "string", description: "Team ID scoping this memory" },
    key: { type: "string", description: "Unique key for the memory entry" },
    content: { type: "string", description: "Content to store" },
    tags: { type: "string", description: "Optional comma-separated tags" },
  },
  required: ["teamId", "key", "content"],
};

export const CROSS_AGENT_MEMORY_LIST_SCHEMA = {
  type: "object" as const,
  properties: {
    teamId: { type: "string", description: "Team ID to list memory entries for" },
    tags: { type: "string", description: "Optional comma-separated tag filter" },
    limit: { type: "number", description: "Maximum entries to return (default: 50)" },
  },
  required: ["teamId"],
};

export const CROSS_AGENT_MEMORY_DELETE_SCHEMA = {
  type: "object" as const,
  properties: {
    teamId: { type: "string", description: "Team ID owning this entry (validates ownership)" },
    id: { type: "string", description: "ID of the memory entry to delete" },
  },
  required: ["teamId", "id"],
};

export const BUDGET_CHECK_SCHEMA = {
  type: "object" as const,
  properties: {
    tenantId: { type: "string", description: "Tenant ID to check budget for" },
    appName: { type: "string", description: "App name (locates the billing config)" },
  },
  required: ["tenantId", "appName"],
};

export const BUDGET_REPORT_SCHEMA = {
  type: "object" as const,
  properties: {
    tenantId: { type: "string", description: "Tenant ID to report usage for" },
    appName: { type: "string", description: "App name (locates the billing config)" },
    messages: { type: "number", description: "Number of messages to report" },
    tokens: { type: "number", description: "Number of tokens to report" },
    model: { type: "string", description: "Model identifier (e.g. 'claude-sonnet-4-5')" },
  },
  required: ["tenantId", "appName", "messages", "tokens", "model"],
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
    name: "memory_recall",
    description:
      "Recall memory entries by scope. Type: user (feedback/preferences), agent (insights/patterns), team (shared decisions), project (references/architecture). Scope: user/agent:{role}/team:{name}/project:{id}/org. Returns content within token budget.",
    inputSchema: MEMORY_RECALL_SCHEMA,
  },
  {
    name: "memory_store",
    description:
      "Store a memory entry. Type (via scope): user (feedback, preferences), agent:{role} (insights, patterns, decisions), team:{name} (shared context), project:{id} (architecture, references). How to use: call after completing a task or making a decision worth remembering.",
    inputSchema: MEMORY_STORE_SCHEMA,
  },
  {
    name: "memory_delete",
    description: "Delete a memory entry by its ID",
    inputSchema: MEMORY_DELETE_SCHEMA,
  },
  {
    name: "memory_search",
    description:
      "Full-text search across memory using BM25 ranking. Type guidance: user (feedback, preferences), agent (patterns, decisions), project (architecture, references). Scope filters results to a specific layer (omit for all). Returns key, content, score, snippet, and tags.",
    inputSchema: MEMORY_SEARCH_SCHEMA,
  },
  {
    name: "memory_list",
    description:
      "List memory entries by scope. Returns all entries for the given scope with their keys, content, and tags.",
    inputSchema: MEMORY_LIST_SCHEMA,
  },
  {
    name: "memory_forget",
    description: "Delete a memory entry by its ID (alias for memory_delete)",
    inputSchema: MEMORY_FORGET_SCHEMA,
  },
  {
    name: "knowledge_search",
    description: "Search the knowledge base using natural language. Returns ranked results with content and relevance scores.",
    inputSchema: KNOWLEDGE_SEARCH_SCHEMA,
  },
  {
    name: "knowledge_sources",
    description: "List all knowledge sources registered for an app",
    inputSchema: KNOWLEDGE_SOURCES_SCHEMA,
  },
  {
    name: "knowledge_ingest",
    description: "Ingest content into a knowledge base. Use source (URL/file) or content (raw text). Content is chunked, embedded, and stored.",
    inputSchema: KNOWLEDGE_INGEST_SCHEMA,
  },
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
    name: "integration_execute",
    description: "Execute an integration operation for a tenant using their stored credentials",
    inputSchema: INTEGRATION_EXECUTE_SCHEMA,
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
    name: "enrichment_get",
    description: "Retrieve enrichment data for a completed conversation session",
    inputSchema: ENRICHMENT_GET_SCHEMA,
  },
  {
    name: "enrichment_list",
    description: "List enrichment records for a tenant with cursor-based pagination",
    inputSchema: ENRICHMENT_LIST_SCHEMA,
  },
  {
    name: "cross_agent_memory_recall",
    description: "Recall shared memory entries from the team scope, accessible by all agents",
    inputSchema: CROSS_AGENT_MEMORY_RECALL_SCHEMA,
  },
  {
    name: "cross_agent_memory_store",
    description: "Store a shared memory entry in the team scope so all agents can access it",
    inputSchema: CROSS_AGENT_MEMORY_STORE_SCHEMA,
  },
  {
    name: "cross_agent_memory_list",
    description: "List all shared memory entries for a team",
    inputSchema: CROSS_AGENT_MEMORY_LIST_SCHEMA,
  },
  {
    name: "cross_agent_memory_delete",
    description: "Delete a shared memory entry by ID (validates team ownership)",
    inputSchema: CROSS_AGENT_MEMORY_DELETE_SCHEMA,
  },
  {
    name: "budget_check",
    description: "Check remaining budget for a tenant against the app's billing endpoint",
    inputSchema: BUDGET_CHECK_SCHEMA,
  },
  {
    name: "budget_report",
    description: "Report token usage for a tenant to the app's billing endpoint",
    inputSchema: BUDGET_REPORT_SCHEMA,
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
