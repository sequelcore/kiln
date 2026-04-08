import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  BashTool,
  DevToolExecutionBridge,
  DevToolRegistry,
  DevToolsMcpServer,
  EditTool,
  GitTool,
  GlobTool,
  GrepTool,
  ReadTool,
  WriteTool,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";

export interface ToolsCommandFlags {
  readonly mcp?: boolean;
}

interface ConnectableMcpServer {
  connect(transport: StdioServerTransport): Promise<void>;
}

export async function toolsCommand(
  _appConfig: KilnAppConfig,
  flags: ToolsCommandFlags,
): Promise<void> {
  if (!flags.mcp) {
    console.error("Usage: kiln tools --mcp");
    return;
  }

  const registry = createDefaultDevToolRegistry();
  const bridge = new DevToolExecutionBridge({ registry });
  const server = new DevToolsMcpServer({ bridge });

  await server.initialize();

  const mcpServer = server.createServer() as unknown as ConnectableMcpServer;
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error("kiln dev tools MCP server running (stdio)");
}

function createDefaultDevToolRegistry(): DevToolRegistry {
  const registry = new DevToolRegistry();
  registry.register(new BashTool());
  registry.register(new ReadTool());
  registry.register(new WriteTool());
  registry.register(new EditTool());
  registry.register(new GrepTool());
  registry.register(new GlobTool());
  registry.register(new GitTool());
  return registry;
}
