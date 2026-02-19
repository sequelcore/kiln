import { generateConfig, type McpClient } from "../mcp/config-generator.js";
import type { KilnAppConfig } from "../config.js";

export function mcpConfigCommand(
  appConfig: KilnAppConfig,
  client?: string,
  transport?: string,
  port?: number,
): void {
  const config = {
    client: (client as McpClient) ?? "claude-code",
    transport: (transport as "stdio" | "sse") ?? "stdio",
    port,
    mcpServerName: appConfig.mcpServerName,
    appName: appConfig.appName,
  };

  console.log(generateConfig(config));
}
