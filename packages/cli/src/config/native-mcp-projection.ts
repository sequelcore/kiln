import type { McpValueReference, ResolvedMcpServer } from "@kilnai/core";

export type NativeMcpHarness = "claude" | "codex" | "opencode";

export type NativeMcpServerProjection =
  | { readonly status: "compatible"; readonly entry: Record<string, unknown> }
  | { readonly status: "disabled"; readonly reason: string }
  | { readonly status: "incompatible"; readonly reason: string };

export function projectMcpServer(
  harness: NativeMcpHarness,
  server: ResolvedMcpServer,
): NativeMcpServerProjection {
  if (!server.enabled || server.admission?.state !== "admitted") {
    return {
      status: "disabled",
      reason: !server.enabled ? "The canonical server is disabled." : "The canonical server is not admitted.",
    };
  }
  const incompatibility = commonIncompatibility(harness, server);
  if (incompatibility) return { status: "incompatible", reason: incompatibility };

  switch (harness) {
    case "codex":
      return { status: "compatible", entry: projectCodex(server) };
    case "claude":
      return { status: "compatible", entry: projectClaude(server) };
    case "opencode":
      return { status: "compatible", entry: projectOpenCode(server) };
  }
}

function commonIncompatibility(harness: NativeMcpHarness, server: ResolvedMcpServer): string | undefined {
  if (server.maxCapabilities !== undefined) {
    return `${harness} native MCP configuration cannot enforce Kiln's capability catalog limit.`;
  }
  if (hasCredentialReference(server.env) || hasCredentialReference(server.headers)) {
    return `${harness} native MCP configuration cannot resolve Kiln credential references.`;
  }
  if (server.reconnect) {
    return `${harness} native MCP configuration cannot preserve Kiln reconnect semantics.`;
  }
  if (server.admission?.resources || server.admission?.prompts) {
    return `${harness} native MCP configuration cannot enforce resource or prompt admission lists.`;
  }
  if (server.admission?.effects && Object.keys(server.admission.effects).length > 0) {
    return `${harness} native MCP configuration cannot enforce Kiln action-effect envelopes.`;
  }
  if (harness !== "codex" && (server.admission?.tools?.allow || server.admission?.tools?.deny)) {
    return `${harness} server configuration cannot enforce Kiln tool admission lists without weakening policy.`;
  }
  if (harness !== "codex" && server.cwd) {
    return `${harness} native MCP configuration cannot represent a per-server working directory.`;
  }
  if (harness !== "codex" && (server.startupTimeoutMs || server.requestTimeoutMs)) {
    return `${harness} native MCP configuration cannot preserve distinct Kiln startup and request timeouts.`;
  }
  if (harness === "codex" && server.env) {
    for (const [name, reference] of Object.entries(server.env)) {
      if ("fromEnv" in reference && reference.fromEnv !== name) {
        return `Codex native MCP env inheritance cannot rename ${reference.fromEnv} to ${name}.`;
      }
    }
  }
  return undefined;
}

function projectCodex(server: ResolvedMcpServer): Record<string, unknown> {
  const entry: Record<string, unknown> = server.transport === "stdio"
    ? {
      command: server.command,
      args: [...(server.args ?? [])],
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...codexStdioEnvironment(server.env),
    }
    : {
      url: server.url,
      ...codexHttpHeaders(server.headers),
    };
  entry.enabled = true;
  entry.default_tools_approval_mode = "prompt";
  if (server.startupTimeoutMs) entry.startup_timeout_sec = server.startupTimeoutMs / 1000;
  if (server.requestTimeoutMs) entry.tool_timeout_sec = server.requestTimeoutMs / 1000;
  if (server.admission?.tools?.allow) entry.enabled_tools = [...server.admission.tools.allow];
  if (server.admission?.tools?.deny) entry.disabled_tools = [...server.admission.tools.deny];
  return entry;
}

function codexStdioEnvironment(values: Readonly<Record<string, McpValueReference>> | undefined): Record<string, unknown> {
  const env: Record<string, string> = {};
  const envVars: string[] = [];
  for (const [name, reference] of Object.entries(values ?? {})) {
    if ("value" in reference) env[name] = reference.value;
    if ("fromEnv" in reference) envVars.push(reference.fromEnv);
  }
  return {
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(envVars.length > 0 ? { env_vars: envVars } : {}),
  };
}

function codexHttpHeaders(values: Readonly<Record<string, McpValueReference>> | undefined): Record<string, unknown> {
  const httpHeaders: Record<string, string> = {};
  const envHttpHeaders: Record<string, string> = {};
  for (const [name, reference] of Object.entries(values ?? {})) {
    if ("value" in reference) httpHeaders[name] = reference.value;
    if ("fromEnv" in reference) envHttpHeaders[name] = reference.fromEnv;
  }
  return {
    ...(Object.keys(httpHeaders).length > 0 ? { http_headers: httpHeaders } : {}),
    ...(Object.keys(envHttpHeaders).length > 0 ? { env_http_headers: envHttpHeaders } : {}),
  };
}

function projectClaude(server: ResolvedMcpServer): Record<string, unknown> {
  return server.transport === "stdio"
    ? {
      type: "stdio",
      command: server.command,
      args: [...(server.args ?? [])],
      ...substitutedValues("env", server.env, "${", "}"),
    }
    : {
      type: "http",
      url: server.url,
      ...substitutedValues("headers", server.headers, "${", "}"),
    };
}

function projectOpenCode(server: ResolvedMcpServer): Record<string, unknown> {
  return server.transport === "stdio"
    ? {
      type: "local",
      command: [server.command, ...(server.args ?? [])],
      enabled: true,
      ...substitutedValues("environment", server.env, "{env:", "}"),
    }
    : {
      type: "remote",
      url: server.url,
      enabled: true,
      ...substitutedValues("headers", server.headers, "{env:", "}"),
    };
}

function substitutedValues(
  field: string,
  values: Readonly<Record<string, McpValueReference>> | undefined,
  prefix: string,
  suffix: string,
): Record<string, unknown> {
  const projected: Record<string, string> = {};
  for (const [name, reference] of Object.entries(values ?? {})) {
    if ("value" in reference) projected[name] = reference.value;
    if ("fromEnv" in reference) projected[name] = `${prefix}${reference.fromEnv}${suffix}`;
  }
  return Object.keys(projected).length > 0 ? { [field]: projected } : {};
}

function hasCredentialReference(values: Readonly<Record<string, McpValueReference>> | undefined): boolean {
  return Object.values(values ?? {}).some((reference) => "fromCredential" in reference);
}
