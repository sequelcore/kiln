import { readSource, saveBrief, searchSources } from "./mock-sources.js";
import { startStrictMcpToolServer } from "../shared/strict-mcp-tool-server.js";

const PORT = 3400;

const TOOLS = [
  {
    name: "search_sources",
    description: "Search the local source catalog by topic or keyword",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Research query or keyword" } },
      required: ["query"],
    },
  },
  {
    name: "read_source",
    description: "Read one source record by ID",
    inputSchema: {
      type: "object",
      properties: { sourceId: { type: "string", description: "Source ID returned by search_sources" } },
      required: ["sourceId"],
    },
  },
  {
    name: "save_brief",
    description: "Store a generated brief draft for later review",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Brief topic" },
        summary: { type: "string", description: "Brief text" },
        citations: { type: "array", items: { type: "string" }, description: "Source IDs cited by the brief" },
      },
      required: ["topic", "summary", "citations"],
    },
  },
] as const;

async function executeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search_sources":
      return searchSources(String(args.query ?? ""));
    case "read_source": {
      const source = readSource(String(args.sourceId ?? ""));
      return source ?? { error: "source_not_found" };
    }
    case "save_brief":
      return saveBrief(
        String(args.topic ?? ""),
        String(args.summary ?? ""),
        Array.isArray(args.citations) ? args.citations.map(String) : [],
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

startStrictMcpToolServer({
  port: PORT,
  name: "research-tools",
  version: "2.1.0",
  tools: TOOLS,
  executeTool,
});
