import type { KilnAppConfig, SystemPromptOptions } from "../config.js";

/** Build a structured system prompt using the app's custom builder. */
export function buildSystemPrompt(
  config: KilnAppConfig,
  options: SystemPromptOptions,
): string {
  return config.buildSystemPrompt(options);
}

interface McpConfig {
  readonly mcpServers: {
    readonly [name: string]: {
      readonly command: string;
      readonly args: readonly string[];
      readonly transportType: string;
    };
  };
}

/** Build MCP config JSON object for standalone MCP server usage. */
export function buildMcpConfig(serverEntryPath: string, mcpServerName: string): McpConfig {
  return {
    mcpServers: {
      [mcpServerName]: {
        command: "bun",
        args: ["run", serverEntryPath],
        transportType: "stdio",
      },
    },
  };
}
