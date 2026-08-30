import { projectToolResourceDescriptor } from "@kilnai/core";
import {
  type OperatorResourceProviderReadResult,
  type OperatorResourceReadRequest,
  projectOperatorResourceReadPresentation,
  projectOperatorResourceReadResult,
} from "@kilnai/gateway-contracts";
import { createDefaultBuiltinToolSurface, DevToolsMcpServer } from "@kilnai/runtime";
import type { McpServer, Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfiguredBuiltinToolSurfaceOptions } from "../config/builtin-tool-surface-config.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { resolveModelFacingPermissionPolicy } from "../config/model-facing-permission-policy.js";
import type { KilnAppConfig } from "../config.js";

export interface ToolsCommandFlags {
  readonly mcp?: boolean;
  readonly resources?: boolean;
  readonly resource?: string;
  readonly gatewayTargetId?: string;
  readonly appId?: string;
  readonly tenantId?: string;
  readonly sessionId?: string;
}

export async function toolsCommand(
  _appConfig: KilnAppConfig,
  flags: ToolsCommandFlags,
): Promise<void> {
  const projectPath = process.cwd();
  const kilnYaml = _appConfig.kilnYaml ?? await loadKilnConfig(projectPath) ?? undefined;
  const appConfig = kilnYaml === _appConfig.kilnYaml
    ? _appConfig
    : { ..._appConfig, kilnYaml };
  const memoryAuthority = flags.mcp
    ? {
      modelFacingSession: true,
      permissionPolicy: resolveModelFacingPermissionPolicy(kilnYaml?.permissions),
      caller: { kind: "operator_surface" as const, id: "tools-mcp" },
    }
    : undefined;
  const surfaceOptions = memoryAuthority
    ? await loadConfiguredBuiltinToolSurfaceOptions(appConfig, projectPath, { memoryAuthority })
    : await loadConfiguredBuiltinToolSurfaceOptions(appConfig, projectPath);
  const surface = createDefaultBuiltinToolSurface(surfaceOptions);

  if (flags.resources) {
    console.log(JSON.stringify(surface.resources.list().map(projectToolResourceDescriptor), null, 2));
    return;
  }

  if (flags.resource) {
    const target = buildResourceReadTarget(flags);
    if (!target) {
      throw new Error("Resource reads require --session-id authority scope.");
    }
    const result = await surface.resources.read(flags.resource, { target });
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

  const mcpServer = server.createServer();
  serveStdio(() => mcpServer as unknown as McpServer | Server, { legacy: "reject" });

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
  if (!flags.sessionId) {
    return undefined;
  }
  const target = {
    ...(flags.gatewayTargetId ? { gatewayTargetId: flags.gatewayTargetId } : {}),
    ...(flags.appId ? { appId: flags.appId } : {}),
    ...(flags.tenantId ? { tenantId: flags.tenantId } : {}),
    sessionId: flags.sessionId,
    ...(flags.resource ? { resourceUri: flags.resource } : {}),
  };
  return Object.keys(target).length > 0 ? target : undefined;
}
