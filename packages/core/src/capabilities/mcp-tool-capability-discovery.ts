import { Ajv2020 } from "ajv/dist/2020.js";
import type { ActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { normalizeActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import {
  buildCapabilityCatalog,
  type CapabilityApprovalPosture,
  type CapabilityCatalogSnapshot,
  type CapabilityCallerId,
  type CapabilityDataPosture,
  type CapabilityDescriptorCandidate,
  type CapabilityImplementationKind,
  type CapabilityKind,
  type CapabilityLimits,
  type CapabilityNetworkPosture,
  type CapabilityOwnerKind,
  type CapabilityPermission,
  type CapabilityProvenanceSource,
  type Sha256Digest,
} from "./capability-catalog.js";

/** The only MCP wire revision admitted by this adapter. */
export const MCP_TOOL_PROTOCOL_REVISION = "2026-07-28" as const;

/** Adapter contract revision. It participates in every candidate identity. */
export const MCP_TOOL_CAPABILITY_DISCOVERY_REVISION = "mcp-tool-capability-discovery/v1" as const;

/** The digest used when a tool has no output schema declaration. */
export const MCP_OUTPUT_SCHEMA_ABSENT_DIGEST = sha256(
  `${MCP_TOOL_CAPABILITY_DISCOVERY_REVISION}/output-schema/absent`,
);

const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9][a-z0-9_-]{0,62})+$/u;
const SERVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/u;
const SELECTOR_PATTERN = /^mcp:[^:]+:tool:.+$/u;
const TOOL_NAME_MAX_LENGTH = 127;
const DESCRIPTION_MAX_LENGTH = 16_384;
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_SCHEMA_NODES = 2_048;
const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_STRING_UNITS = 65_536;
const MAX_SNAPSHOT_TOOLS = 10_000;
const MAX_BINDINGS = 10_000;
const MAX_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1_000;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PERMISSIONS = [
  "workspace-read",
  "workspace-write",
  "machine-execution",
  "network-access",
  "external-state",
  "credential-use",
] as const satisfies readonly CapabilityPermission[];
const CALLERS = [
  "kiln-runtime",
  "kiln-cli",
  "kiln-gui",
  "kiln-tui",
  "kiln-sdk",
  "kiln-widget",
  "codex",
  "claude",
  "opencode-v2",
] as const satisfies readonly CapabilityCallerId[];
const APPROVALS = ["none", "conditional", "required"] as const satisfies readonly CapabilityApprovalPosture[];
const NETWORK_POSTURES = ["none", "restricted", "open"] as const satisfies readonly CapabilityNetworkPosture[];
const DATA_CLASSIFICATIONS = ["public", "internal", "sensitive"] as const;
const RETENTIONS = ["none", "ephemeral", "persistent"] as const;
type AdapterCapabilityKind = CapabilityKind;
const JSON_SCHEMA_VALIDATOR = new Ajv2020({
  allErrors: false,
  strict: false,
  validateFormats: false,
});
const BINDING_KEYS = [
  "serverId",
  "selector",
  "capabilityId",
  "bindingDigest",
  "kind",
  "ownerKind",
  "implementationKind",
  "ownerIdentityDigest",
  "sourceIdentityDigest",
  "implementationIdentityDigest",
  "contractRevision",
  "effect",
  "permissions",
  "approval",
  "network",
  "data",
  "supportedCallers",
  "limits",
  "requiresStructuredOutput",
] as const;

/**
 * A tool declaration as settled by the MCP v2 client. `annotations` are kept
 * only as untrusted evidence and are never used to construct the effect.
 */
export interface McpToolCapabilityDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly annotations?: Readonly<Record<string, unknown>>;
}

/** One selected tool in a settled, complete MCP discovery snapshot. */
export interface McpToolCapabilitySnapshotEntry {
  readonly selector: string;
  readonly descriptor: McpToolCapabilityDeclaration;
  readonly annotations?: Readonly<Record<string, unknown>>;
}

/**
 * The adapter consumes this inert snapshot, never a transport or SDK client.
 * Resources, prompts, and serverInfo may exist on the upstream snapshot but
 * are intentionally not represented here and therefore cannot become tools.
 */
export interface McpToolCapabilityDiscoverySnapshot {
  readonly serverId: string;
  readonly protocolRevision: string;
  readonly completeness: "complete" | "partial" | "degraded";
  readonly invalidated: boolean;
  readonly freshness: {
    readonly observedAt: string;
    readonly validUntil: string;
    readonly status?: "current" | "stale" | "unknown";
  };
  readonly bindingDigest: Sha256Digest;
  readonly authDigest: Sha256Digest;
  readonly tools: readonly McpToolCapabilitySnapshotEntry[];
}

/**
 * Explicit local policy/effect binding for one MCP tool. No transport,
 * command, endpoint, credential, callback, or server self-description is
 * accepted at this boundary.
 */
export interface McpToolCapabilityBinding {
  readonly serverId: string;
  readonly selector: string;
  readonly capabilityId: string;
  readonly bindingDigest?: Sha256Digest;
  readonly kind: AdapterCapabilityKind;
  readonly ownerKind: CapabilityOwnerKind;
  readonly implementationKind: CapabilityImplementationKind;
  readonly ownerIdentityDigest?: Sha256Digest;
  readonly sourceIdentityDigest?: Sha256Digest;
  readonly implementationIdentityDigest?: Sha256Digest;
  readonly contractRevision?: string;
  readonly effect: ActionEffectEnvelope;
  readonly permissions: readonly CapabilityPermission[];
  readonly approval: CapabilityApprovalPosture;
  readonly network: CapabilityNetworkPosture;
  readonly data: CapabilityDataPosture;
  readonly supportedCallers: readonly CapabilityCallerId[];
  readonly limits: CapabilityLimits;
  readonly requiresStructuredOutput?: boolean;
}

export interface McpToolCapabilityDiscoveryInput {
  readonly evaluatedAt: string;
  readonly snapshot: McpToolCapabilityDiscoverySnapshot;
  readonly bindings: readonly McpToolCapabilityBinding[];
}

