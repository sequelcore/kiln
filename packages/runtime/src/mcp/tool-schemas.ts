// MCP server: tool input schemas for the 7 gateway MCP tools
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
    content: {
      type: "string",
      description: "Content to store",
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

/** All tool definitions for the gateway MCP server */
export const GATEWAY_MCP_TOOLS = [
  {
    name: "memory_recall",
    description: "Recall memory entries by scope with optional FTS search query and tag filter",
    inputSchema: MEMORY_RECALL_SCHEMA,
  },
  {
    name: "memory_store",
    description: "Store a new memory entry with scope, key, content, and optional tags",
    inputSchema: MEMORY_STORE_SCHEMA,
  },
  {
    name: "memory_delete",
    description: "Delete a memory entry by its ID",
    inputSchema: MEMORY_DELETE_SCHEMA,
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
    name: "cost_summary",
    description: "Get the current cost summary including total tokens, cost in USD, and per-role:model breakdown",
    inputSchema: COST_SUMMARY_SCHEMA,
  },
  {
    name: "safety_metrics",
    description: "Get safety pipeline metrics including PII detections, content classifications, and rail triggers",
    inputSchema: SAFETY_METRICS_SCHEMA,
  },
] as const;

export type GatewayMcpToolName = (typeof GATEWAY_MCP_TOOLS)[number]["name"];
