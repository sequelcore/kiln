// McpConfig types -- YAML configuration for MCP server connections

export interface McpServerConfig {
  readonly name: string;
  readonly url: string;
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

    if (!server.url || typeof server.url !== "string") {
      errors.push({ field: `servers[${i}].url`, message: "must be a non-empty string" });
    }
  }

  return errors;
}
