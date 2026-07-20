// App Gateway MCP admission references canonical Kiln server identities.

export interface McpConfig {
  readonly servers: readonly string[];
}

export interface McpValidationError {
  readonly field: string;
  readonly message: string;
}

const SERVER_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;

export function validateMcpConfig(config: McpConfig): McpValidationError[] {
  const errors: McpValidationError[] = [];
  if (!Array.isArray(config.servers) || config.servers.length === 0) {
    return [{ field: "servers", message: "must be a non-empty array" }];
  }
  const seen = new Set<string>();
  for (let index = 0; index < config.servers.length; index++) {
    const serverId = config.servers[index];
    if (typeof serverId !== "string" || !SERVER_ID_PATTERN.test(serverId)) {
      errors.push({ field: `servers[${index}]`, message: "must be a canonical MCP server id" });
      continue;
    }
    if (seen.has(serverId)) {
      errors.push({ field: `servers[${index}]`, message: "duplicate canonical server id" });
      continue;
    }
    seen.add(serverId);
  }
  return errors;
}
