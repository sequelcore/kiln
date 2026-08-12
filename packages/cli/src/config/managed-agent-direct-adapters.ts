import type {
  Capability,
  DefaultBuiltinToolRegistryOptions,
  DirectProviderId,
  ManagedAgentAdapterWriteAuthorityDescriptor,
  ProviderAdapter,
  ResolvedMcpServer,
  ToolDefinition,
} from "@kilnai/core";
import {
  isDirectProviderId,
  resolveDirectProviderExecutionProfile,
} from "@kilnai/core";
import {
  createAttachedRuntimeBuiltinToolSurface,
  ManagedDirectProviderRuntimeAdapter,
  type ManagedCommittedInvocationRequest,
  type RuntimeExecutionEnvelope,
  type ManagedAgentRuntimeAdapter,
} from "@kilnai/runtime";
import type { KilnManagedAgentRouteConfig } from "../kiln-yaml-types.js";
import {
  createDirectProviderAdapter,
  type DirectProviderCredentialBinding,
  type DirectProviderAdapterOptions,
} from "../wrapper/direct-provider-adapter-factory.js";
import { createCanonicalMcpClient } from "./mcp-credentials.js";
type EnvMap = Readonly<Record<string, string | undefined>>;
type BuiltinToolOptionsSource =
  | DefaultBuiltinToolRegistryOptions
  | (() => DefaultBuiltinToolRegistryOptions | undefined);
type ExecutionEnvelopeSource = RuntimeExecutionEnvelope | (() => RuntimeExecutionEnvelope | undefined);
const WRITE_PROFILES = new Set([
  "foundation-propose-writes",
  "foundation-apply-approved-writes",
  "foundation-memory-write-proposals",
]);
const LIVE_PROVEN_DIRECT_WRITE_AUTHORITY: ManagedAgentAdapterWriteAuthorityDescriptor = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
};

export interface ManagedDirectProviderAdapterFactoryOptions {
  readonly builtinToolOptions?: BuiltinToolOptionsSource;
  readonly configEnv?: EnvMap;
  readonly runtimeEnv?: EnvMap;
  readonly processEnv?: EnvMap;
  readonly executionEnvelope?: ExecutionEnvelopeSource;
  readonly canonicalMcpServers?: readonly ResolvedMcpServer[];
  readonly createMcpClient?: (server: ResolvedMcpServer) => {
    readonly serverName: string;
    discoverProviderCapabilities(): Promise<readonly Capability[]>;
    executeCapability(selector: string, input: Record<string, unknown>): Promise<unknown>;
    disconnect?(): Promise<void>;
  };
  readonly createProviderAdapter?: (options: DirectProviderAdapterOptions) => Promise<ProviderAdapter>;
}

