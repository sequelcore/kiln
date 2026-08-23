// Engine type: GatewayMcpConfig -- gateway-level MCP server configuration
// Domain types only -- no external dependencies

/** Authentication type for the MCP server endpoint */
export type McpAuthType = "api-key" | "none";

/** Authentication configuration for the MCP server */
export interface GatewayMcpAuthConfig {
  readonly type: McpAuthType;
  /** Required when type is "api-key": env var name containing the API key */
  readonly keyEnv?: string;
}

/**
 * Gateway-level MCP server configuration.
 * Loaded from the `mcp` block in gateway.yaml.
 *
 * Exposes governed gateway capabilities (cost, safety, evaluation, and coordination)
 * as MCP tools for external agents (Claude Code, Codex CLI, etc.).
 */
export interface GatewayMcpConfig {
  readonly enabled: boolean;
  /** URL path where the MCP server listens (default: "/mcp") */
  readonly path?: string;
  /** Optional authentication for the MCP endpoint */
  readonly auth?: GatewayMcpAuthConfig;
}

/** Validation error for MCP configuration */
export interface GatewayMcpValidationError {
  readonly field: string;
  readonly message: string;
}

const VALID_AUTH_TYPES: readonly McpAuthType[] = ["api-key", "none"];

/** Validate a GatewayMcpConfig. Returns an array of errors; empty means valid. */
export function validateGatewayMcpConfig(config: GatewayMcpConfig): GatewayMcpValidationError[] {
  const errors: GatewayMcpValidationError[] = [];

  if (typeof config.enabled !== "boolean") {
    errors.push({ field: "mcp.enabled", message: "must be a boolean" });
  }

  if (config.path !== undefined) {
    if (typeof config.path !== "string" || !config.path.startsWith("/")) {
      errors.push({ field: "mcp.path", message: "must be a string starting with \"/\"" });
    }
  }

  if (config.auth !== undefined) {
    if (!VALID_AUTH_TYPES.includes(config.auth.type)) {
      errors.push({ field: "mcp.auth.type", message: `must be one of: ${VALID_AUTH_TYPES.join(", ")}` });
    } else if (config.auth.type === "api-key") {
      if (!config.auth.keyEnv || typeof config.auth.keyEnv !== "string" || !config.auth.keyEnv.trim()) {
        errors.push({ field: "mcp.auth.keyEnv", message: "required when type is api-key" });
      }
    }
  }

  return errors;
}
