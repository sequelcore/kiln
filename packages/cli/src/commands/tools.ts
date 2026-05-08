import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createDefaultBuiltinToolSurface,
  DevToolsMcpServer,
  projectToolResourceDescriptor,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { loadConfiguredBuiltinToolSurfaceOptions } from "../config/builtin-tool-surface-config.js";

export interface ToolsCommandFlags {
  readonly mcp?: boolean;
  readonly resources?: boolean;
  readonly resource?: string;
}

interface ConnectableMcpServer {
  connect(transport: StdioServerTransport): Promise<void>;
}

export async function toolsCommand(
  _appConfig: KilnAppConfig,
  flags: ToolsCommandFlags,
): Promise<void> {
  const memoryAuthority = flags.mcp
    ? {
      modelFacingSession: true,
      permissionPolicy: _appConfig.kilnYaml?.permissions,
      caller: { kind: "operator_surface" as const, id: "tools-mcp" },
    }
    : undefined;
  const surfaceOptions = memoryAuthority
    ? await loadConfiguredBuiltinToolSurfaceOptions(_appConfig, process.cwd(), { memoryAuthority })
    : await loadConfiguredBuiltinToolSurfaceOptions(_appConfig, process.cwd());
  const surface = createDefaultBuiltinToolSurface(surfaceOptions);

  if (flags.resources) {
    console.log(JSON.stringify(surface.resources.list().map(projectToolResourceDescriptor), null, 2));
    return;
  }

  if (flags.resource) {
    const result = await surface.resources.read(flags.resource);
    console.log(formatResourceReadResult(result));
    return;
  }

  if (!flags.mcp) {
    console.error("Usage: kiln tools --mcp | --resources | --resource <uri>");
    return;
  }

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

function formatResourceReadResult(result: { readonly contents: readonly ({ readonly text?: string } | { readonly blob?: string })[] }): string {
  if (result.contents.length === 1 && "text" in result.contents[0]! && typeof result.contents[0]!.text === "string") {
    return result.contents[0]!.text;
  }
  return JSON.stringify(result, null, 2);
}