export function createManagedDirectProviderAdapterFactory(
  options: ManagedDirectProviderAdapterFactoryOptions = {},
): (
  route: KilnManagedAgentRouteConfig,
  credentialBinding: DirectProviderCredentialBinding | undefined,
  abortSignal: AbortSignal | undefined,
  committedRequest: ManagedCommittedInvocationRequest,
) => Promise<ManagedAgentRuntimeAdapter | undefined> {
  const resolveBuiltinToolSurface = () => createAttachedRuntimeBuiltinToolSurface({
    builtinToolOptions: resolveBuiltinToolOptions(options.builtinToolOptions),
  });
  const createProvider = options.createProviderAdapter ?? createDirectProviderAdapter;

  return async (route, credentialBinding, abortSignal, committedRequest) => {
    throwIfAborted(abortSignal);
    if (route.kind !== "direct") {
      return undefined;
    }
    const committedRoute = committedRequest.commitment.reservation.selectedIdentity.route;
    const provider = requireDirectProvider(committedRoute.providerId);
    const model = committedRoute.modelId;
    const executionProfile = resolveDirectProviderExecutionProfile({
      provider,
      model,
      requestedExecutionMode: "kiln-executable",
    });
    if (!executionProfile?.supportsKilnExecutableTools || executionProfile.executionMode !== "kiln-executable") {
      throw new Error(`Direct provider route '${route.id}' requires a tool-call-capable model; '${provider}/${model}' is not eligible.`);
    }
    assertCommittedEconomicRoute(route.id, provider, executionProfile.model, committedRequest);

    if (!credentialBinding) {
      throw new Error(`Managed direct route '${route.id}' has no committed credential binding.`);
    }
    const providerAdapter = await createProvider({
        provider,
        model: executionProfile.model,
        credentialBinding,
        configEnv: options.configEnv,
        runtimeEnv: options.runtimeEnv,
        processEnv: options.processEnv,
      });
    throwIfAborted(abortSignal);
    const builtinToolSurface = resolveBuiltinToolSurface();
    const admittedMcpSelectors = new Set(
      (route.tools?.allowed ?? []).filter((name) => name.startsWith("mcp:")),
    );
    const createMcpClient = options.createMcpClient ?? createCanonicalMcpClient;
    const mcpClients = admittedMcpSelectors.size > 0
      ? (options.canonicalMcpServers ?? []).map(createMcpClient)
      : [];
    let discoveredMcpCapabilities: readonly (readonly Capability[])[];
    try {
      discoveredMcpCapabilities = await Promise.all(mcpClients.map((client) => client.discoverProviderCapabilities()));
    } finally {
      await Promise.all(mcpClients.map(disconnectMcpClient));
    }
    throwIfAborted(abortSignal);
    const mcpCapabilities = discoveredMcpCapabilities.flat()
      .filter((capability) => admittedMcpSelectors.has(capability.name));
    const mcpTools: ToolDefinition[] = mcpCapabilities.map((capability) => ({
      name: capability.name,
      description: capability.description,
      inputSchema: capability.schema,
      tags: new Set(capability.tags),
    }));
    const mcpCapabilityMap = new Map<string, Capability>(mcpCapabilities.map((capability) => [
      capability.name,
      capability,
    ]));
    const mcpExecutors = new Map(mcpCapabilities.map((capability) => {
      const client = mcpClients.find((candidate) => capability.name.startsWith(`mcp:${candidate.serverName}:`));
      if (!client) throw new Error(`No canonical MCP client owns selector '${capability.name}'.`);
      return [capability.name, async (input: Record<string, unknown>) => {
        try {
          return await client.executeCapability(capability.name, input);
        } finally {
          await disconnectMcpClient(client);
        }
      }] as const;
    }));
    const runtimeTools = new Map([...builtinToolSurface.callBuiltinTools, ...mcpExecutors]);
    const runtimeCapabilities = new Map([...builtinToolSurface.capabilities, ...mcpCapabilityMap]);
    const executionEnvelope = resolveExecutionEnvelope(options.executionEnvelope);

    return new ManagedDirectProviderRuntimeAdapter({
      providerId: provider,
      model: executionProfile.model,
      provider: providerAdapter,
      tools: [...builtinToolSurface.toolDefinitions, ...mcpTools],
      builtinTools: runtimeTools,
      builtinToolsProvider: () => new Map([
        ...resolveBuiltinToolSurface().callBuiltinTools,
        ...mcpExecutors,
      ]),
      capabilityMap: runtimeCapabilities,
      toolAuthority: builtinToolSurface.toolAuthority,
      ...(executionEnvelope ? { executionEnvelope } : {}),
      economicIdentity: committedRequest.commitment.reservation.selectedIdentity,
      ...(routeRequiresWriteAuthority(route) ? { writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY } : {}),
    });
  };
}

function assertCommittedEconomicRoute(
  routeId: string,
  providerId: string,
  modelId: string,
  committedRequest: ManagedCommittedInvocationRequest,
): void {
  const committedRoute = committedRequest.commitment.reservation.selectedIdentity.route;
  if (
    committedRoute.routeId !== routeId
    || committedRoute.providerId !== providerId
    || committedRoute.modelId !== modelId
  ) {
    throw new Error(
      `Managed direct route '${routeId}' does not match the committed economic route.`,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Managed adapter construction was aborted.");
}

async function disconnectMcpClient(client: { readonly disconnect?: () => Promise<void> }): Promise<void> {
  if (!client.disconnect) return;
  await client.disconnect().catch(() => undefined);
}

function resolveExecutionEnvelope(source: ExecutionEnvelopeSource | undefined): RuntimeExecutionEnvelope | undefined {
  return typeof source === "function" ? source() : source;
}

function resolveBuiltinToolOptions(
  source: BuiltinToolOptionsSource | undefined,
): DefaultBuiltinToolRegistryOptions | undefined {
  return typeof source === "function" ? source() : source;
}

function routeRequiresWriteAuthority(route: KilnManagedAgentRouteConfig): boolean {
  return route.tools?.writes === true
    || route.profiles?.some((profile) => WRITE_PROFILES.has(profile)) === true;
}

function requireDirectProvider(provider: string): DirectProviderId {
  if (!isDirectProviderId(provider)) {
    throw new Error(`Provider '${provider}' is not a direct provider.`);
  }
  return provider;
}
