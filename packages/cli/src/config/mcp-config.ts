import {
  normalizeActionEffectEnvelope,
  validateMcpConfigurationSource,
  type McpConfigurationScope,
  type McpConfigurationSource,
  type McpServerConfiguration,
} from "@kilnai/core";
import { KilnYamlError } from "../kiln-yaml-types.js";

export function readMcpConfigurationSource(input: {
  readonly value: unknown;
  readonly scope: McpConfigurationScope;
  readonly sourcePath: string;
}): McpConfigurationSource | undefined {
  if (input.value === undefined) return undefined;
  if (!isRecord(input.value)) {
    throw new KilnYamlError("mcp must be an object");
  }
  for (const key of Object.keys(input.value)) {
    if (key !== "servers") {
      throw new KilnYamlError(`Unknown mcp field: ${key}`);
    }
  }
  if (!isRecord(input.value.servers)) {
    throw new KilnYamlError("mcp.servers must be an object");
  }

  const servers: Record<string, McpServerConfiguration> = {};
  for (const [serverId, server] of Object.entries(input.value.servers)) {
    if (!isRecord(server)) {
      throw new KilnYamlError(`mcp.servers.${serverId} must be an object`);
    }
    servers[serverId] = parseServer(serverId, server);
  }

  const source: McpConfigurationSource = {
    scope: input.scope,
    sourcePath: input.sourcePath,
    servers,
  };
  const diagnostics = validateMcpConfigurationSource(source);
  if (diagnostics.length > 0) {
    const first = diagnostics[0]!;
    throw new KilnYamlError(
      `${first.code}: ${first.message} (${first.sourcePath}${first.field ? `#mcp.servers.${first.serverId}.${first.field}` : ""})`,
    );
  }
  return source;
}

const SERVER_FIELDS = new Set([
  "enabled", "transport", "command", "args", "cwd", "env", "url", "headers",
  "startupTimeoutMs", "requestTimeoutMs", "maxCapabilities", "reconnect", "admission", "capabilityBindings", "trust",
]);

function parseServer(serverId: string, value: Record<string, unknown>): McpServerConfiguration {
  for (const key of Object.keys(value)) {
    if (!SERVER_FIELDS.has(key)) throw invalid(serverId, `Unknown mcp.servers.${serverId} field: ${key}`);
  }
  assertOptionalType(serverId, value, "enabled", "boolean");
  assertOptionalType(serverId, value, "transport", "string");
  assertOptionalType(serverId, value, "command", "string");
  assertOptionalType(serverId, value, "cwd", "string");
  assertOptionalType(serverId, value, "url", "string");
  assertOptionalType(serverId, value, "startupTimeoutMs", "number");
  assertOptionalType(serverId, value, "requestTimeoutMs", "number");
  assertOptionalType(serverId, value, "maxCapabilities", "number");
  assertOptionalType(serverId, value, "trust", "string");
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((item) => typeof item !== "string"))) {
    throw invalid(serverId, `mcp.servers.${serverId}.args must be an array of strings`);
  }
  if (value.env !== undefined) parseValueReferences(serverId, "env", value.env);
  if (value.headers !== undefined) parseValueReferences(serverId, "headers", value.headers);
  if (value.reconnect !== undefined) parseReconnect(serverId, value.reconnect);
  if (value.admission !== undefined) parseAdmission(serverId, value.admission);
  return value as unknown as McpServerConfiguration;
}

function parseValueReferences(serverId: string, field: "env" | "headers", value: unknown): void {
  if (!isRecord(value)) throw invalid(serverId, `mcp.servers.${serverId}.${field} must be an object`);
  for (const [name, reference] of Object.entries(value)) {
    if (!isRecord(reference)) throw invalid(serverId, `mcp.servers.${serverId}.${field}.${name} must be a value reference`);
    const keys = Object.keys(reference);
    if (keys.length !== 1 || !["value", "fromEnv", "fromCredential"].includes(keys[0] ?? "")) {
      throw invalid(serverId, `mcp.servers.${serverId}.${field}.${name} must declare exactly one value, fromEnv, or fromCredential reference`);
    }
    if (typeof reference[keys[0]!] !== "string" || (reference[keys[0]!] as string).length === 0) {
      throw invalid(serverId, `mcp.servers.${serverId}.${field}.${name} reference must be a non-empty string`);
    }
  }
}

function parseReconnect(serverId: string, value: unknown): void {
  if (!isRecord(value)) throw invalid(serverId, `mcp.servers.${serverId}.reconnect must be an object`);
  for (const key of Object.keys(value)) {
    if (!["maxAttempts", "initialDelayMs", "maxDelayMs"].includes(key)) {
      throw invalid(serverId, `Unknown mcp.servers.${serverId}.reconnect field: ${key}`);
    }
  }
  if (typeof value.maxAttempts !== "number") {
    throw invalid(serverId, `mcp.servers.${serverId}.reconnect.maxAttempts must be a number`);
  }
  assertOptionalType(serverId, value, "initialDelayMs", "number", "reconnect.");
  assertOptionalType(serverId, value, "maxDelayMs", "number", "reconnect.");
}

function parseAdmission(serverId: string, value: unknown): void {
  if (!isRecord(value)) throw invalid(serverId, `mcp.servers.${serverId}.admission must be an object`);
  for (const key of Object.keys(value)) {
    if (!["state", "tools", "resources", "prompts", "effects"].includes(key)) {
      throw invalid(serverId, `Unknown mcp.servers.${serverId}.admission field: ${key}`);
    }
  }
  if (value.state !== "admitted" && value.state !== "denied") {
    throw invalid(serverId, `mcp.servers.${serverId}.admission.state must be admitted or denied`);
  }
  for (const kind of ["tools", "resources", "prompts"] as const) {
    const policy = value[kind];
    if (policy === undefined) continue;
    if (!isRecord(policy)) throw invalid(serverId, `mcp.servers.${serverId}.admission.${kind} must be an object`);
    for (const key of Object.keys(policy)) {
      if (key !== "allow" && key !== "deny") {
        throw invalid(serverId, `Unknown mcp.servers.${serverId}.admission.${kind} field: ${key}`);
      }
    }
    for (const list of ["allow", "deny"] as const) {
      if (policy[list] !== undefined && (!Array.isArray(policy[list]) || policy[list].some((item) => typeof item !== "string"))) {
        throw invalid(serverId, `mcp.servers.${serverId}.admission.${kind}.${list} must be an array of strings`);
      }
    }
  }
  if (value.effects !== undefined) {
    if (!isRecord(value.effects)) throw invalid(serverId, `mcp.servers.${serverId}.admission.effects must be an object`);
    for (const [toolName, effect] of Object.entries(value.effects)) {
      if (toolName.trim().length === 0 || !normalizeActionEffectEnvelope(effect)) {
        throw invalid(serverId, `mcp.servers.${serverId}.admission.effects.${toolName} must be a complete valid action-effect envelope`);
      }
    }
  }
}

function assertOptionalType(
  serverId: string,
  value: Record<string, unknown>,
  field: string,
  type: "boolean" | "string" | "number",
  prefix = "",
): void {
  if (value[field] !== undefined && typeof value[field] !== type) {
    throw invalid(serverId, `mcp.servers.${serverId}.${prefix}${field} must be a ${type}`);
  }
}

function invalid(_serverId: string, message: string): KilnYamlError {
  return new KilnYamlError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
