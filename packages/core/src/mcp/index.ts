import {
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  normalizeActionEffectEnvelope,
  type ActionEffectEnvelope,
} from "../engine/domain/action-effect.js";
import { isProxy } from "node:util/types";
import type {
  CapabilityApprovalPosture,
  CapabilityCallerId,
  CapabilityDataPosture,
  CapabilityImplementationKind,
  CapabilityKind,
  CapabilityLimits,
  CapabilityNetworkPosture,
  CapabilityOwnerKind,
  CapabilityPermission,
} from "../capabilities/capability-catalog.js";

export type McpConfigurationScope = "global" | "project";
export type McpTransport = "stdio" | "streamable-http";
export type McpCapabilityKind = "tool" | "resource" | "prompt";

export type McpValueReference =
  | { readonly value: string }
  | { readonly fromEnv: string }
  | { readonly fromCredential: string };

export interface McpCapabilityAdmissionList {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export interface McpServerAdmission {
  readonly state: "admitted" | "denied";
  readonly tools?: McpCapabilityAdmissionList;
  readonly resources?: McpCapabilityAdmissionList;
  readonly prompts?: McpCapabilityAdmissionList;
  /** Operator-owned maximum effects keyed by the server's unqualified tool name. */
  readonly effects?: Readonly<Record<string, ActionEffectEnvelope>>;
}

export interface McpReconnectPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
}

/**
 * The operator-owned, provider-neutral posture for one MCP tool. The server
 * identity, selector, and all content-addressed identities are derived only
 * when Core projects this configuration into the discovery adapter contract.
 */
export interface McpToolCapabilityBindingConfiguration {
  readonly capabilityId: string;
  readonly kind: CapabilityKind;
  readonly ownerKind: CapabilityOwnerKind;
  readonly implementationKind: CapabilityImplementationKind;
  readonly contractRevision?: string;
  readonly permissions: readonly CapabilityPermission[];
  readonly approval: CapabilityApprovalPosture;
  readonly network: CapabilityNetworkPosture;
  readonly data: CapabilityDataPosture;
  readonly supportedCallers: readonly CapabilityCallerId[];
  readonly limits: CapabilityLimits;
  readonly requiresStructuredOutput?: boolean;
}

export interface McpServerConfiguration {
  readonly enabled?: boolean;
  readonly transport?: McpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, McpValueReference>>;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, McpValueReference>>;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  /** Maximum combined tools, resources, and prompts accepted from discovery. */
  readonly maxCapabilities?: number;
  readonly reconnect?: McpReconnectPolicy;
  readonly admission?: McpServerAdmission;
  /** Explicit case-sensitive tool bindings owned by global MCP configuration. */
  readonly capabilityBindings?: Readonly<Record<string, McpToolCapabilityBindingConfiguration>>;
  readonly trust?: "untrusted" | "local" | "verified";
}

export interface McpConfigurationSource {
  readonly scope: McpConfigurationScope;
  readonly sourcePath: string;
  readonly servers: Readonly<Record<string, McpServerConfiguration>>;
}

export type McpConfigurationDiagnosticCode =
  | "MCP_SERVER_ID_INVALID"
  | "MCP_SERVER_DEFINITION_INCOMPLETE"
  | "MCP_TRANSPORT_INVALID"
  | "MCP_TRANSPORT_FIELDS_MIXED"
  | "MCP_TIMEOUT_INVALID"
  | "MCP_CATALOG_LIMIT_INVALID"
  | "MCP_RECONNECT_INVALID"
  | "MCP_EFFECT_POLICY_INVALID"
  | "MCP_CAPABILITY_BINDING_INVALID"
  | "MCP_VALUE_REFERENCE_INVALID"
  | "MCP_LITERAL_SECRET_FORBIDDEN"
  | "MCP_INCOMPLETE_TRANSPORT_REPLACEMENT"
  | "MCP_PROJECT_POLICY_WIDENING"
  | "MCP_SECRET_REFERENCE_MISSING"
  | "MCP_ENVIRONMENT_REFERENCE_MISSING"
  | "MCP_URL_INVALID";

export interface McpConfigurationDiagnostic {
  readonly code: McpConfigurationDiagnosticCode;
  readonly message: string;
  readonly serverId: string;
  readonly scope: McpConfigurationScope;
  readonly field?: string;
  readonly sourcePath: string;
  readonly reference?: string;
}

