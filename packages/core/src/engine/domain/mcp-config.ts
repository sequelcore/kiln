// McpConfig types -- YAML configuration for dynamic MCP server connections

export type McpTransport = "sse";

export interface McpServerConfig {
  readonly name: string;
  readonly transport: McpTransport;
  readonly url?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly reconnect?: boolean;
}

export interface McpConfig {
  readonly servers: readonly McpServerConfig[];
}

export interface McpValidationError {
  readonly field: string;
  readonly message: string;
}

export function validateMcpConfig(config: McpConfig): McpValidationError[] {
  const errors: McpValidationError[] = [];

  if (!config.servers || !Array.isArray(config.servers) || config.servers.length === 0) {
    errors.push({ field: "servers", message: "must be a non-empty array" });
    return errors;
  }

  const serverNames = new Set<string>();
  for (let i = 0; i < config.servers.length; i++) {
    const server = config.servers[i]!;

    if (!server.name || typeof server.name !== "string") {
      errors.push({ field: `servers[${i}].name`, message: "must be a non-empty string" });
    } else if (serverNames.has(server.name)) {
      errors.push({ field: `servers[${i}].name`, message: "duplicate server name" });
    } else {
      serverNames.add(server.name);
    }

    if (!server.transport || !["sse", "stdio"].includes(server.transport)) {
      errors.push({ field: `servers[${i}].transport`, message: "must be 'sse' or 'stdio'" });
    }

    if (server.transport === "sse") {
      if (!server.url || typeof server.url !== "string") {
        errors.push({ field: `servers[${i}].url`, message: "required when transport is 'sse'" });
      }
    }

    if (server.transport === "stdio") {
      if (!server.command || typeof server.command !== "string") {
        errors.push({ field: `servers[${i}].command`, message: "required when transport is 'stdio'" });
      }
    }
  }

  return errors;
}