export type McpToolCapabilityDiscoveryDiagnosticCode =
  | "snapshot_malformed"
  | "protocol_revision_mismatch"
  | "snapshot_incomplete"
  | "snapshot_invalidated"
  | "snapshot_freshness_invalid"
  | "snapshot_stale"
  | "snapshot_binding_digest_invalid"
  | "snapshot_auth_digest_invalid"
  | "tool_malformed"
  | "binding_malformed"
  | "binding_missing"
  | "binding_server_mismatch"
  | "binding_duplicate"
  | "binding_identity_invalid"
  | "effect_invalid"
  | "input_schema_invalid"
  | "output_schema_invalid"
  | "output_schema_missing"
  | "secret_bearing_declaration"
  | "prompt_injection_declaration"
  | "annotation_ignored"
  | "annotation_contradiction";

export interface McpToolCapabilityDiscoveryDiagnostic {
  readonly code: McpToolCapabilityDiscoveryDiagnosticCode;
  readonly selector?: string;
  readonly capabilityId?: string;
  readonly message: string;
  readonly severity: "warning" | "error";
}

export interface McpToolCapabilityDiscoveryResult {
  readonly evaluatedAt: string;
  readonly protocolRevision: typeof MCP_TOOL_PROTOCOL_REVISION;
  readonly candidates: readonly CapabilityDescriptorCandidate[];
  readonly diagnostics: readonly McpToolCapabilityDiscoveryDiagnostic[];
  readonly catalog: CapabilityCatalogSnapshot;
}

interface ParsedSnapshot {
  readonly serverId: string;
  readonly protocolRevision: string;
  readonly bindingDigest?: Sha256Digest;
  readonly authDigest?: Sha256Digest;
  readonly freshness?: {
    readonly observedAt: string;
    readonly validUntil: string;
    readonly status?: "current" | "stale" | "unknown";
  };
  readonly tools: readonly ParsedTool[];
  readonly globalIssues: readonly GlobalIssue[];
}

interface ParsedTool {
  readonly selector: string;
  readonly declaration: McpToolCapabilityDeclaration;
  readonly declarationDigest: Sha256Digest;
}

interface ParsedBinding {
  readonly selector: string;
  readonly capabilityId: string;
  readonly kind: AdapterCapabilityKind;
  readonly ownerKind: CapabilityOwnerKind;
  readonly implementationKind: CapabilityImplementationKind;
  readonly effect: ActionEffectEnvelope;
  readonly permissions: readonly CapabilityPermission[];
  readonly approval: CapabilityApprovalPosture;
  readonly network: CapabilityNetworkPosture;
  readonly data: CapabilityDataPosture;
  readonly supportedCallers: readonly CapabilityCallerId[];
  readonly limits: CapabilityLimits;
  readonly ownerIdentityDigest: Sha256Digest;
  readonly sourceIdentityDigest: Sha256Digest;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly contractRevision: string;
  readonly requiresStructuredOutput: boolean;
  readonly bindingDigest: Sha256Digest;
}

interface GlobalIssue {
  readonly code: McpToolCapabilityDiscoveryDiagnosticCode;
  readonly message: string;
  readonly severity: "warning" | "error";
  readonly unavailable: boolean;
}

interface SchemaValidation {
  readonly ok: boolean;
  readonly value?: Readonly<Record<string, unknown>>;
  readonly reason?: "malformed" | "external-ref" | "limits" | "secret" | "prompt-injection";
}

/**
 * Discover MCP tool candidates from already-settled data. This function is
 * deliberately synchronous and accepts no execution or configuration hook.
 */
export function discoverMcpToolCapabilities(
  input: McpToolCapabilityDiscoveryInput,
): McpToolCapabilityDiscoveryResult {
  const parsedInput = parseInput(input);
  const diagnostics: McpToolCapabilityDiscoveryDiagnostic[] = [];
  const parsedSnapshot = parseSnapshot(parsedInput.snapshot, diagnostics, parsedInput.evaluatedAt);
  const parsedBindings = parseBindings(parsedInput.bindings, diagnostics, parsedSnapshot.serverId);
  const bindingsBySelector = groupBindings(parsedBindings, diagnostics);
  const candidates: CapabilityDescriptorCandidate[] = [];

  const globalUnavailable = parsedSnapshot.globalIssues.some((issue) => issue.unavailable)
    || parsedSnapshot.protocolRevision !== MCP_TOOL_PROTOCOL_REVISION;

  for (const tool of parsedSnapshot.tools) {
    const bindingEntries = bindingsBySelector.get(tool.selector) ?? [];
    if (bindingEntries.length === 0) {
      diagnostics.push(diagnostic("binding_missing", tool.selector, undefined, "No explicit local binding exists for this selected MCP tool."));
      continue;
    }
    if (bindingEntries.length > 1) {
      // The group diagnostic is emitted in groupBindings; do not choose one
      // binding optimistically.
      continue;
    }

    const binding = bindingEntries[0]!;
    const declarationChecks = inspectDeclaration(tool, binding, diagnostics);
    const unavailable = globalUnavailable || declarationChecks.unavailable;
    candidates.push(deepFreeze(buildCandidate(
      parsedSnapshot,
      tool,
      binding,
      unavailable,
      declarationChecks.outputSchemaDigest,
    )));
  }

  candidates.sort(compareCandidates);
  const frozenCandidates = Object.freeze(candidates);
  const catalog = buildCapabilityCatalog(frozenCandidates, parsedInput.evaluatedAt);
  const sortedDiagnostics = diagnostics
    .map((entry) => deepFreeze(entry))
    .sort(compareDiagnostics);

  return Object.freeze({
    evaluatedAt: parsedInput.evaluatedAt,
    protocolRevision: MCP_TOOL_PROTOCOL_REVISION,
    candidates: frozenCandidates,
    diagnostics: Object.freeze(sortedDiagnostics),
    catalog,
  });
}

/** Returns only the inert candidate values. */
export function discoverMcpToolCapabilityCandidates(
  input: McpToolCapabilityDiscoveryInput,
): readonly CapabilityDescriptorCandidate[] {
  return discoverMcpToolCapabilities(input).candidates;
}

/** Returns the Core-branded catalog generated by the MCP tool adapter. */
export function discoverMcpToolCapabilityCatalog(
  input: McpToolCapabilityDiscoveryInput,
): CapabilityCatalogSnapshot {
  return discoverMcpToolCapabilities(input).catalog;
}

