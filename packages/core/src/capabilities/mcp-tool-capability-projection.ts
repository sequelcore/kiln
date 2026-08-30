import {
  formatMcpCapabilitySelector,
  type McpToolCapabilityBindingConfiguration,
  type ResolvedMcpServer,
} from "../mcp/index.js";
import {
  assertMcpDiscoverySnapshot,
  readMcpDiscoverySnapshotAttestation,
  type McpDiscoverySnapshot,
} from "../mcp/client/index.js";
import { normalizeActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import {
  discoverMcpToolCapabilities,
  MCP_SERVER_BINDING_PROJECTION_REVISION,
  type McpToolCapabilityBinding,
  type McpToolCapabilityDiscoveryInput,
  type McpToolCapabilityDiscoveryResult,
} from "./mcp-tool-capability-discovery.js";
import type {
  ActionEffectEnvelope,
} from "../engine/domain/action-effect.js";
import type {
  CapabilityDataPosture,
  CapabilityLimits,
  Sha256Digest,
} from "./capability-catalog.js";

/** Revision for the role-separated identities projected for MCP bindings. */
export const MCP_CAPABILITY_IDENTITY_PROJECTION_REVISION = "mcp-capability-identity/v1" as const;

const MCP_CAPABILITY_IDENTITY_DOMAINS = {
  owner: "kiln.mcp.capability.owner",
  source: "kiln.mcp.capability.source",
  implementation: "kiln.mcp.capability.implementation",
} as const;
const ACTION_EFFECT_KEYS = [
  "operation",
  "boundaries",
  "reversibility",
  "dataEgress",
  "identityUse",
  "consequences",
  "idempotency",
] as const;
const INVALID_DIGEST = `sha256:${"0".repeat(64)}` as Sha256Digest;

export type McpCapabilityIdentityRole = keyof typeof MCP_CAPABILITY_IDENTITY_DOMAINS;

/** Opaque, already-authorized context evidence supplied by its owning authority. */
export interface McpAuthorizationContextEvidence {
  readonly digest: Sha256Digest;
  readonly revision: string;
}

/** Inputs owned by the productive Core MCP projection boundary. */
export interface McpToolCapabilityProjectionInput {
  readonly evaluatedAt: string;
  readonly server: ResolvedMcpServer;
  readonly snapshot: McpDiscoverySnapshot;
  readonly authorization: McpAuthorizationContextEvidence;
}

/**
 * Projects resolved MCP configuration and a settled client snapshot into the
 * inert adapter contract. The projector does not validate posture semantics;
 * configuration resolution and the adapter remain the owning validators.
 */
export function projectMcpToolCapabilityDiscoveryInput(
  input: McpToolCapabilityProjectionInput,
): McpToolCapabilityDiscoveryInput {
  const settledSnapshot = assertMcpDiscoverySnapshot(input.snapshot);
  const attestation = readMcpDiscoverySnapshotAttestation(settledSnapshot);
  const bindingDigest = deriveMcpServerBindingDigest(input.server);
  const attestationMatches = attestation !== undefined
    && attestation.bindingDigest === bindingDigest
    && attestation.bindingRevision === MCP_SERVER_BINDING_PROJECTION_REVISION
    && attestation.authorizationDigest === input.authorization.digest
    && attestation.authorizationRevision === input.authorization.revision;
  const snapshotBindingDigest = attestation?.bindingDigest ?? INVALID_DIGEST;
  const snapshotAuthDigest = attestation?.authorizationDigest ?? INVALID_DIGEST;
  const snapshotBindingRevision = attestation?.bindingRevision ?? "unsettled";
  const snapshotAuthRevision = attestation?.authorizationRevision ?? "unsettled";
  return {
    evaluatedAt: input.evaluatedAt,
    snapshot: {
      serverId: settledSnapshot.serverId,
      protocolRevision: settledSnapshot.protocolRevision,
      completeness: settledSnapshot.completeness,
      invalidated: settledSnapshot.invalidated || !attestationMatches,
      freshness: projectFreshness(settledSnapshot.freshness),
      bindingDigest: snapshotBindingDigest,
      authDigest: snapshotAuthDigest,
      bindingRevision: snapshotBindingRevision,
      authRevision: snapshotAuthRevision,
      tools: settledSnapshot.tools.map(projectTool),
    },
    bindings: projectBindings(input.server, settledSnapshot.tools, bindingDigest),
  };
}

/** Projects and runs the existing pure MCP discovery adapter. */
export function projectMcpToolCapabilityDiscovery(
  input: McpToolCapabilityProjectionInput,
): McpToolCapabilityDiscoveryResult {
  return discoverMcpToolCapabilities(projectMcpToolCapabilityDiscoveryInput(input));
}

/** Derives the stable, secret-free digest for one effective MCP server binding. */
export function deriveMcpServerBindingDigest(server: ResolvedMcpServer): Sha256Digest {
  const projection = {
    projectionRevision: MCP_SERVER_BINDING_PROJECTION_REVISION,
    serverId: server.id,
    enabled: server.enabled,
    transport: server.transport,
    ...(server.command === undefined ? {} : { command: { configured: true } }),
    ...(server.args === undefined ? {} : { args: { configured: true, count: server.args.length } }),
    ...(server.cwd === undefined ? {} : { cwd: { configured: true } }),
    ...(server.env === undefined ? {} : { env: projectReferences(server.env) }),
    ...(server.url === undefined ? {} : { url: { configured: true } }),
    ...(server.headers === undefined ? {} : { headers: projectReferences(server.headers) }),
    ...(server.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: server.startupTimeoutMs }),
    ...(server.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: server.requestTimeoutMs }),
    ...(server.maxCapabilities === undefined ? {} : { maxCapabilities: server.maxCapabilities }),
    ...(server.reconnect === undefined ? {} : { reconnect: projectReconnect(server.reconnect) }),
    ...(server.admission === undefined ? {} : { admission: projectAdmission(server.admission) }),
    ...(server.capabilityBindings === undefined
      ? {}
      : { capabilityBindings: projectCapabilityBindingsForDigest(server.capabilityBindings) }),
    ...(server.trust === undefined ? {} : { trust: server.trust }),
  } as const;
  return sha256ContentIdentity(stableCanonicalStringify(projection)) as Sha256Digest;
}

