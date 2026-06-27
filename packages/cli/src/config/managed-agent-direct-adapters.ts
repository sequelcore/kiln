import type {
  DefaultBuiltinToolRegistryOptions,
  DirectProviderId,
  ManagedAgentAdapterWriteAuthorityDescriptor,
  ProviderAdapter,
} from "@kilnai/core";
import {
  isDirectProviderId,
  resolveDirectProviderExecutionProfile,
} from "@kilnai/core";
import {
  createAttachedRuntimeBuiltinToolSurface,
  ManagedDirectProviderRuntimeAdapter,
  type RuntimeExecutionEnvelope,
  type ManagedAgentRuntimeAdapter,
} from "@kilnai/runtime";
import type { KilnManagedAgentRouteConfig } from "../kiln-yaml-types.js";
import {
  createDirectProviderAdapter,
  type DirectProviderAdapterOptions,
} from "../wrapper/direct-provider-adapter-factory.js";

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
  readonly createProviderAdapter?: (options: DirectProviderAdapterOptions) => Promise<ProviderAdapter>;
}

export function createManagedDirectProviderAdapterFactory(
  options: ManagedDirectProviderAdapterFactoryOptions = {},
): (route: KilnManagedAgentRouteConfig) => Promise<ManagedAgentRuntimeAdapter | undefined> {
  const resolveBuiltinToolSurface = () => createAttachedRuntimeBuiltinToolSurface({
    builtinToolOptions: resolveBuiltinToolOptions(options.builtinToolOptions),
  });
  const createProvider = options.createProviderAdapter ?? createDirectProviderAdapter;

  return async (route) => {
    if (route.kind !== "direct") {
      return undefined;
    }
    const provider = requireDirectProvider(route.provider);
    const model = requireRouteModel(route);
    const executionProfile = resolveDirectProviderExecutionProfile({
      provider,
      model,
      requestedExecutionMode: "kiln-executable",
    });
    if (!executionProfile?.supportsKilnExecutableTools || executionProfile.executionMode !== "kiln-executable") {
      throw new Error(`Direct provider route '${route.id}' requires a tool-call-capable model; '${provider}/${model}' is not eligible.`);
    }

    const providerAdapter = await createProvider({
      provider,
      model: executionProfile.model,
      configEnv: options.configEnv,
      runtimeEnv: options.runtimeEnv,
      processEnv: options.processEnv,
    });
    const builtinToolSurface = resolveBuiltinToolSurface();
    const executionEnvelope = resolveExecutionEnvelope(options.executionEnvelope);

    return new ManagedDirectProviderRuntimeAdapter({
      providerId: provider,
      model: executionProfile.model,
      provider: providerAdapter,
      tools: builtinToolSurface.toolDefinitions,
      builtinTools: builtinToolSurface.callBuiltinTools,
      builtinToolsProvider: () => resolveBuiltinToolSurface().callBuiltinTools,
      capabilityMap: builtinToolSurface.capabilities,
      toolAuthority: builtinToolSurface.toolAuthority,
      ...(executionEnvelope ? { executionEnvelope } : {}),
      ...(routeRequiresWriteAuthority(route) ? { writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY } : {}),
    });
  };
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

function requireRouteModel(route: KilnManagedAgentRouteConfig): string {
  const model = route.model?.trim();
  if (!model) {
    throw new Error(`Direct managed invocation route '${route.id}' requires a model.`);
  }
  return model;
}