function parseInput(input: McpToolCapabilityDiscoveryInput): {
  readonly evaluatedAt: string;
  readonly snapshot: unknown;
  readonly bindings: unknown;
} {
  const record = requirePlainRecord(input, "MCP tool discovery input");
  requireExactKeys(record, ["evaluatedAt", "snapshot", "bindings"], "MCP tool discovery input");
  if (!isCanonicalTimestamp(record.evaluatedAt)) {
    throw new TypeError("MCP tool discovery evaluatedAt must be a canonical ISO timestamp.");
  }
  const bindings = cloneInert(record.bindings, "MCP tool discovery bindings", {
    maxNodes: MAX_BINDINGS * 32,
    maxDepth: MAX_SCHEMA_DEPTH,
    maxStringUnits: MAX_SCHEMA_STRING_UNITS * 2,
  });
  if (!Array.isArray(bindings)) throw new TypeError("MCP tool discovery bindings must be an array.");
  if (bindings.length > MAX_BINDINGS) throw new TypeError("MCP tool discovery bindings exceed the bounded maximum.");
  return { evaluatedAt: record.evaluatedAt, snapshot: record.snapshot, bindings };
}

function parseSnapshot(
  value: unknown,
  diagnostics: McpToolCapabilityDiscoveryDiagnostic[],
  evaluatedAt: string,
): ParsedSnapshot {
  const record = cloneSnapshot(value);
  const serverId = typeof record.serverId === "string" && SERVER_ID_PATTERN.test(record.serverId)
    ? record.serverId
    : "invalid-server";
  const protocolRevision = typeof record.protocolRevision === "string" ? record.protocolRevision : "";
  const globalIssues: GlobalIssue[] = [];

  if (protocolRevision !== MCP_TOOL_PROTOCOL_REVISION) {
    const issue = globalIssue("protocol_revision_mismatch", "The snapshot protocol revision is not the exact admitted MCP 2026-07-28 revision.", true);
    globalIssues.push(issue);
    diagnostics.push(diagnostic(issue.code, undefined, undefined, issue.message));
  }
  if (serverId === "invalid-server") {
    const issue = globalIssue("snapshot_malformed", "The snapshot server identity is malformed.", true);
    globalIssues.push(issue);
    diagnostics.push(diagnostic(issue.code, undefined, undefined, issue.message));
  }

  if (record.completeness !== "complete") {
    const issue = globalIssue("snapshot_incomplete", "Only complete MCP tool snapshots can provide discovery evidence.", true);
    globalIssues.push(issue);
    diagnostics.push(diagnostic(issue.code, undefined, undefined, issue.message));
  }
  if (record.invalidated !== false) {
    const issue = globalIssue("snapshot_invalidated", "The MCP snapshot is missing an explicit non-invalidated state.", true);
    globalIssues.push(issue);
    diagnostics.push(diagnostic(issue.code, undefined, undefined, issue.message));
  }

  const bindingDigest = parseDigest(record.bindingDigest);
  if (!bindingDigest) {
    const issue = globalIssue("snapshot_binding_digest_invalid", "The snapshot has no valid secret-free binding digest.", true);
    globalIssues.push(issue);
    diagnostics.push(diagnostic(issue.code, undefined, undefined, issue.message));
  }
  const authDigest = parseDigest(record.authDigest);
  if (!authDigest) {
    const issue = globalIssue("snapshot_auth_digest_invalid", "The snapshot has no valid secret-free auth digest.", true);
    globalIssues.push(issue);
    diagnostics.push(diagnostic(issue.code, undefined, undefined, issue.message));
  }

  const freshness = parseFreshness(record.freshness);
  if (!freshness) {
    const issue = globalIssue("snapshot_freshness_invalid", "The MCP snapshot freshness or TTL evidence is malformed.", true);
    globalIssues.push(issue);
    diagnostics.push(diagnostic(issue.code, undefined, undefined, issue.message));
  } else if (freshness.status === "stale" || freshness.status === "unknown"
    || Date.parse(freshness.validUntil) <= Date.parse(evaluatedAt)
    || Date.parse(freshness.observedAt) > Date.parse(evaluatedAt)) {
    const stale = freshness.status === "stale" || Date.parse(freshness.validUntil) <= Date.parse(evaluatedAt);
    const issue = globalIssue(
      stale ? "snapshot_stale" : "snapshot_freshness_invalid",
      stale ? "The MCP snapshot is stale at the evaluation instant." : "The MCP snapshot freshness state is unknown or contradictory.",
      true,
    );
    globalIssues.push(issue);
    diagnostics.push(diagnostic(issue.code, undefined, undefined, issue.message));
  }

  const tools = parseTools(record.tools, diagnostics, serverId);
  return {
    serverId,
    protocolRevision,
    ...(bindingDigest ? { bindingDigest } : {}),
    ...(authDigest ? { authDigest } : {}),
    ...(freshness ? { freshness } : {}),
    tools,
    globalIssues,
  };
}

/**
 * Copy only the settled snapshot fields owned by this adapter. In particular,
 * serverInfo, resources, and prompts are never read; an accessor or executable
 * value in one of those unrelated projections cannot cross this boundary.
 */
function cloneSnapshot(value: unknown): Record<string, unknown> {
  const source = requirePlainRecord(value, "MCP tool discovery snapshot");
  const result = Object.create(null) as Record<string, unknown>;
  const fields = [
    "serverId",
    "protocolRevision",
    "completeness",
    "invalidated",
    "freshness",
    "bindingDigest",
    "authDigest",
    "tools",
  ] as const;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(source, field);
    if (!descriptor) continue;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      // Treat malformed evidence as absent. The caller will receive a
      // snapshot-level fail-closed diagnostic instead of an SDK-like throw.
      result[field] = undefined;
      continue;
    }
    const budget = field === "tools"
      ? { maxNodes: MAX_SNAPSHOT_TOOLS * 32, maxDepth: MAX_SCHEMA_DEPTH * 2, maxStringUnits: MAX_SCHEMA_STRING_UNITS * 4 }
      : { maxNodes: 8_192, maxDepth: MAX_SCHEMA_DEPTH, maxStringUnits: MAX_SCHEMA_STRING_UNITS * 4 };
    try {
      result[field] = cloneInert(descriptor.value, `MCP snapshot ${field}`, budget);
    } catch {
      result[field] = undefined;
    }
  }
  return result;
}

