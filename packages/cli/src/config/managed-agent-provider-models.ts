import type {
  ManagedAgentAdmissionProfile,
  ModelDeliberationCapabilities,
  ProviderModelEvidence,
  ProviderModelEligibilityDecision,
  ProviderModelEligibilityRequirements,
} from "@kilnai/core";
import { deriveProviderModelEligibility } from "@kilnai/core";
import { defineDeliberationLevelId } from "@kilnai/core";
import type { GuiModelDeliberationCapabilities } from "@kilnai/gateway-contracts";
import {
  discoverCodexCliModelDiscovery,
  discoverClaudeCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
  normalizeRuntimeProviderDiscoveryCatalog,
} from "@kilnai/runtime";

export interface ManagedAgentProviderModelCatalogDiagnostic {
  readonly catalogDiagnosticEvidence: ProviderModelEvidence;
  readonly catalogDiagnosticDecision: ProviderModelEligibilityDecision;
  /** Adapter-enforced profiles discovered with the provider/model catalog. */
  readonly provenProfiles: readonly ManagedAgentAdmissionProfile[];
  /** Exact model-scoped deliberation evidence returned by Runtime discovery. */
  readonly deliberationCapabilities?: ModelDeliberationCapabilities;
}

export type ManagedAgentProviderModelCatalogDiagnostics = Readonly<
  Record<string, Readonly<Record<string, ManagedAgentProviderModelCatalogDiagnostic>> | undefined>
>;

export const PENDING_MANAGED_AGENT_PROVIDER_MODEL_CATALOG_DIAGNOSTICS: ManagedAgentProviderModelCatalogDiagnostics = {};

const MANAGED_DIRECT_PROVIDER_DISCOVERY_AVAILABILITY: Readonly<Record<string, boolean>> = {
  anthropic: true,
  "codex-oauth": true,
  deepseek: true,
  lmstudio: true,
  ollama: true,
  openai: true,
  "opencode-go": true,
  "opencode-zen": true,
  openrouter: true,
};

export async function discoverManagedAgentProviderModels(): Promise<ManagedAgentProviderModelCatalogDiagnostics> {
  const [claude, codex, opencode, directProviders] = await Promise.all([
    discoverClaudeCliModelDiscovery(),
    discoverCodexCliModelDiscovery(),
    discoverOpencodeCliModelDiscovery(),
    discoverGuiDirectProviderModelDiscovery(MANAGED_DIRECT_PROVIDER_DISCOVERY_AVAILABILITY),
  ]);
  const observedAt = new Date().toISOString();
  return Object.fromEntries([
    ["claude", catalogDiagnostics("claude", "claude-harness", claude, observedAt, "claude", "claude")],
    ["codex", catalogDiagnostics("codex", "codex-harness", codex, observedAt, "codex", "codex")],
    ["opencode", catalogDiagnostics("opencode", "opencode-harness", opencode, observedAt, "opencode", "opencode")],
    ...Object.entries(directProviders).map(([provider, discovery]) => [
      provider,
      catalogDiagnostics(provider, providerAdapterFamily(provider), discovery, observedAt),
    ] as const),
  ]);
}

function catalogDiagnostics(
  providerId: string,
  family: Parameters<typeof normalizeRuntimeProviderDiscoveryCatalog>[0]["family"],
  discovery: Parameters<typeof normalizeRuntimeProviderDiscoveryCatalog>[0]["discovery"] & {
    readonly modelCapabilities?: Readonly<Record<string, { readonly deliberation?: GuiModelDeliberationCapabilities }>>;
  },
  observedAt: string,
  harnessId?: string,
  reportedProviderId?: string,
): Readonly<Record<string, ManagedAgentProviderModelCatalogDiagnostic>> {
  const catalog = normalizeRuntimeProviderDiscoveryCatalog({
    providerId,
    family,
    observedAt,
    freshness: "fresh",
    discovery,
    ...(harnessId && reportedProviderId ? { harnessId, reportedProviderId } : {}),
  });
  return Object.fromEntries(catalog.routes.map((route) => {
    const model = route.identity.route.providerModelId;
    const deliberationCapabilities = discoveredDeliberationCapabilities(
      providerId,
      model,
      discovery.modelCapabilities?.[model]?.deliberation,
    );
    return [
      model,
      {
      catalogDiagnosticEvidence: route,
      catalogDiagnosticDecision: deriveProviderModelEligibility(route, managedAgentCatalogRequirements(observedAt), []),
      provenProfiles: providerId === "codex"
        ? ["foundation-readonly-plan", "foundation-propose-writes", "foundation-apply-approved-writes", "foundation-memory-write-proposals"]
        : ["foundation-readonly-plan"],
        ...(deliberationCapabilities ? { deliberationCapabilities } : {}),
      },
    ];
  }));
}

function discoveredDeliberationCapabilities(
  providerId: string,
  model: string,
  discovery: GuiModelDeliberationCapabilities | undefined,
): ModelDeliberationCapabilities | undefined {
  if (!discovery || discovery.provider !== providerId || discovery.model !== model) return undefined;
  return {
    provider: discovery.provider,
    model: discovery.model,
    levels: discovery.levels.map((level) => ({
      id: defineDeliberationLevelId(level.id),
      ...(level.nativeId ? { nativeId: level.nativeId } : {}),
    })),
    ...(discovery.defaultLevel ? { defaultLevel: defineDeliberationLevelId(discovery.defaultLevel) } : {}),
    supportsAdaptive: discovery.supportsAdaptive,
    evidence: discovery.evidence,
  };
}

function managedAgentCatalogRequirements(observedAt: string): ProviderModelEligibilityRequirements {
  return {
    use: "managed-agent",
    evaluatedAt: observedAt,
    requiredStates: [
      "discovered",
      "configured",
      "authenticated",
      "capabilityCompatible",
      "policyAdmitted",
      "routeHealthy",
    ],
    requiredCapabilities: [],
    minimumCapabilityAuthority: "harness-reported",
    minimumStateAuthority: "harness-reported",
    requireProbe: false,
  };
}

function providerAdapterFamily(
  providerId: string,
): Parameters<typeof normalizeRuntimeProviderDiscoveryCatalog>[0]["family"] {
  if (providerId === "openrouter") return "openrouter";
  if (providerId === "ollama" || providerId === "lmstudio") return "local-provider";
  if (providerId === "opencode-go" || providerId === "opencode-zen") return "opencode-service";
  return "direct-provider";
}
