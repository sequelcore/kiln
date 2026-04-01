#!/usr/bin/env bun
import { serveCommand } from "./commands/serve.js";
import type { TransportType } from "./mcp/transports.js";
import type { KilnAppConfig } from "./config.js";

// Default minimal config for standalone MCP server usage
const defaultAppConfig: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry not configured for standalone MCP server");
  },
  buildSystemPrompt: () => {
    throw new Error("buildSystemPrompt not configured for standalone MCP server");
  },
};

const args = process.argv.slice(2);
const transportArg = args.find(a => a.startsWith("--transport="))?.split("=")[1];
const portArg = args.find(a => a.startsWith("--port="))?.split("=")[1];

await serveCommand(defaultAppConfig, {
  transport: (transportArg as TransportType) ?? "stdio",
  port: portArg ? parseInt(portArg, 10) : undefined,
});