export interface McpFieldProvenance {
  readonly scope: McpConfigurationScope;
  readonly sourcePath: string;
  readonly field: string;
}

export interface ResolvedMcpServer extends McpServerConfiguration {
  readonly id: string;
  readonly enabled: boolean;
  readonly transport: McpTransport;
  readonly source: "global" | "project" | "overridden" | "disabled-by-project";
  readonly provenance: Readonly<Record<string, McpFieldProvenance>>;
  readonly connection: { readonly state: "not-tested" | "disabled" };
  readonly projection: { readonly state: "not-synchronized" };
}

export interface McpConfigurationResolution {
  readonly servers: Readonly<Record<string, ResolvedMcpServer>>;
  readonly diagnostics: readonly McpConfigurationDiagnostic[];
}

export interface ResolveMcpConfigurationInput {
  readonly global?: McpConfigurationSource;
  readonly project?: McpConfigurationSource;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly credentialExists?: (credentialId: string) => boolean;
}

const SERVER_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9][a-z0-9_-]{0,62})+$/u;
const TOOL_NAME_MAX_LENGTH = 127;
const MAX_CAPABILITY_BINDINGS = 10_000;
const CONTRACT_REVISION_MAX_LENGTH = 127;
const STDIO_FIELDS = new Set(["command", "args", "cwd", "env"]);
const HTTP_FIELDS = new Set(["url", "headers"]);
const SENSITIVE_HEADER_PATTERN = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;
const SENSITIVE_ENVIRONMENT_PATTERN = /(?:^|_)(?:api[_-]?key|token|secret|password|credential|private[_-]?key)(?:$|_)/i;
const PROVENANCE_FIELDS = [
  "enabled",
  "transport",
  "command",
  "args",
  "cwd",
  "env",
  "url",
  "headers",
  "startupTimeoutMs",
  "requestTimeoutMs",
  "maxCapabilities",
  "reconnect",
  "admission",
  "capabilityBindings",
  "trust",
] as const;
const CAPABILITY_KINDS = ["portable-tool", "hosted-tool", "harness-native-tool", "agent-backed"] as const;
const CAPABILITY_OWNER_KINDS = ["kiln", "provider", "harness", "service", "agent"] as const;
const CAPABILITY_IMPLEMENTATION_KINDS = ["runtime-tool", "provider-tool", "harness-tool", "agent"] as const;
const CAPABILITY_PERMISSIONS = [
  "workspace-read",
  "workspace-write",
  "machine-execution",
  "network-access",
  "external-state",
  "credential-use",
] as const;
const CAPABILITY_APPROVALS = ["none", "conditional", "required"] as const;
const CAPABILITY_NETWORK_POSTURES = ["none", "restricted", "open"] as const;
const CAPABILITY_DATA_CLASSIFICATIONS = ["public", "internal", "sensitive"] as const;
const CAPABILITY_RETENTIONS = ["none", "ephemeral", "persistent"] as const;
const CAPABILITY_BINDING_KEYS = [
  "capabilityId",
  "kind",
  "ownerKind",
  "implementationKind",
  "contractRevision",
  "permissions",
  "approval",
  "network",
  "data",
  "supportedCallers",
  "limits",
  "requiresStructuredOutput",
] as const;
const CAPABILITY_EFFECT_KEYS = [
  "operation",
  "boundaries",
  "reversibility",
  "dataEgress",
  "identityUse",
  "consequences",
  "idempotency",
] as const;
const CAPABILITY_DATA_KEYS = ["input", "output", "retention"] as const;
const CAPABILITY_LIMIT_KEYS = ["maxInputBytes", "maxOutputBytes", "maxDurationMs", "maxArtifacts"] as const;

export function formatMcpCapabilitySelector(
  serverId: string,
  kind: McpCapabilityKind,
  capabilityName: string,
): string {
  return `mcp:${serverId}:${kind}:${encodeURIComponent(capabilityName)}`;
}

export function validateMcpConfigurationSource(
  source: McpConfigurationSource,
): readonly McpConfigurationDiagnostic[] {
  const diagnostics: McpConfigurationDiagnostic[] = [];
  for (const [serverId, server] of Object.entries(source.servers)) {
    validateServerId(source, serverId, diagnostics);
    validateServerDefinition(source, serverId, server, diagnostics, source.scope === "global");
  }
  return diagnostics;
}