/**
 * Derives one opaque, role-separated identity from the operator-owned server
 * binding digest. The domain and revision are part of the preimage so role
 * identities cannot collapse into one another or silently change semantics.
 */
export function deriveMcpCapabilityIdentityDigest(
  bindingDigest: Sha256Digest,
  role: McpCapabilityIdentityRole,
): Sha256Digest {
  return sha256ContentIdentity(stableCanonicalStringify({
    bindingDigest,
    domain: MCP_CAPABILITY_IDENTITY_DOMAINS[role],
    revision: MCP_CAPABILITY_IDENTITY_PROJECTION_REVISION,
  })) as Sha256Digest;
}

function projectFreshness(
  freshness: McpDiscoverySnapshot["freshness"],
): McpToolCapabilityDiscoveryInput["snapshot"]["freshness"] {
  return {
    observedAt: freshness.observedAt,
    ...(freshness.validUntil === undefined ? {} : { validUntil: freshness.validUntil }),
  };
}

function projectTool(
  tool: McpDiscoverySnapshot["tools"][number],
): McpToolCapabilityDiscoveryInput["snapshot"]["tools"][number] {
  return {
    selector: tool.selector,
    descriptor: {
      name: tool.descriptor.name,
      ...(tool.descriptor.description === undefined ? {} : { description: tool.descriptor.description }),
      inputSchema: tool.descriptor.inputSchema,
      ...(tool.descriptor.outputSchema === undefined ? {} : { outputSchema: tool.descriptor.outputSchema }),
      ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    },
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  };
}

function projectBindings(
  server: ResolvedMcpServer,
  tools: McpDiscoverySnapshot["tools"],
  bindingDigest: Sha256Digest,
): readonly McpToolCapabilityBinding[] {
  // A snapshot may be replayed after project configuration disables the
  // server. Keep the disabled state authoritative at this projection boundary
  // instead of allowing an old settled list to advertise a live capability.
  if (!server.enabled) return [];
  const configured = server.capabilityBindings;
  if (configured === undefined) return [];
  return tools.flatMap((tool) => {
    const binding = configured[tool.descriptor.name];
    const effect = resolveAdmittedMcpToolEffect(server, tool.descriptor.name);
    return binding === undefined || effect === undefined
      ? []
      : [projectBinding(server.id, tool.descriptor.name, bindingDigest, binding, effect)];
  });
}

function projectBinding(
  serverId: string,
  toolName: string,
  bindingDigest: Sha256Digest,
  binding: McpToolCapabilityBindingConfiguration,
  effect: ActionEffectEnvelope,
): McpToolCapabilityBinding {
  return {
    serverId,
    selector: formatMcpCapabilitySelector(serverId, "tool", toolName),
    capabilityId: binding.capabilityId,
    bindingDigest,
    kind: binding.kind,
    ownerKind: binding.ownerKind,
    implementationKind: binding.implementationKind,
    ownerIdentityDigest: deriveMcpCapabilityIdentityDigest(bindingDigest, "owner"),
    sourceIdentityDigest: deriveMcpCapabilityIdentityDigest(bindingDigest, "source"),
    implementationIdentityDigest: deriveMcpCapabilityIdentityDigest(bindingDigest, "implementation"),
    effect,
    permissions: binding.permissions,
    approval: binding.approval,
    network: binding.network,
    data: binding.data,
    supportedCallers: binding.supportedCallers,
    limits: binding.limits,
    ...(binding.contractRevision === undefined ? {} : { contractRevision: binding.contractRevision }),
    ...(binding.requiresStructuredOutput === undefined ? {} : { requiresStructuredOutput: binding.requiresStructuredOutput }),
  };
}

