import { join } from "node:path";
import os from "node:os";
import { generateMcpConfig, type McpClient, type McpServerDef } from "../mcp/config-generator.js";
import type { KilnAppConfig } from "../config.js";

export interface McpConfigFlags {
  readonly client?: string;
  readonly name?: string;
  readonly command?: string;
  readonly args?: string;
}

const DEFAULT_MCP_SERVER_NAME = "kiln";
const DEFAULT_MCP_COMMAND = "kiln";
const DEFAULT_MCP_ARGS = ["tools", "--mcp"] as const;

export async function mcpConfigCommand(
  _appConfig: KilnAppConfig,
  flags: McpConfigFlags,
): Promise<void> {
  const client = (flags.client ?? "claude-code") as McpClient;
  const name = flags.name ?? DEFAULT_MCP_SERVER_NAME;
  const command = flags.command ?? DEFAULT_MCP_COMMAND;
  const args = flags.args
    ? flags.args.split(" ").filter(Boolean)
    : [...DEFAULT_MCP_ARGS];

  const serverDef: McpServerDef = { name, command, args };

  await generateMcpConfig(client, serverDef, process.cwd());

  if (client === "all") {
    console.log(`MCP config written for all clients (claude-code, codex, opencode): ${name}`);
  } else {
    const target = targetPath(client, process.cwd());
    console.log(`MCP config written to ${target}: ${name}`);
  }
}

function targetPath(client: McpClient, projectPath: string): string {
  if (client === "claude-code") return join(projectPath, ".mcp.json");
  if (client === "codex") return join(os.homedir(), ".codex", "config.toml");
  return join(os.homedir(), ".config", "opencode", "opencode.json");
}
