// Engine type: GatewayMcpConfig -- gateway-level MCP server configuration
// Domain types only -- no external dependencies

import type { GatewayMcpConfig, McpAuthType } from "./gateway-config-schema.js";

/** Schema-derived gateway MCP configuration and authentication types. */
export type { GatewayMcpAuthConfig, GatewayMcpConfig, McpAuthType } from "./gateway-config-schema.js";

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
