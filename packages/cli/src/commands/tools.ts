import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createDefaultBuiltinToolSurface,
  DevToolsMcpServer,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { loadConfiguredWebToolSurfaceOptions } from "../config/web-tools-config.js";

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

  const surface = createDefaultBuiltinToolSurface(
    await loadConfiguredWebToolSurfaceOptions(_appConfig, process.cwd()),
  );
  const server = new DevToolsMcpServer({
    bridge: surface.bridge,
    tools: surface.tools,
    resources: surface.resources,
    resourceNotifications: surface.resourceNotifications,
  });

  await server.initialize();

  const mcpServer = server.createServer() as unknown as ConnectableMcpServer;
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error("kiln dev tools MCP server running (stdio)");
}