function parseFreshness(
  value: unknown,
): { readonly observedAt: string; readonly validUntil: string; readonly status?: "current" | "stale" | "unknown" } | undefined {
  const record = asPlainRecord(value);
  if (!record || !isCanonicalTimestamp(record.observedAt) || !isCanonicalTimestamp(record.validUntil)) return undefined;
  const observedAt = Date.parse(record.observedAt);
  const validUntil = Date.parse(record.validUntil);
  if (observedAt >= validUntil || validUntil - observedAt > MAX_FRESHNESS_WINDOW_MS) return undefined;
  if (record.status !== undefined && record.status !== "current" && record.status !== "stale" && record.status !== "unknown") return undefined;
  return {
    observedAt: record.observedAt,
    validUntil: record.validUntil,
    ...(record.status === undefined ? {} : { status: record.status }),
  };
}

function parseTools(
  value: unknown,
  diagnostics: McpToolCapabilityDiscoveryDiagnostic[],
  serverId: string,
): readonly ParsedTool[] {
  let inert: unknown;
  try {
    inert = cloneInert(value, "MCP tool snapshot tools", {
      maxNodes: MAX_SNAPSHOT_TOOLS * 32,
      maxDepth: MAX_SCHEMA_DEPTH * 2,
      maxStringUnits: MAX_SCHEMA_STRING_UNITS * 4,
    });
  } catch {
    diagnostics.push(diagnostic("snapshot_malformed", undefined, undefined, "The MCP snapshot tools collection is malformed or exceeds limits."));
    return [];
  }
  if (!Array.isArray(inert) || inert.length > MAX_SNAPSHOT_TOOLS) {
    diagnostics.push(diagnostic("snapshot_malformed", undefined, undefined, "The MCP snapshot tools collection is malformed or exceeds limits."));
    return [];
  }
  const result: ParsedTool[] = [];
  const selectorCounts = new Map<string, number>();
  for (const entry of inert) {
    const selector = asPlainRecord(entry)?.selector;
    if (typeof selector === "string") selectorCounts.set(selector, (selectorCounts.get(selector) ?? 0) + 1);
  }
  for (const entry of inert) {
    const record = asPlainRecord(entry);
    const descriptor = record ? asPlainRecord(record.descriptor) : undefined;
    const selector = record?.selector;
    if (!record || !descriptor || typeof(selector) !== "string" || !SELECTOR_PATTERN.test(selector)
      || typeof descriptor.name !== "string" || descriptor.name.length === 0 || descriptor.name.length > TOOL_NAME_MAX_LENGTH
      || !isPlainRecord(descriptor.inputSchema)) {
      diagnostics.push(diagnostic("tool_malformed", typeof selector === "string" ? selector : undefined, undefined, "A selected MCP tool declaration is malformed."));
      continue;
    }
    if (!isCanonicalSelector(selector, serverId)) {
      diagnostics.push(diagnostic("tool_malformed", selector, undefined, "A tool selector is not qualified for the settled MCP server."));
      continue;
    }
    if ((selectorCounts.get(selector) ?? 0) > 1) {
      diagnostics.push(diagnostic("tool_malformed", selector, undefined, "The settled MCP snapshot contains duplicate tool selectors."));
      continue;
    }
    const encodedName = selector.slice(`mcp:${serverId}:tool:`.length);
    let selectedName: string;
    try {
      selectedName = decodeURIComponent(encodedName);
    } catch {
      diagnostics.push(diagnostic("tool_malformed", selector, undefined, "A tool selector contains invalid encoding."));
      continue;
    }
    if (selectedName !== descriptor.name) {
      diagnostics.push(diagnostic("tool_malformed", selector, undefined, "The case-sensitive MCP tool name does not match its selector."));
      continue;
    }
    const description = descriptor.description;
    const outputSchema = descriptor.outputSchema;
    const annotations = descriptor.annotations ?? record.annotations;
    if (description !== undefined && (typeof description !== "string" || description.length > DESCRIPTION_MAX_LENGTH)) {
      diagnostics.push(diagnostic("tool_malformed", selector, undefined, "The MCP tool description is malformed or exceeds limits."));
      continue;
    }
    if (outputSchema !== undefined && !isPlainRecord(outputSchema)) {
      diagnostics.push(diagnostic("tool_malformed", selector, undefined, "The MCP tool output schema is not a JSON object."));
      continue;
    }
    const declaration: McpToolCapabilityDeclaration = {
      name: descriptor.name,
      ...(description === undefined ? {} : { description }),
      inputSchema: descriptor.inputSchema,
      ...(outputSchema === undefined ? {} : { outputSchema }),
      ...(annotations === undefined ? {} : { annotations: isPlainRecord(annotations) ? annotations : {} }),
    };
    result.push({
      selector,
      declaration: deepFreeze(declaration),
      declarationDigest: sha256(stableCanonicalStringify({
        selector,
        name: declaration.name,
        ...(declaration.description === undefined ? {} : { description: declaration.description }),
        inputSchema: declaration.inputSchema,
        ...(declaration.outputSchema === undefined
          ? { outputSchema: { present: false } }
          : { outputSchema: declaration.outputSchema }),
        ...(declaration.annotations === undefined ? {} : { annotations: declaration.annotations }),
      })),
    });
  }
  return Object.freeze(result);
}

function parseBindings(
  value: unknown,
  diagnostics: McpToolCapabilityDiscoveryDiagnostic[],
  serverId: string,
): readonly ParsedBinding[] {
  if (!Array.isArray(value)) {
    throw new TypeError("MCP tool discovery bindings must be an array.");
  }
  const result: ParsedBinding[] = [];
  for (const entry of value) {
    const parsed = parseBinding(entry, diagnostics, serverId);
    if (parsed) result.push(parsed);
  }
  return Object.freeze(result);
}