export function resolveMcpConfiguration(
  input: ResolveMcpConfigurationInput,
): McpConfigurationResolution {
  assertScope(input.global, "global");
  assertScope(input.project, "project");

  const diagnostics = [
    ...(input.global ? validateMcpConfigurationSource(input.global) : []),
    ...(input.project ? validateMcpConfigurationSource(input.project) : []),
  ];
  const servers: Record<string, ResolvedMcpServer> = {};
  const serverIds = new Set([
    ...Object.keys(input.global?.servers ?? {}),
    ...Object.keys(input.project?.servers ?? {}),
  ]);

  for (const serverId of [...serverIds].sort()) {
    if (diagnostics.some((diagnostic) => diagnostic.serverId === serverId)) continue;

    const globalServer = input.global?.servers[serverId];
    const projectServer = input.project?.servers[serverId];
    const merged = mergeServer(serverId, input.global, globalServer, input.project, projectServer);
    diagnostics.push(...merged.diagnostics);
    if (!merged.server || merged.diagnostics.length > 0) continue;

    const effectiveValidation: McpConfigurationDiagnostic[] = [];
    validateServerDefinition(
      merged.validationSource,
      serverId,
      merged.server,
      effectiveValidation,
      merged.server.enabled !== false,
      { allowInheritedGlobalCapabilityBindings: globalServer !== undefined && projectServer !== undefined },
    );
    diagnostics.push(...effectiveValidation);
    if (effectiveValidation.length > 0) continue;

    const referenceDiagnostics = validateReferences(
      merged.validationSource,
      serverId,
      merged.server,
      input.environment ?? process.env,
      input.credentialExists,
    );
    diagnostics.push(...referenceDiagnostics);
    if (referenceDiagnostics.length > 0) continue;

    const expanded = expandStdioEnvironmentReferences(
      merged.validationSource,
      serverId,
      merged.server,
      input.environment ?? process.env,
    );
    diagnostics.push(...expanded.diagnostics);
    if (expanded.diagnostics.length > 0) continue;

    const transport = expanded.server.transport;
    if (!transport) continue;
    const enabled = expanded.server.enabled !== false;
    servers[serverId] = {
      ...expanded.server,
      id: serverId,
      enabled,
      transport,
      source: merged.source,
      provenance: merged.provenance,
      connection: { state: enabled ? "not-tested" : "disabled" },
      projection: { state: "not-synchronized" },
    };
  }

  return { servers, diagnostics };
}

function mergeServer(
  serverId: string,
  globalSource: McpConfigurationSource | undefined,
  globalServer: McpServerConfiguration | undefined,
  projectSource: McpConfigurationSource | undefined,
  projectServer: McpServerConfiguration | undefined,
): {
  readonly server?: McpServerConfiguration;
  readonly source: ResolvedMcpServer["source"];
  readonly provenance: Readonly<Record<string, McpFieldProvenance>>;
  readonly diagnostics: readonly McpConfigurationDiagnostic[];
  readonly validationSource: McpConfigurationSource;
} {
  if (!globalServer && projectServer && projectSource) {
    return {
      server: projectServer,
      source: "project",
      provenance: buildProvenance(undefined, undefined, projectSource, projectServer),
      diagnostics: [],
      validationSource: projectSource,
    };
  }
  if (globalServer && globalSource && !projectServer) {
    return {
      server: globalServer,
      source: "global",
      provenance: buildProvenance(globalSource, globalServer, undefined, undefined),
      diagnostics: [],
      validationSource: globalSource,
    };
  }
  if (!globalServer || !globalSource || !projectServer || !projectSource) {
    const fallback = projectSource ?? globalSource ?? {
      scope: "project" as const,
      sourcePath: "<unknown>",
      servers: {},
    };
    return { source: "project", provenance: {}, diagnostics: [], validationSource: fallback };
  }

  const widening = validateProjectNarrowing(globalServer, projectServer);
  if (widening) {
    return {
      source: "overridden",
      provenance: {},
      diagnostics: [diagnostic(projectSource, serverId, "MCP_PROJECT_POLICY_WIDENING", widening, "capabilityBindings")],
      validationSource: projectSource,
    };
  }

  if (projectServer.enabled === false) {
    return {
      server: { ...globalServer, enabled: false },
      source: "disabled-by-project",
      provenance: buildProvenance(globalSource, globalServer, projectSource, projectServer),
      diagnostics: [],
      validationSource: projectSource,
    };
  }

  if (
    projectServer.transport !== undefined
    && globalServer.transport !== undefined
    && projectServer.transport !== globalServer.transport
  ) {
    const requiredField = projectServer.transport === "stdio" ? "command" : "url";
    if (projectServer[requiredField] === undefined) {
      return {
        source: "overridden",
        provenance: {},
        diagnostics: [diagnostic(
          projectSource,
          serverId,
          "MCP_INCOMPLETE_TRANSPORT_REPLACEMENT",
          `Changing MCP transport requires a complete ${projectServer.transport} definition.`,
          requiredField,
        )],
        validationSource: projectSource,
      };
    }
    const retainedCommon = commonServerFields(globalServer);
    const server = { ...retainedCommon, ...projectServer };
    return {
      server,
      source: "overridden",
      provenance: buildProvenance(globalSource, retainedCommon, projectSource, projectServer),
      diagnostics: [],
      validationSource: projectSource,
    };
  }

  return {
    server: { ...globalServer, ...projectServer },
    source: "overridden",
    provenance: buildProvenance(globalSource, globalServer, projectSource, projectServer),
    diagnostics: [],
    validationSource: projectSource,
  };
}

