export type McpClient = "claude-code" | "cursor" | "generic";

export interface McpClientConfig {
  readonly client: McpClient;
  readonly transport: "stdio" | "sse";
  readonly port?: number;
  readonly mcpServerName: string;
  readonly appName: string;
}

export function generateConfig(config: McpClientConfig): string {
  const serverName = config.mcpServerName;
  const mcpBin = `${config.appName}-mcp`;

  if (config.client === "claude-code" && config.transport === "stdio") {
    return JSON.stringify({
      mcpServers: {
        [serverName]: {
          command: mcpBin,
          args: [],
          env: {},
        },
      },
    }, null, 2);
  }

  if (config.client === "cursor" && config.transport === "stdio") {
    return JSON.stringify({
      mcpServers: {
        [serverName]: {
          command: mcpBin,
          args: [],
          transportType: "stdio",
        },
      },
    }, null, 2);
  }

  // Generic or SSE
  const port = config.port ?? 3001;
  if (config.transport === "sse") {
    return JSON.stringify({
      mcpServers: {
        [serverName]: {
          url: `http://localhost:${port}/sse`,
          transportType: "sse",
        },
      },
    }, null, 2);
  }

  // Generic stdio
  return JSON.stringify({
    mcpServers: {
      [serverName]: {
        command: mcpBin,
        args: [],
        transportType: "stdio",
      },
    },
  }, null, 2);
}