function projectCapabilityBindingsForDigest(
  bindings: Readonly<Record<string, McpToolCapabilityBindingConfiguration>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(bindings).map(([toolName, binding]) => [
    toolName,
    projectBindingForDigest(binding),
  ]));
}

function projectBindingForDigest(binding: McpToolCapabilityBindingConfiguration): Record<string, unknown> {
  return {
    capabilityId: binding.capabilityId,
    kind: binding.kind,
    ownerKind: binding.ownerKind,
    implementationKind: binding.implementationKind,
    ...(binding.contractRevision === undefined ? {} : { contractRevision: binding.contractRevision }),
    permissions: [...binding.permissions],
    approval: binding.approval,
    network: binding.network,
    data: projectData(binding.data),
    supportedCallers: [...binding.supportedCallers],
    limits: projectLimits(binding.limits),
    ...(binding.requiresStructuredOutput === undefined ? {} : { requiresStructuredOutput: binding.requiresStructuredOutput }),
  };
}

function resolveAdmittedMcpToolEffect(
  server: ResolvedMcpServer,
  toolName: string,
): ActionEffectEnvelope | undefined {
  if (server.admission?.state !== "admitted") return undefined;
  const rawEffect = server.admission.effects?.[toolName];
  if (!isExactActionEffectRecord(rawEffect)) return undefined;
  const effect = normalizeActionEffectEnvelope(rawEffect);
  return effect === undefined ? undefined : {
    ...effect,
    boundaries: [...effect.boundaries],
    consequences: [...effect.consequences],
  };
}

function isExactActionEffectRecord(value: unknown): value is ActionEffectEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === ACTION_EFFECT_KEYS.length
    && ACTION_EFFECT_KEYS.every((key) => Object.hasOwn(value, key));
}

function projectAdmission(admission: NonNullable<ResolvedMcpServer["admission"]>): Record<string, unknown> {
  return {
    state: admission.state,
    ...(admission.tools === undefined ? {} : { tools: projectAdmissionList(admission.tools) }),
    ...(admission.resources === undefined ? {} : { resources: projectAdmissionList(admission.resources) }),
    ...(admission.prompts === undefined ? {} : { prompts: projectAdmissionList(admission.prompts) }),
    ...(admission.effects === undefined
      ? {}
      : { effects: Object.fromEntries(Object.entries(admission.effects).map(([name, effect]) => [name, projectEffect(effect)])) }),
  };
}

function projectAdmissionList(
  list: NonNullable<NonNullable<ResolvedMcpServer["admission"]>["tools"]>,
): Record<string, unknown> {
  return {
    ...(list.allow === undefined ? {} : { allow: [...list.allow] }),
    ...(list.deny === undefined ? {} : { deny: [...list.deny] }),
  };
}

function projectReconnect(reconnect: NonNullable<ResolvedMcpServer["reconnect"]>): Record<string, unknown> {
  return {
    maxAttempts: reconnect.maxAttempts,
    ...(reconnect.initialDelayMs === undefined ? {} : { initialDelayMs: reconnect.initialDelayMs }),
    ...(reconnect.maxDelayMs === undefined ? {} : { maxDelayMs: reconnect.maxDelayMs }),
  };
}

function projectReferences(
  values: Readonly<Record<string, { readonly value: string } | { readonly fromEnv: string } | { readonly fromCredential: string }>>,
): Readonly<Record<string, unknown>> {
  // Literal and resolved values are intentionally represented only by shape.
  // Value rotation belongs to the authorization authority's keyed opaque digest.
  return Object.fromEntries(Object.entries(values).map(([name, reference]) => [
    name,
    "fromEnv" in reference
      ? { fromEnv: reference.fromEnv }
      : "fromCredential" in reference
        ? { fromCredential: reference.fromCredential }
        : { kind: "literal" },
  ]));
}

function projectEffect(effect: ActionEffectEnvelope): Record<string, unknown> {
  return {
    operation: effect.operation,
    boundaries: [...effect.boundaries],
    reversibility: effect.reversibility,
    dataEgress: effect.dataEgress,
    identityUse: effect.identityUse,
    consequences: [...effect.consequences],
    idempotency: effect.idempotency,
  };
}

function projectData(data: CapabilityDataPosture): Record<string, unknown> {
  return { input: data.input, output: data.output, retention: data.retention };
}

function projectLimits(limits: CapabilityLimits): Record<string, unknown> {
  return {
    maxInputBytes: limits.maxInputBytes,
    maxOutputBytes: limits.maxOutputBytes,
    maxDurationMs: limits.maxDurationMs,
    maxArtifacts: limits.maxArtifacts,
  };
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

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