function commonServerFields(server: McpServerConfiguration): McpServerConfiguration {
  return {
    ...(server.enabled !== undefined ? { enabled: server.enabled } : {}),
    ...(server.startupTimeoutMs !== undefined ? { startupTimeoutMs: server.startupTimeoutMs } : {}),
    ...(server.requestTimeoutMs !== undefined ? { requestTimeoutMs: server.requestTimeoutMs } : {}),
    ...(server.maxCapabilities !== undefined ? { maxCapabilities: server.maxCapabilities } : {}),
    ...(server.reconnect !== undefined ? { reconnect: server.reconnect } : {}),
    ...(server.admission !== undefined ? { admission: server.admission } : {}),
    ...(server.capabilityBindings !== undefined ? { capabilityBindings: server.capabilityBindings } : {}),
    ...(server.trust !== undefined ? { trust: server.trust } : {}),
  };
}

function validateProjectNarrowing(
  baseServer: McpServerConfiguration,
  overrideServer: McpServerConfiguration,
): string | undefined {
  if (overrideServer.capabilityBindings !== undefined) {
    return "Project MCP capability bindings are global-owned and cannot be added or replaced.";
  }
  if (
    baseServer.maxCapabilities !== undefined
    && overrideServer.maxCapabilities !== undefined
    && overrideServer.maxCapabilities > baseServer.maxCapabilities
  ) {
    return "Project MCP maxCapabilities cannot exceed the global catalog limit.";
  }
  const base = baseServer.admission;
  const override = overrideServer.admission;
  if (!base || !override) return undefined;
  if (base.state === "denied" && override.state === "admitted") {
    return "Project MCP admission cannot enable a globally denied server.";
  }
  for (const kind of ["tools", "resources", "prompts"] as const) {
    const baseAllow = base[kind]?.allow;
    const overrideAllow = override[kind]?.allow;
    if (!baseAllow || !overrideAllow) continue;
    const admitted = new Set(baseAllow);
    if (overrideAllow.some((name) => !admitted.has(name))) {
      return `Project MCP ${kind} allowlist must be equal to or narrower than the global allowlist.`;
    }
  }
  for (const [toolName, effect] of Object.entries(override.effects ?? {})) {
    const baseEffect = base.effects?.[toolName];
    if (baseEffect && JSON.stringify(effect) !== JSON.stringify(baseEffect)) {
      return `Project MCP effect policy for '${toolName}' cannot replace a global effect declaration.`;
    }
  }
  return undefined;
}

export function resolveMcpToolEffect(server: ResolvedMcpServer, toolName: string): ActionEffectEnvelope {
  return server.admission?.effects?.[toolName] ?? CONSERVATIVE_UNKNOWN_ENVELOPE;
}

function validateServerId(
  source: McpConfigurationSource,
  serverId: string,
  diagnostics: McpConfigurationDiagnostic[],
): void {
  if (!SERVER_ID_PATTERN.test(serverId)) {
    diagnostics.push(diagnostic(
      source,
      serverId,
      "MCP_SERVER_ID_INVALID",
      "MCP server ids must be 1-64 alphanumeric, dot, underscore, or hyphen characters and cannot contain spaces.",
    ));
  }
}

