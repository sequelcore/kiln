import { parse } from "yaml";
import { KilnError } from "../errors.js";
import { validateGatewayAuthConfig } from "./auth-config.js";
import {
  describeRunningGatewayConfigSchema,
  parseGatewayConfigStructure,
  type GatewayConfig,
} from "./gateway-config-schema.js";
import { validateGatewayConfig, type GatewayValidationError } from "./gateway-config.js";
import { validateGatewayMcpConfig } from "./mcp-config.js";
import { validateObservabilityConfig } from "./observability-config.js";

/** Gateway YAML boundary failure with stable, source-qualified field diagnostics. */
export class GatewayLoaderError extends KilnError {
  readonly errors: readonly GatewayValidationError[];
  readonly sourcePath: string;

  constructor(
    errors: readonly GatewayValidationError[],
    sourcePath = "gateway.yaml",
    options?: { readonly includeBuildIdentity?: boolean },
  ) {
    const detail = errors.map((error) => `  ${error.field}: ${error.message}`).join("\n");
    const buildIdentity = options?.includeBuildIdentity === true
      ? `\nValidated by ${describeRunningGatewayConfigSchema()}; if this field exists at HEAD, the running build predates it.`
      : "";
    super("GATEWAY_YAML_INVALID", `Invalid gateway YAML from ${sourcePath}:\n${detail}${buildIdentity}`, {
      context: { errors, sourcePath },
      retryable: false,
    });
    this.name = "GatewayLoaderError";
    this.errors = errors;
    this.sourcePath = sourcePath;
  }
}

/** Parses YAML through the strict structural schema, then applies named semantic admission. */
export function parseGatewayYaml(content: string, sourcePath = "gateway.yaml"): GatewayConfig {
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    throw new GatewayLoaderError([{ field: "yaml", message: String(error) }], sourcePath);
  }

  const structural = parseGatewayConfigStructure(parsed);
  if (!structural.ok) {
    throw new GatewayLoaderError(
      structural.errors.map(({ field, message }) => ({ field, message })),
      sourcePath,
      { includeBuildIdentity: structural.errors.some((error) => error.unknownField) },
    );
  }

  const config = resolveGatewayEnvironmentReferences(structural.value);
  const errors: GatewayValidationError[] = [];
  if (config.observability) errors.push(...validateObservabilityConfig(config.observability));
  if (config.auth) errors.push(...validateGatewayAuthConfig(config.auth));
  if (config.mcp) errors.push(...validateGatewayMcpConfig(config.mcp));
  errors.push(...validateGatewayConfig(config));
  if (errors.length > 0) throw new GatewayLoaderError(errors, sourcePath);
  return config;
}

function resolveGatewayEnvironmentReferences(config: GatewayConfig): GatewayConfig {
  const auth = config.auth;
  const jwksUri = auth?.jwksUri;
  if (!auth || !jwksUri?.startsWith("$")) return config;
  return {
    ...config,
    auth: {
      ...auth,
      jwksUri: process.env[jwksUri.slice(1)] ?? "",
    },
  };
}