function parseBinding(
  value: unknown,
  diagnostics: McpToolCapabilityDiscoveryDiagnostic[],
  serverId: string,
): ParsedBinding | undefined {
  const record = asPlainRecord(value);
  if (!record) {
    diagnostics.push(diagnostic("binding_malformed", undefined, undefined, "An MCP capability binding is not an inert plain-data object."));
    return undefined;
  }
  const selector = record.selector;
  const capabilityId = record.capabilityId;
  const kind = parseMember(record.kind, ["portable-tool", "hosted-tool", "harness-native-tool", "agent-backed"] as const);
  const ownerKind = parseMember(record.ownerKind, ["kiln", "provider", "harness", "service", "agent"] as const);
  const implementationKind = parseMember(record.implementationKind, ["runtime-tool", "provider-tool", "harness-tool", "agent"] as const);
  if (record.serverId !== serverId || typeof selector !== "string" || !SELECTOR_PATTERN.test(selector) || typeof capabilityId !== "string"
    || !CAPABILITY_ID_PATTERN.test(capabilityId) || !isCanonicalSelector(selector, serverId)
    || !kind || !ownerKind || !implementationKind || !hasAllowedKeys(record, BINDING_KEYS)) {
    diagnostics.push(diagnostic(
      record.serverId !== serverId ? "binding_server_mismatch" : "binding_identity_invalid",
      typeof selector === "string" ? selector : undefined,
      typeof capabilityId === "string" ? capabilityId : undefined,
      record.serverId !== serverId
        ? "An MCP capability binding is scoped to a different settled server."
        : "An MCP capability binding has an invalid selector, capability identity, or posture kind.",
    ));
    return undefined;
  }
  if (containsSecretBearing(record)) {
    diagnostics.push(diagnostic("binding_malformed", selector, capabilityId, "The local MCP capability binding contains secret-bearing data."));
    return undefined;
  }
  const effect = normalizeActionEffectEnvelope(record.effect);
  if (!effect || !hasExactKeys(asPlainRecord(record.effect), ["operation", "boundaries", "reversibility", "dataEgress", "identityUse", "consequences", "idempotency"])) {
    diagnostics.push(diagnostic("effect_invalid", selector, capabilityId, "The local MCP binding does not declare a complete canonical action effect."));
    return undefined;
  }
  const permissions = parseMembers(record.permissions, PERMISSIONS);
  const callers = parseMembers(record.supportedCallers, CALLERS);
  const approval = parseMember(record.approval, APPROVALS);
  const network = parseMember(record.network, NETWORK_POSTURES);
  const data = parseData(record.data);
  const limits = parseLimits(record.limits);
  if (!permissions || !callers || !approval || !network || !data || !limits) {
    diagnostics.push(diagnostic("binding_malformed", selector, capabilityId, "The local MCP capability binding has an incomplete or invalid posture."));
    return undefined;
  }
  const bindingDigest = parseOptionalDigest(record.bindingDigest);
  const ownerIdentityDigest = parseOptionalDigest(record.ownerIdentityDigest);
  const sourceIdentityDigest = parseOptionalDigest(record.sourceIdentityDigest);
  const implementationIdentityDigest = parseOptionalDigest(record.implementationIdentityDigest);
  if (bindingDigest.invalid || ownerIdentityDigest.invalid || sourceIdentityDigest.invalid || implementationIdentityDigest.invalid) {
    diagnostics.push(diagnostic("binding_identity_invalid", selector, capabilityId, "The local MCP binding contains a malformed identity digest."));
    return undefined;
  }
  const resolvedBindingDigest = bindingDigest.value;
  const resolvedOwnerIdentityDigest = ownerIdentityDigest.value ?? resolvedBindingDigest;
  const resolvedSourceIdentityDigest = sourceIdentityDigest.value ?? resolvedBindingDigest;
  const resolvedImplementationIdentityDigest = implementationIdentityDigest.value ?? resolvedBindingDigest;
  if (!resolvedOwnerIdentityDigest || !resolvedSourceIdentityDigest || !resolvedImplementationIdentityDigest) {
    diagnostics.push(diagnostic("binding_identity_invalid", selector, capabilityId, "The local MCP binding must carry secret-free identity digests."));
    return undefined;
  }
  const contractRevision = typeof record.contractRevision === "string" && record.contractRevision.length > 0
    ? record.contractRevision
    : MCP_TOOL_CAPABILITY_DISCOVERY_REVISION;
  if (contractRevision.length > 127 || /[\u0000-\u001f\u007f]/u.test(contractRevision)) {
    diagnostics.push(diagnostic("binding_malformed", selector, capabilityId, "The local MCP contract revision is malformed."));
    return undefined;
  }
  if (record.requiresStructuredOutput !== undefined && typeof record.requiresStructuredOutput !== "boolean") {
    diagnostics.push(diagnostic("binding_malformed", selector, capabilityId, "The structured-output requirement must be boolean."));
    return undefined;
  }
  const requiresStructuredOutput = record.requiresStructuredOutput === true;
  return {
    selector,
    capabilityId,
    kind,
    ownerKind,
    implementationKind,
    effect,
    permissions,
    approval,
    network,
    data,
    supportedCallers: callers,
    limits,
    ownerIdentityDigest: resolvedOwnerIdentityDigest,
    sourceIdentityDigest: resolvedSourceIdentityDigest,
    implementationIdentityDigest: resolvedImplementationIdentityDigest,
    contractRevision,
    requiresStructuredOutput,
    bindingDigest: resolvedBindingDigest ?? sha256(stableCanonicalStringify({ selector, capabilityId, kind, ownerKind, implementationKind, effect, permissions, approval, network, data, callers, limits })),
  };
}

function isCanonicalSelector(selector: string, serverId: string): boolean {
  const prefix = `mcp:${serverId}:tool:`;
  if (!selector.startsWith(prefix)) return false;
  const encodedName = selector.slice(prefix.length);
  if (!encodedName) return false;
  try {
    const name = decodeURIComponent(encodedName);
    return name.length > 0 && name.length <= TOOL_NAME_MAX_LENGTH
      && selector === `${prefix}${encodeURIComponent(name)}`;
  } catch {
    return false;
  }
}

function groupBindings(
  bindings: readonly ParsedBinding[],
  diagnostics: McpToolCapabilityDiscoveryDiagnostic[],
): ReadonlyMap<string, readonly ParsedBinding[]> {
  const groups = new Map<string, ParsedBinding[]>();
  for (const binding of bindings) {
    const entries = groups.get(binding.selector) ?? [];
    entries.push(binding);
    groups.set(binding.selector, entries);
  }
  for (const [selector, entries] of groups) {
    if (entries.length > 1) {
      for (const entry of entries) {
        diagnostics.push(diagnostic("binding_duplicate", selector, entry.capabilityId, "Multiple local bindings claim the same case-sensitive MCP tool selector."));
      }
    }
  }
  return groups;
}

interface DeclarationInspection {
  readonly unavailable: boolean;
  readonly outputSchemaDigest: Sha256Digest;
}

