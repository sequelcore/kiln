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
  type ManagedInvocationRouteProfile,
  type RuntimeExecutionEnvelope,
  type ManagedAgentRuntimeAdapter,
} from "@kilnai/runtime";
import type {
  EffectiveAuthorityAdmissionBundle,
  RuntimeModelRoundActionClaimStore,
  RuntimeToolActionClaimStore,
} from "@kilnai/runtime";
import type { ResolvedManagedTargetConfig } from "./resolved-managed-target.js";
import {
  createDirectProviderAdapter,
  directProviderExecutionBinding,
  type DirectProviderCredentialBinding,
  type DirectProviderAdapterOptions,
} from "../wrapper/direct-provider-adapter-factory.js";
import { createCanonicalMcpClient } from "./mcp-credentials.js";
type EnvMap = Readonly<Record<string, string | undefined>>;
type BuiltinToolOptionsSource =
  | DefaultBuiltinToolRegistryOptions
  | (() => DefaultBuiltinToolRegistryOptions | undefined);
type ExecutionEnvelopeSource = RuntimeExecutionEnvelope | (() => RuntimeExecutionEnvelope | undefined);
const LIVE_PROVEN_DIRECT_WRITE_AUTHORITY: ManagedAgentAdapterWriteAuthorityDescriptor = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
};

export interface ManagedDirectProviderAdapterFactoryOptions {
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly builtinToolOptions?: BuiltinToolOptionsSource;
  readonly configEnv?: EnvMap;
  readonly runtimeEnv?: EnvMap;
  readonly processEnv?: EnvMap;
  readonly executionEnvelope?: ExecutionEnvelopeSource;
  readonly providerTransportAdmission?: import("@kilnai/core").ProviderTransportAdmission;
  readonly canonicalMcpServers?: readonly ResolvedMcpServer[];
  readonly createMcpClient?: (server: ResolvedMcpServer) => {
    readonly serverName: string;
    discoverProviderCapabilities(): Promise<readonly Capability[]>;
    executeCapability(selector: string, input: Record<string, unknown>): Promise<unknown>;
    disconnect?(): Promise<void>;
  };
  readonly createProviderAdapter?: (options: DirectProviderAdapterOptions) => Promise<ProviderAdapter>;
  readonly runtimeToolActionClaims: RuntimeToolActionClaimStore;
  readonly readAuthorityAdmission: (input: {
    readonly admissionId: string;
    readonly sessionId: string;
    readonly turnId: string;
  }) => EffectiveAuthorityAdmissionBundle | undefined | Promise<EffectiveAuthorityAdmissionBundle | undefined>;
  readonly runtimeModelRoundActionClaims: RuntimeModelRoundActionClaimStore;
  readonly modelRoundAdapterIdentity?: string;
  readonly toolActionAdapterIdentity?: string;
}

export function createManagedDirectProviderAdapterFactory(
  options: ManagedDirectProviderAdapterFactoryOptions,
): (
  route: ResolvedManagedTargetConfig,
  credentialBinding: DirectProviderCredentialBinding | undefined,
  abortSignal: AbortSignal | undefined,
  committedRequest: ManagedCommittedInvocationRequest,
  profile: ManagedInvocationRouteProfile,
) => Promise<ManagedAgentRuntimeAdapter | undefined> {
  const resolveBuiltinToolSurface = () => createAttachedRuntimeBuiltinToolSurface({
    builtinToolOptions: resolveBuiltinToolOptions(options.builtinToolOptions),
  });
  const createProvider = options.createProviderAdapter ?? createDirectProviderAdapter;

  return async (route, credentialBinding, abortSignal, committedRequest, profile) => {
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
        kilnHome: options.kilnHome,
        credentialBinding,
        configEnv: options.configEnv,
        runtimeEnv: options.runtimeEnv,
        processEnv: options.processEnv,
        // The managed action claim is the retry boundary. Provider-level
        // automatic retries would be a second unclaimed effect.
      });
    throwIfAborted(abortSignal);
    const builtinToolSurface = resolveBuiltinToolSurface();
    const admittedMcpSelectors = new Set(
      profile.allowedToolNames.filter((name) => name.startsWith("mcp:")),
    );
    const createMcpClient = options.createMcpClient
      ?? ((server: ResolvedMcpServer) => createCanonicalMcpClient(server, options.kilnHome));
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

    const executionBinding = directProviderExecutionBinding(providerAdapter);
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
      ...(options.providerTransportAdmission ? { providerTransportAdmission: options.providerTransportAdmission } : {}),
      economicIdentity: committedRequest.commitment.reservation.selectedIdentity,
      ...(executionBinding ? { executionBinding } : {}),
      ...(profile.writeAllowed === true ? { writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY } : {}),
       runtimeToolActionClaims: options.runtimeToolActionClaims,
       readAuthorityAdmission: options.readAuthorityAdmission,
       runtimeModelRoundActionClaims: options.runtimeModelRoundActionClaims,
       ...(options.modelRoundAdapterIdentity ? { modelRoundAdapterIdentity: options.modelRoundAdapterIdentity } : {}),
       ...(options.toolActionAdapterIdentity ? { toolActionAdapterIdentity: options.toolActionAdapterIdentity } : {}),
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

function requireDirectProvider(provider: string): DirectProviderId {
  if (!isDirectProviderId(provider)) {
    throw new Error(`Provider '${provider}' is not a direct provider.`);
  }
  return provider;
}