function validateServerDefinition(
  source: McpConfigurationSource,
  serverId: string,
  server: McpServerConfiguration,
  diagnostics: McpConfigurationDiagnostic[],
  requireComplete: boolean,
  options: { readonly allowInheritedGlobalCapabilityBindings?: boolean } = {},
): void {
  if (source.scope === "project" && server.capabilityBindings !== undefined && !options.allowInheritedGlobalCapabilityBindings) {
    diagnostics.push(diagnostic(
      source,
      serverId,
      "MCP_PROJECT_POLICY_WIDENING",
      "Project MCP capability bindings are global-owned and cannot be added or replaced.",
      "capabilityBindings",
    ));
  }
  validateCapabilityBindings(source, serverId, server.capabilityBindings, diagnostics);

  if (server.transport !== undefined && server.transport !== "stdio" && server.transport !== "streamable-http") {
    diagnostics.push(diagnostic(source, serverId, "MCP_TRANSPORT_INVALID", "Unsupported MCP transport.", "transport"));
  }
  if (server.enabled === false && server.transport === undefined) return;

  const presentStdio = [...STDIO_FIELDS].filter((field) => server[field as keyof McpServerConfiguration] !== undefined);
  const presentHttp = [...HTTP_FIELDS].filter((field) => server[field as keyof McpServerConfiguration] !== undefined);
  if (presentStdio.length > 0 && presentHttp.length > 0) {
    diagnostics.push(diagnostic(
      source,
      serverId,
      "MCP_TRANSPORT_FIELDS_MIXED",
      "MCP stdio and Streamable HTTP fields cannot be mixed.",
    ));
  }
  if (server.transport === "stdio" && presentHttp.length > 0) {
    diagnostics.push(diagnostic(source, serverId, "MCP_TRANSPORT_FIELDS_MIXED", "Stdio MCP servers cannot declare HTTP fields."));
  }
  if (server.transport === "streamable-http" && presentStdio.length > 0) {
    diagnostics.push(diagnostic(source, serverId, "MCP_TRANSPORT_FIELDS_MIXED", "Streamable HTTP MCP servers cannot declare stdio fields."));
  }

  if (requireComplete) {
    if (!server.transport) {
      diagnostics.push(diagnostic(source, serverId, "MCP_SERVER_DEFINITION_INCOMPLETE", "Enabled MCP servers require a transport.", "transport"));
    } else if (server.transport === "stdio" && !nonEmpty(server.command)) {
      diagnostics.push(diagnostic(source, serverId, "MCP_SERVER_DEFINITION_INCOMPLETE", "Stdio MCP servers require a command.", "command"));
    } else if (server.transport === "streamable-http" && !nonEmpty(server.url)) {
      diagnostics.push(diagnostic(source, serverId, "MCP_SERVER_DEFINITION_INCOMPLETE", "Streamable HTTP MCP servers require a URL.", "url"));
    }
  }

  if (server.transport === "streamable-http" && server.url !== undefined) {
    try {
      const url = new URL(server.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      diagnostics.push(diagnostic(source, serverId, "MCP_URL_INVALID", "MCP URL must be an absolute HTTP or HTTPS URL.", "url"));
    }
  }

  for (const field of ["startupTimeoutMs", "requestTimeoutMs"] as const) {
    const value = server[field];
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      diagnostics.push(diagnostic(source, serverId, "MCP_TIMEOUT_INVALID", `${field} must be a positive integer.`, field));
    }
  }
  if (server.maxCapabilities !== undefined && (!Number.isInteger(server.maxCapabilities) || server.maxCapabilities <= 0)) {
    diagnostics.push(diagnostic(source, serverId, "MCP_CATALOG_LIMIT_INVALID", "maxCapabilities must be a positive integer.", "maxCapabilities"));
  }
  if (server.reconnect) {
    const { maxAttempts, initialDelayMs, maxDelayMs } = server.reconnect;
    if (
      !Number.isInteger(maxAttempts) || maxAttempts < 0
      || (initialDelayMs !== undefined && (!Number.isInteger(initialDelayMs) || initialDelayMs <= 0))
      || (maxDelayMs !== undefined && (!Number.isInteger(maxDelayMs) || maxDelayMs <= 0))
      || (initialDelayMs !== undefined && maxDelayMs !== undefined && initialDelayMs > maxDelayMs)
    ) {
      diagnostics.push(diagnostic(source, serverId, "MCP_RECONNECT_INVALID", "MCP reconnect policy is invalid.", "reconnect"));
    } else if (server.transport === "stdio") {
      diagnostics.push(diagnostic(source, serverId, "MCP_RECONNECT_INVALID", "MCP reconnect policy is supported only for Streamable HTTP; stdio processes are session-owned.", "reconnect"));
    }
  }

  for (const [toolName, effect] of Object.entries(server.admission?.effects ?? {})) {
    if (!nonEmpty(toolName) || !isCompleteCapabilityEffect(effect)) {
      diagnostics.push(diagnostic(
        source,
        serverId,
        "MCP_EFFECT_POLICY_INVALID",
        "MCP tool effect policies require a non-empty tool name and a complete valid effect envelope.",
        `admission.effects.${toolName}`,
      ));
    }
  }

  validateValueMap(source, serverId, "env", server.env, diagnostics, true);
  validateValueMap(source, serverId, "headers", server.headers, diagnostics, true);
}