function inspectDeclaration(
  tool: ParsedTool,
  binding: ParsedBinding,
  diagnostics: McpToolCapabilityDiscoveryDiagnostic[],
): DeclarationInspection {
  let unavailable = false;
  const inputSchema = validateSchema(tool.declaration.inputSchema);
  if (!inputSchema.ok) {
    unavailable = true;
    diagnostics.push(schemaDiagnostic("input_schema_invalid", tool.selector, binding.capabilityId, inputSchema.reason));
  }
  const outputSchema = tool.declaration.outputSchema === undefined
    ? undefined
    : validateSchema(tool.declaration.outputSchema);
  if (outputSchema && !outputSchema.ok) {
    unavailable = true;
    diagnostics.push(schemaDiagnostic("output_schema_invalid", tool.selector, binding.capabilityId, outputSchema.reason));
  }
  if (binding.requiresStructuredOutput && outputSchema === undefined) {
    unavailable = true;
    diagnostics.push(diagnostic("output_schema_missing", tool.selector, binding.capabilityId, "Structured output is required by local binding, but the MCP declaration has no outputSchema."));
  }
  if (tool.declaration.description !== undefined) {
    const descriptionCheck = inspectUntrustedText(tool.declaration.description);
    if (descriptionCheck.secret) {
      unavailable = true;
      diagnostics.push(diagnostic("secret_bearing_declaration", tool.selector, binding.capabilityId, "The MCP tool description contains secret-like content and is not admitted."));
    }
    if (descriptionCheck.promptInjection) {
      unavailable = true;
      diagnostics.push(diagnostic("prompt_injection_declaration", tool.selector, binding.capabilityId, "The MCP tool description contains instruction-like content and is not admitted."));
    }
  }
  const annotationIssues = inspectAnnotations(tool.selector, binding.capabilityId, tool.declaration.annotations, binding.effect);
  diagnostics.push(...annotationIssues);
  return {
    unavailable,
    outputSchemaDigest: outputSchema?.ok && outputSchema.value !== undefined
      ? sha256(stableCanonicalStringify(outputSchema.value))
      : MCP_OUTPUT_SCHEMA_ABSENT_DIGEST,
  };
}

function inspectAnnotations(
  selector: string,
  capabilityId: string,
  annotations: Readonly<Record<string, unknown>> | undefined,
  effect: ActionEffectEnvelope,
): readonly McpToolCapabilityDiscoveryDiagnostic[] {
  if (!annotations) return [];
  const diagnostics: McpToolCapabilityDiscoveryDiagnostic[] = [];
  const readOnlyHint = annotations.readOnlyHint;
  const destructiveHint = annotations.destructiveHint;
  const idempotentHint = annotations.idempotentHint;
  const openWorldHint = annotations.openWorldHint;
  if (readOnlyHint !== undefined || destructiveHint !== undefined || idempotentHint !== undefined || openWorldHint !== undefined) {
    diagnostics.push(diagnostic("annotation_ignored", selector, capabilityId, "MCP tool annotations are retained as untrusted evidence and never grant authority.", "warning"));
  }
  if (readOnlyHint === true && effect.operation !== "observe") {
    diagnostics.push(diagnostic("annotation_contradiction", selector, capabilityId, "The readOnlyHint contradicts the explicit local effect binding; the binding remains authoritative.", "warning"));
  }
  if (destructiveHint === false && effect.operation === "mutate" && effect.reversibility === "irreversible") {
    diagnostics.push(diagnostic("annotation_contradiction", selector, capabilityId, "The destructiveHint contradicts the explicit local effect binding; the binding remains authoritative.", "warning"));
  }
  if (idempotentHint === true && effect.idempotency === "non-idempotent") {
    diagnostics.push(diagnostic("annotation_contradiction", selector, capabilityId, "The idempotentHint contradicts the explicit local effect binding; the binding remains authoritative.", "warning"));
  }
  if (openWorldHint === false && (effect.boundaries.includes("network") || effect.boundaries.includes("external-system"))) {
    diagnostics.push(diagnostic("annotation_contradiction", selector, capabilityId, "The openWorldHint contradicts the explicit local effect binding; the binding remains authoritative.", "warning"));
  }
  return diagnostics;
}

function validateSchema(value: unknown): SchemaValidation {
  const record = asPlainRecord(value);
  if (!record) return { ok: false, reason: "malformed" };
  let cloned: unknown;
  try {
    cloned = cloneInert(record, "MCP JSON Schema", {
      maxNodes: MAX_SCHEMA_NODES,
      maxDepth: MAX_SCHEMA_DEPTH,
      maxStringUnits: MAX_SCHEMA_STRING_UNITS,
    });
  } catch {
    return { ok: false, reason: "limits" };
  }
  if (!isPlainRecord(cloned)) return { ok: false, reason: "malformed" };
  const serialized = stableCanonicalStringify(cloned);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_BYTES) return { ok: false, reason: "limits" };
  const schema = schemaSafety(cloned, 0, { nodes: 0, stringUnits: 0 });
  if (schema === "external-ref") return { ok: false, reason: "external-ref" };
  if (schema === "limits") return { ok: false, reason: "limits" };
  if (schema === "secret") return { ok: false, reason: "secret" };
  if (schema === "prompt-injection") return { ok: false, reason: "prompt-injection" };
  if (cloned.$schema !== undefined && cloned.$schema !== JSON_SCHEMA_2020_12) return { ok: false, reason: "malformed" };
  if (cloned.type !== "object" || !JSON_SCHEMA_VALIDATOR.validateSchema(cloned)) return { ok: false, reason: "malformed" };
  return { ok: true, value: cloned };
}

type SchemaSafetyReason = "external-ref" | "limits" | "secret" | "prompt-injection" | undefined;

function schemaSafety(
  value: unknown,
  depth: number,
  budget: { nodes: number; stringUnits: number },
): SchemaSafetyReason {
  if (++budget.nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) return "limits";
  if (typeof value === "string") {
    budget.stringUnits += value.length;
    if (budget.stringUnits > MAX_SCHEMA_STRING_UNITS) return "limits";
    if (isPromptInjection(value)) return "prompt-injection";
    if (isSecretValue(value)) return "secret";
    return undefined;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number" || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const reason = schemaSafety(entry, depth + 1, budget);
      if (reason) return reason;
    }
    return undefined;
  }
  if (!isPlainRecord(value)) return "limits";
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" || key === "$dynamicRef") {
      if (typeof entry !== "string" || !entry.startsWith("#")) return "external-ref";
    }
    if (isSecretKey(key)) return "secret";
    const reason = schemaSafety(entry, depth + 1, budget);
    if (reason) return reason;
  }
  return undefined;
}

