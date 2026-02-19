import { Orchestrator } from "@kilnai/core";
import { KilnMcpServer } from "../mcp/server.js";
import type { TransportType, TransportConfig } from "../mcp/transports.js";
import type { KilnAppConfig } from "../config.js";

export async function serveCommand(appConfig: KilnAppConfig, opts?: {
  transport?: TransportType;
  port?: number;
}): Promise<void> {
  const orchestrator = new Orchestrator({ requireApproval: false });
  const server = new KilnMcpServer(orchestrator);

  const config: TransportConfig = {
    type: opts?.transport ?? "stdio",
    port: opts?.port,
  };

  await server.start(config);

  if (config.type === "sse") {
    console.error(`${appConfig.appName} MCP server running (SSE on port ${config.port ?? 3001})`);
  } else {
    console.error(`${appConfig.appName} MCP server running (stdio)`);
  }

  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