function validateCapabilityBindings(
  source: McpConfigurationSource,
  serverId: string,
  values: Readonly<Record<string, McpToolCapabilityBindingConfiguration>> | undefined,
  diagnostics: McpConfigurationDiagnostic[],
): void {
  if (values === undefined) return;
  if (!isRecord(values)) {
    diagnostics.push(diagnostic(
      source,
      serverId,
      "MCP_CAPABILITY_BINDING_INVALID",
      "MCP capability bindings must be a plain object keyed by tool name.",
      "capabilityBindings",
    ));
    return;
  }

  const entries = Object.entries(values);
  if (entries.length > MAX_CAPABILITY_BINDINGS) {
    diagnostics.push(diagnostic(
      source,
      serverId,
      "MCP_CAPABILITY_BINDING_INVALID",
      `MCP capability bindings cannot contain more than ${MAX_CAPABILITY_BINDINGS} tools.`,
      "capabilityBindings",
    ));
  }

  for (const [toolName, binding] of entries) {
    const field = `capabilityBindings.${toolName}`;
    if (!nonEmpty(toolName) || toolName.length > TOOL_NAME_MAX_LENGTH) {
      diagnostics.push(diagnostic(
        source,
        serverId,
        "MCP_CAPABILITY_BINDING_INVALID",
        `MCP capability binding tool names must be non-empty and at most ${TOOL_NAME_MAX_LENGTH} characters.`,
        field,
      ));
    }
    if (!isCompleteCapabilityBinding(binding)) {
      diagnostics.push(diagnostic(
        source,
        serverId,
        "MCP_CAPABILITY_BINDING_INVALID",
        "MCP capability bindings require a complete valid posture declaration.",
        field,
      ));
    }
  }
}

function isCompleteCapabilityBinding(value: unknown): value is McpToolCapabilityBindingConfiguration {
  if (!isRecord(value) || !hasExactKeys(value, CAPABILITY_BINDING_KEYS, ["capabilityId", "kind", "ownerKind", "implementationKind", "permissions", "approval", "network", "data", "supportedCallers", "limits"])) {
    return false;
  }
  if (
    typeof value.capabilityId !== "string"
    || value.capabilityId.length > CONTRACT_REVISION_MAX_LENGTH
    || !CAPABILITY_ID_PATTERN.test(value.capabilityId)
    || !isMember(value.kind, CAPABILITY_KINDS)
    || !isMember(value.ownerKind, CAPABILITY_OWNER_KINDS)
    || !isMember(value.implementationKind, CAPABILITY_IMPLEMENTATION_KINDS)
    || ("contractRevision" in value && (typeof value.contractRevision !== "string" || !nonEmpty(value.contractRevision) || value.contractRevision.length > CONTRACT_REVISION_MAX_LENGTH))
    || !isUniqueMembers(value.permissions, CAPABILITY_PERMISSIONS, CAPABILITY_PERMISSIONS.length)
    || !isMember(value.approval, CAPABILITY_APPROVALS)
    || !isMember(value.network, CAPABILITY_NETWORK_POSTURES)
    || !isCompleteCapabilityData(value.data)
    || !isExactMcpSupportedCallers(value.supportedCallers)
    || !isCompleteCapabilityLimits(value.limits)
    || ("requiresStructuredOutput" in value && typeof value.requiresStructuredOutput !== "boolean")
  ) {
    return false;
  }
  return true;
}