function buildCandidate(
  snapshot: ParsedSnapshot,
  tool: ParsedTool,
  binding: ParsedBinding,
  unavailable: boolean,
  outputSchemaDigest: Sha256Digest,
): CapabilityDescriptorCandidate {
  const declaration = tool.declaration;
  const inputSchemaDigest = sha256(stableCanonicalStringify(declaration.inputSchema));
  const declarationDigest = tool.declarationDigest;
  const revision = sha256(stableCanonicalStringify({
    adapterRevision: MCP_TOOL_CAPABILITY_DISCOVERY_REVISION,
    protocolRevision: MCP_TOOL_PROTOCOL_REVISION,
    contractRevision: binding.contractRevision,
    serverId: snapshot.serverId,
    selector: tool.selector,
    bindingDigest: snapshot.bindingDigest ?? binding.bindingDigest,
    authDigest: snapshot.authDigest ?? binding.bindingDigest,
    binding: {
      capabilityId: binding.capabilityId,
      kind: binding.kind,
      ownerKind: binding.ownerKind,
      implementationKind: binding.implementationKind,
      ownerIdentityDigest: binding.ownerIdentityDigest,
      sourceIdentityDigest: binding.sourceIdentityDigest,
      implementationIdentityDigest: binding.implementationIdentityDigest,
      effect: binding.effect,
      permissions: binding.permissions,
      approval: binding.approval,
      network: binding.network,
      data: binding.data,
      supportedCallers: binding.supportedCallers,
      limits: binding.limits,
      requiresStructuredOutput: binding.requiresStructuredOutput,
    },
    declaration: {
      name: declaration.name,
      ...(declaration.description === undefined ? {} : { description: declaration.description }),
      inputSchema: declaration.inputSchema,
      ...(declaration.outputSchema === undefined
        ? { outputSchema: { present: false } }
        : { outputSchema: declaration.outputSchema }),
      ...(declaration.annotations === undefined ? {} : { annotations: declaration.annotations }),
    },
  }));
  const effect = cloneEffect(binding.effect);
  const artifacts = declaration.outputSchema === undefined
    ? []
    : [{ mediaType: "application/json", schemaDigest: outputSchemaDigest }];
  return {
    capabilityId: binding.capabilityId,
    revision,
    // MCP is a transport. The local binding, not the protocol or serverInfo,
    // owns the implementation, owner, and capability-kind classification.
    kind: binding.kind,
    owner: { kind: binding.ownerKind, identityDigest: binding.ownerIdentityDigest },
    inputSchemaDigest,
    outputSchemaDigest,
    artifacts,
    effect,
    permissions: [...binding.permissions],
    approval: binding.approval,
    network: binding.network,
    data: { ...binding.data },
    supportedCallers: [...binding.supportedCallers],
    freshness: {
      observedAt: snapshot.freshness?.observedAt ?? "1970-01-01T00:00:00.000Z",
      validUntil: snapshot.freshness?.validUntil ?? "1970-01-01T00:00:00.001Z",
      status: unavailable ? "unavailable" : "available",
    },
    provenance: {
      sourceType: "protocol" satisfies CapabilityProvenanceSource,
      sourceIdentityDigest: binding.sourceIdentityDigest,
      sourceDigest: sha256(stableCanonicalStringify({
        protocolRevision: MCP_TOOL_PROTOCOL_REVISION,
        bindingDigest: snapshot.bindingDigest ?? binding.bindingDigest,
        authDigest: snapshot.authDigest ?? binding.bindingDigest,
        declarationDigest,
      })),
    },
    limits: { ...binding.limits },
    implementationReferences: [{
      identityDigest: binding.implementationIdentityDigest,
      kind: binding.implementationKind,
      inputSchemaDigest,
      outputSchemaDigest,
    }],
  };
}

function schemaDiagnostic(
  code: "input_schema_invalid" | "output_schema_invalid",
  selector: string,
  capabilityId: string,
  reason: SchemaValidation["reason"],
): McpToolCapabilityDiscoveryDiagnostic {
  const suffix = reason === undefined ? "" : ` (${reason})`;
  return diagnostic(code, selector, capabilityId, `The MCP ${code.startsWith("input") ? "input" : "output"} schema is not admitted${suffix}.`);
}

function globalIssue(
  code: McpToolCapabilityDiscoveryDiagnosticCode,
  message: string,
  unavailable: boolean,
): GlobalIssue {
  return { code, message, severity: "error", unavailable };
}

function diagnostic(
  code: McpToolCapabilityDiscoveryDiagnosticCode,
  selector: string | undefined,
  capabilityId: string | undefined,
  message: string,
  severity: "warning" | "error" = "error",
): McpToolCapabilityDiscoveryDiagnostic {
  return {
    code,
    ...(selector === undefined ? {} : { selector }),
    ...(capabilityId === undefined ? {} : { capabilityId }),
    message,
    severity,
  };
}

function compareDiagnostics(left: McpToolCapabilityDiscoveryDiagnostic, right: McpToolCapabilityDiscoveryDiagnostic): number {
  return compareCodeUnits(left.selector ?? "", right.selector ?? "")
    || compareCodeUnits(left.capabilityId ?? "", right.capabilityId ?? "")
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.message, right.message);
}

function compareCandidates(left: CapabilityDescriptorCandidate, right: CapabilityDescriptorCandidate): number {
  return compareCodeUnits(left.capabilityId, right.capabilityId)
    || compareCodeUnits(left.revision, right.revision);
}

function parseData(value: unknown): CapabilityDataPosture | undefined {
  const record = asPlainRecord(value);
  if (!record || !hasExactKeys(record, ["input", "output", "retention"])) return undefined;
  if (!isMember(record.input, DATA_CLASSIFICATIONS) || !isMember(record.output, DATA_CLASSIFICATIONS)
    || !isMember(record.retention, RETENTIONS)) return undefined;
  return { input: record.input, output: record.output, retention: record.retention };
}

function parseLimits(value: unknown): CapabilityLimits | undefined {
  const record = asPlainRecord(value);
  if (!record || !hasExactKeys(record, ["maxInputBytes", "maxOutputBytes", "maxDurationMs", "maxArtifacts"])) return undefined;
  if (!boundedInteger(record.maxInputBytes, 1, 16 * 1024 * 1024)
    || !boundedInteger(record.maxOutputBytes, 1, 64 * 1024 * 1024)
    || !boundedInteger(record.maxDurationMs, 1, 24 * 60 * 60 * 1_000)
    || !boundedInteger(record.maxArtifacts, 0, 256)) return undefined;
  return {
    maxInputBytes: record.maxInputBytes,
    maxOutputBytes: record.maxOutputBytes,
    maxDurationMs: record.maxDurationMs,
    maxArtifacts: record.maxArtifacts,
  };
}

