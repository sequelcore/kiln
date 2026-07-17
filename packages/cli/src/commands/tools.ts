import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createDefaultBuiltinToolSurface,
  DevToolsMcpServer,
  projectToolResourceDescriptor,
} from "@kilnai/core";
import {
  projectOperatorResourceReadPresentation,
  projectOperatorResourceReadResult,
  type OperatorResourceProviderReadResult,
  type OperatorResourceReadRequest,
} from "@kilnai/gateway-contracts";
import type { KilnAppConfig } from "../config.js";
import { loadConfiguredBuiltinToolSurfaceOptions } from "../config/builtin-tool-surface-config.js";

export interface ToolsCommandFlags {
  readonly mcp?: boolean;
  readonly resources?: boolean;
  readonly resource?: string;
  readonly gatewayTargetId?: string;
  readonly appId?: string;
  readonly tenantId?: string;
  readonly sessionId?: string;
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
    const target = buildResourceReadTarget(flags);
    const result = target
      ? await surface.resources.read(flags.resource, { target })
      : await surface.resources.read(flags.resource);
    console.log(formatResourceReadResult(flags.resource, result, target));
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

function formatResourceReadResult(
  uri: string,
  result: OperatorResourceProviderReadResult,
  target?: OperatorResourceReadRequest["target"],
): string {
  if (!result.summary && result.contents.length === 1 && "text" in result.contents[0]! && typeof result.contents[0]!.text === "string") {
    return result.contents[0]!.text;
  }
  const projected = projectOperatorResourceReadResult({
    uri,
    ...(target ? { target } : {}),
    readResult: result,
  });
  return JSON.stringify({
    ...projected,
    ...(projected.summary ? { presentation: projectOperatorResourceReadPresentation(projected) } : {}),
  }, null, 2);
}

function buildResourceReadTarget(flags: ToolsCommandFlags): OperatorResourceReadRequest["target"] | undefined {
  if (!flags.gatewayTargetId && !flags.appId && !flags.tenantId && !flags.sessionId) {
    return undefined;
  }
  const target = {
    ...(flags.gatewayTargetId ? { gatewayTargetId: flags.gatewayTargetId } : {}),
    ...(flags.appId ? { appId: flags.appId } : {}),
    ...(flags.tenantId ? { tenantId: flags.tenantId } : {}),
    ...(flags.sessionId ? { sessionId: flags.sessionId } : {}),
    ...(flags.resource ? { resourceUri: flags.resource } : {}),
  };
  return Object.keys(target).length > 0 ? target : undefined;
}