function isExactMcpSupportedCallers(value: unknown): value is readonly ["kiln-runtime"] {
  return Array.isArray(value) && value.length === 1 && value[0] === "kiln-runtime";
}

function isCompleteCapabilityEffect(value: unknown): value is ActionEffectEnvelope {
  return isRecord(value)
    && hasExactKeys(value, CAPABILITY_EFFECT_KEYS)
    && normalizeActionEffectEnvelope(value) !== undefined;
}

function isCompleteCapabilityData(value: unknown): value is McpToolCapabilityBindingConfiguration["data"] {
  return isRecord(value)
    && hasExactKeys(value, CAPABILITY_DATA_KEYS)
    && isMember(value.input, CAPABILITY_DATA_CLASSIFICATIONS)
    && isMember(value.output, CAPABILITY_DATA_CLASSIFICATIONS)
    && isMember(value.retention, CAPABILITY_RETENTIONS);
}

function isCompleteCapabilityLimits(value: unknown): value is McpToolCapabilityBindingConfiguration["limits"] {
  return isRecord(value)
    && hasExactKeys(value, CAPABILITY_LIMIT_KEYS)
    && isBoundedInteger(value.maxInputBytes, 1, 16 * 1024 * 1024)
    && isBoundedInteger(value.maxOutputBytes, 1, 64 * 1024 * 1024)
    && isBoundedInteger(value.maxDurationMs, 1, 24 * 60 * 60 * 1000)
    && isBoundedInteger(value.maxArtifacts, 0, 256);
}