function parseMembers<const T extends readonly string[]>(value: unknown, members: T): readonly T[number][] | undefined {
  if (!Array.isArray(value) || value.length > members.length || new Set(value).size !== value.length) return undefined;
  if (!value.every((entry) => isMember(entry, members))) return undefined;
  return members.filter((member) => value.includes(member)) as readonly T[number][];
}

function parseMember<const T extends readonly string[]>(value: unknown, members: T): T[number] | undefined {
  return isMember(value, members) ? value : undefined;
}

function isMember<const T extends readonly string[]>(value: unknown, members: T): value is T[number] {
  return typeof value === "string" && members.includes(value);
}

function parseDigest(value: unknown): Sha256Digest | undefined {
  return typeof value === "string" && DIGEST_PATTERN.test(value) ? value as Sha256Digest : undefined;
}

function parseOptionalDigest(value: unknown): { readonly value?: Sha256Digest; readonly invalid: boolean } {
  if (value === undefined) return { invalid: false };
  const digest = parseDigest(value);
  return digest === undefined ? { invalid: true } : { value: digest, invalid: false };
}

function cloneEffect(effect: ActionEffectEnvelope): ActionEffectEnvelope {
  const normalized = normalizeActionEffectEnvelope(effect);
  if (!normalized) throw new TypeError("MCP local effect unexpectedly became malformed.");
  return {
    ...normalized,
    boundaries: [...normalized.boundaries],
    consequences: [...normalized.consequences],
  };
}

function inspectUntrustedText(value: string): { readonly secret: boolean; readonly promptInjection: boolean } {
  return { secret: isSecretValue(value), promptInjection: isPromptInjection(value) };
}

function isSecretKey(key: string): boolean {
  return /(?:^|[_-])(authorization|cookie|credential|password|passwd|private[_-]?key|secret|token|api[_-]?key|access[_-]?key)(?:$|[_-])/iu.test(key)
    || /^(?:authorization|cookie|credential|credentials|password|passwd|privatekey|secret|token|apitoken|apikey|accesskey)$/iu.test(key.replace(/[^A-Za-z]/gu, ""));
}

function isSecretValue(value: string): boolean {
  return value.length > 4_096
    || /(?:^|[._:/+\-])Bearer\s+\S+/iu.test(value)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(value)
    || /(?:^|[._:/+\-])[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@/iu.test(value)
    || /(?:^|[._:/+\-])(?:sk|pk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u.test(value)
    || /(?:^|[._:/+\-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u.test(value)
    || /(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/iu.test(value);
}

function isPromptInjection(value: string): boolean {
  return /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+(?:instructions?|rules?)/iu.test(value)
    || /(?:reveal| exfiltrat|dump|print)\s+(?:the\s+)?(?:secret|token|credential|system prompt|hidden prompt)/iu.test(value)
    || /(?:you are now|act as|pretend to be)\s+(?:an?\s+)?(?:system|developer|assistant|admin)/iu.test(value)
    || /<\/?(?:system|developer|assistant|instructions?)\b[^>]*>/iu.test(value)
    || /jailbreak|prompt\s+injection/iu.test(value);
}

function requirePlainRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asPlainRecord(value);
  if (!record) throw new TypeError(`${label} must be an inert plain-data object.`);
  return record;
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  return value as Record<string, unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (!hasExactKeys(record, keys)) throw new TypeError(`${label} contains unknown or missing fields.`);
}

function hasExactKeys(record: Record<string, unknown> | undefined, keys: readonly string[]): record is Record<string, unknown> {
  if (!record) return false;
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function hasAllowedKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function containsSecretBearing(value: unknown): boolean {
  const pending: Array<{ readonly key?: string; readonly value: unknown }> = [{ value }];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (++visited > 100_000) return true;
    if (current.key !== undefined && isSecretKey(current.key)) return true;
    if (typeof current.value === "string") {
      if (isSecretValue(current.value)) return true;
      continue;
    }
    if (!current.value || typeof current.value !== "object" || seen.has(current.value)) continue;
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      for (const entry of current.value) pending.push({ value: entry });
      continue;
    }
    for (const [key, entry] of Object.entries(current.value as Record<string, unknown>)) {
      pending.push({ key, value: entry });
    }
  }
  return false;
}

interface CloneBudget {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxStringUnits: number;
}

function cloneInert(value: unknown, label: string, budget: CloneBudget): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let stringUnits = 0;
  const visit = (current: unknown, depth: number): unknown => {
    if (++nodes > budget.maxNodes || depth > budget.maxDepth) throw new TypeError(`${label} exceeds bounded inspection limits.`);
    if (typeof current === "string") {
      stringUnits += current.length;
      if (stringUnits > budget.maxStringUnits) throw new TypeError(`${label} exceeds bounded string limits.`);
      return current;
    }
    if (current === null || typeof current === "boolean" || current === undefined) return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError(`${label} contains a non-finite number.`);
      return current;
    }
    if (typeof current !== "object") throw new TypeError(`${label} contains an executable or symbolic value.`);
    if (seen.has(current)) throw new TypeError(`${label} contains a cyclic object graph.`);
    seen.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype || descriptors.length === undefined || !("value" in descriptors.length)
        || typeof descriptors.length.value !== "number" || !Number.isSafeInteger(descriptors.length.value)
        || descriptors.length.value > budget.maxNodes) throw new TypeError(`${label} contains an exotic array.`);
      const result: unknown[] = [];
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) {
        throw new TypeError(`${label} contains non-index array fields.`);
      }
      for (let index = 0; index < descriptors.length.value; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${label} contains an array hole or accessor.`);
        result.push(visit(descriptor.value, depth + 1));
      }
      if (keys.length !== descriptors.length.value + 1) throw new TypeError(`${label} contains array metadata.`);
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} contains an exotic object.`);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string") || keys.length > 128) throw new TypeError(`${label} contains invalid object keys.`);
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${label} contains an accessor or non-enumerable field.`);
      Object.defineProperty(result, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  };
  return visit(value, 0);
}

function stableCanonicalStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableCanonicalStringify(entry)}`).join(",")}}`;
}

function sha256(value: string): Sha256Digest {
  return sha256ContentIdentity(value) as Sha256Digest;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