function isUniqueMembers<const T extends readonly string[]>(
  value: unknown,
  members: T,
  maximum: number,
  requireNonEmpty = false,
): value is readonly T[number][] {
  if (!Array.isArray(value) || value.length > maximum || (requireNonEmpty && value.length === 0)) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isMember(entry, members) || seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

function isMember<const T extends readonly string[]>(value: unknown, members: T): value is T[number] {
  return typeof value === "string" && members.includes(value);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function validateValueMap(
  source: McpConfigurationSource,
  serverId: string,
  field: "env" | "headers",
  values: Readonly<Record<string, McpValueReference>> | undefined,
  diagnostics: McpConfigurationDiagnostic[],
  rejectSensitiveLiterals: boolean,
): void {
  for (const [name, reference] of Object.entries(values ?? {})) {
    const referenceRecord = isRecord(reference) ? reference : undefined;
    const keys = referenceRecord ? Reflect.ownKeys(referenceRecord) : [];
    if (keys.length !== 1 || typeof keys[0] !== "string"
      || !["value", "fromEnv", "fromCredential"].includes(keys[0])) {
      diagnostics.push(diagnostic(source, serverId, "MCP_VALUE_REFERENCE_INVALID", `${field}.${name} must declare exactly one value source.`, `${field}.${name}`));
      continue;
    }
    const referenceKey = keys[0];
    const descriptor = Object.getOwnPropertyDescriptor(referenceRecord, referenceKey);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      diagnostics.push(diagnostic(source, serverId, "MCP_VALUE_REFERENCE_INVALID", `${field}.${name} must contain an inert data value.`, `${field}.${name}`));
      continue;
    }
    const referenceValue = descriptor.value;
    if (referenceKey === "value" && typeof referenceValue !== "string") {
      diagnostics.push(diagnostic(source, serverId, "MCP_VALUE_REFERENCE_INVALID", `${field}.${name}.value must be a string.`, `${field}.${name}`));
    }
    if (referenceKey === "fromEnv" && (typeof referenceValue !== "string" || !ENVIRONMENT_NAME_PATTERN.test(referenceValue))) {
      diagnostics.push(diagnostic(source, serverId, "MCP_VALUE_REFERENCE_INVALID", `${field}.${name}.fromEnv is invalid.`, `${field}.${name}`));
    }
    if (referenceKey === "fromCredential" && (typeof referenceValue !== "string" || !CREDENTIAL_ID_PATTERN.test(referenceValue))) {
      diagnostics.push(diagnostic(source, serverId, "MCP_VALUE_REFERENCE_INVALID", `${field}.${name}.fromCredential is invalid.`, `${field}.${name}`));
    }
    const sensitiveLiteral = field === "headers"
      ? SENSITIVE_HEADER_PATTERN.test(name)
      : SENSITIVE_ENVIRONMENT_PATTERN.test(name);
    if (rejectSensitiveLiterals && sensitiveLiteral && referenceKey === "value") {
      diagnostics.push(diagnostic(source, serverId, "MCP_LITERAL_SECRET_FORBIDDEN", `Sensitive ${field} value ${name} must use an environment or credential reference.`, `${field}.${name}`));
    }
  }
}

function validateReferences(
  source: McpConfigurationSource,
  serverId: string,
  server: McpServerConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
  credentialExists: ((credentialId: string) => boolean) | undefined,
): readonly McpConfigurationDiagnostic[] {
  const diagnostics: McpConfigurationDiagnostic[] = [];
  for (const [field, values] of [["env", server.env], ["headers", server.headers]] as const) {
    for (const [name, reference] of Object.entries(values ?? {})) {
      if ("fromEnv" in reference && !nonEmpty(environment[reference.fromEnv])) {
        diagnostics.push({
          ...diagnostic(source, serverId, "MCP_SECRET_REFERENCE_MISSING", `Required ${field} environment reference is unavailable.`, `${field}.${name}`),
          reference: `env:${reference.fromEnv}`,
        });
      }
      if ("fromCredential" in reference && (!credentialExists || !credentialExists(reference.fromCredential))) {
        diagnostics.push({
          ...diagnostic(source, serverId, "MCP_SECRET_REFERENCE_MISSING", `Required ${field} credential reference is unavailable.`, `${field}.${name}`),
          reference: `credential:${reference.fromCredential}`,
        });
      }
    }
  }
  return diagnostics;
}

function expandStdioEnvironmentReferences(
  source: McpConfigurationSource,
  serverId: string,
  server: McpServerConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
): { readonly server: McpServerConfiguration; readonly diagnostics: readonly McpConfigurationDiagnostic[] } {
  if (server.transport !== "stdio") return { server, diagnostics: [] };
  const diagnostics: McpConfigurationDiagnostic[] = [];
  const expand = (value: string, field: string): string => value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name: string) => {
    const resolved = environment[name];
    if (resolved === undefined) {
      diagnostics.push({
        ...diagnostic(source, serverId, "MCP_ENVIRONMENT_REFERENCE_MISSING", `Required stdio path environment reference is unavailable.`, field),
        reference: `env:${name}`,
      });
      return match;
    }
    return resolved;
  });
  return {
    server: {
      ...server,
      ...(server.command ? { command: expand(server.command, "command") } : {}),
      ...(server.args ? { args: server.args.map((arg, index) => expand(arg, `args[${index}]`)) } : {}),
      ...(server.cwd ? { cwd: expand(server.cwd, "cwd") } : {}),
    },
    diagnostics,
  };
}

function buildProvenance(
  globalSource: McpConfigurationSource | undefined,
  globalServer: McpServerConfiguration | undefined,
  projectSource: McpConfigurationSource | undefined,
  projectServer: McpServerConfiguration | undefined,
): Readonly<Record<string, McpFieldProvenance>> {
  const provenance: Record<string, McpFieldProvenance> = {};
  for (const field of PROVENANCE_FIELDS) {
    if (globalSource && globalServer?.[field] !== undefined) {
      provenance[field] = { scope: "global", sourcePath: globalSource.sourcePath, field };
    }
    if (projectSource && projectServer?.[field] !== undefined) {
      provenance[field] = { scope: "project", sourcePath: projectSource.sourcePath, field };
    }
  }
  return provenance;
}

function diagnostic(
  source: McpConfigurationSource,
  serverId: string,
  code: McpConfigurationDiagnosticCode,
  message: string,
  field?: string,
): McpConfigurationDiagnostic {
  return {
    code,
    message,
    serverId,
    scope: source.scope,
    sourcePath: source.sourcePath,
    ...(field ? { field } : {}),
  };
}

function assertScope(source: McpConfigurationSource | undefined, expected: McpConfigurationScope): void {
  if (source && source.scope !== expected) {
    throw new Error(`Expected ${expected} MCP configuration source, received ${source.scope}.`);
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string" && allowed.includes(key))
    && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export * from "./client/index.js";
