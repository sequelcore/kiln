import {
  GUI_PROVIDER_DISPLAY_ORDER,
  type GuiProviderAccess,
  type GuiProviderModelDiscoveryProjection,
  getGuiProviderMetadata,
  isGuiProviderModeless,
} from "@kilnai/gateway-contracts";
import type { ProviderDescriptor } from "../lib/session-store/index.js";

export type ProviderRouteAccessFilter = GuiProviderAccess | "all";

export interface ProviderRouteProvider {
  readonly id: string;
  readonly label: string;
  readonly brandId: string;
  readonly access: GuiProviderAccess;
  readonly free: boolean;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly diagnosticModelCount: number;
  readonly reason?: string;
  readonly authState?: string;
  readonly authMethod?: "device_code" | "api_key";
  readonly authTier?: "go" | "zen";
}

export interface ProviderBrandOption {
  readonly id: string;
  readonly label: string;
}

export interface ProviderRouteOption {
  readonly key: string;
  readonly provider: ProviderRouteProvider;
  readonly modelId: string | null;
  readonly searchText: string;
}

export const PROVIDER_ROUTE_ACCESS_ORDER: readonly GuiProviderAccess[] = ["subscription", "harness", "api", "local"];

export const PROVIDER_ROUTE_ACCESS_LABEL: Readonly<Record<GuiProviderAccess, string>> = {
  subscription: "Subscription",
  harness: "Harness",
  api: "API",
  local: "Local",
};

function providerDisplayIndex(providerId: string): number {
  const index = GUI_PROVIDER_DISPLAY_ORDER.indexOf(providerId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

export function providerRouteKey(providerId: string, modelId: string | null): string {
  return `${encodeURIComponent(providerId)}::${modelId ? encodeURIComponent(modelId) : ""}`;
}

export function normalizeProviderRoutes(
  providers: readonly ProviderDescriptor[],
  providerModelDiscovery: GuiProviderModelDiscoveryProjection | null,
): {
  readonly providers: readonly ProviderRouteProvider[];
  readonly brands: readonly ProviderBrandOption[];
  readonly routes: readonly ProviderRouteOption[];
} {
  const routeEntries = providerModelDiscovery?.entries ?? [];
  const normalizedProviders: ProviderRouteProvider[] = [];
  const routes: ProviderRouteOption[] = [];

  for (const descriptor of providers) {
    const metadata = getGuiProviderMetadata(descriptor.id);
    if (!metadata) continue;

    const eligibleModels = new Set<string>();
    const searchEvidenceByModel = new Map<string, string[]>();
    let diagnosticModelCount = 0;
    let firstIneligibleReason: string | undefined;

    for (const entry of routeEntries) {
      if (entry.providerRoute.providerId !== descriptor.id) continue;
      diagnosticModelCount += 1;
      if (entry.eligibility.eligible) {
        const modelId = entry.providerRoute.providerModelId.trim();
        if (!modelId) continue;
        eligibleModels.add(modelId);
        searchEvidenceByModel.set(
          modelId,
          [
            entry.normalizedModel?.family,
            entry.normalizedModel?.version,
            entry.harnessRoute?.harnessId,
            entry.harnessRoute?.reportedProviderId,
            entry.harnessRoute?.reportedModelId,
            entry.rawEvidence?.rawId,
          ].filter((value): value is string => Boolean(value)),
        );
      } else if (!firstIneligibleReason && entry.eligibility.reasonCodes.length > 0) {
        firstIneligibleReason = entry.eligibility.reasonCodes.join(", ");
      }
    }

    const models: string[] = [];
    const seenModels = new Set<string>();
    for (const rawModel of providerModelDiscovery ? eligibleModels : descriptor.models) {
      const model = rawModel.trim();
      if (!model || seenModels.has(model)) continue;
      seenModels.add(model);
      models.push(model);
    }
    const available = isGuiProviderModeless(descriptor.id) ? descriptor.available : models.length > 0;
    const provider: ProviderRouteProvider = {
      id: descriptor.id,
      label: metadata.label,
      brandId: metadata.brandId,
      access: metadata.access,
      free: metadata.free,
      available,
      models,
      diagnosticModelCount,
      reason: firstIneligibleReason ?? descriptor.reason,
      authState: descriptor.authState,
      authMethod: metadata.authMethod,
      authTier: metadata.authTier,
    };
    normalizedProviders.push(provider);

    const routeModels = models.length > 0 ? models : [null];
    for (const modelId of routeModels) {
      routes.push({
        key: providerRouteKey(provider.id, modelId),
        provider,
        modelId,
        searchText: [
          provider.label,
          provider.id,
          PROVIDER_ROUTE_ACCESS_LABEL[provider.access],
          modelId,
          ...(modelId ? (searchEvidenceByModel.get(modelId) ?? []) : []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    }
  }

  normalizedProviders.sort((left, right) => providerDisplayIndex(left.id) - providerDisplayIndex(right.id));
  routes.sort((left, right) => {
    const providerOrder = providerDisplayIndex(left.provider.id) - providerDisplayIndex(right.provider.id);
    if (providerOrder !== 0) return providerOrder;
    return (left.modelId ?? "").localeCompare(right.modelId ?? "");
  });
  const brands = [...new Set(normalizedProviders.map((provider) => provider.brandId))].map((brandId) => {
    const brandProvider =
      normalizedProviders.find((provider) => provider.id === brandId) ??
      normalizedProviders.find((provider) => provider.brandId === brandId);
    return { id: brandId, label: brandProvider?.label ?? brandId };
  });
  return { providers: normalizedProviders, brands, routes };
}

export function filterProviderRoutes(
  routes: readonly ProviderRouteOption[],
  filters: {
    readonly query: string;
    readonly brandId: string | null;
    readonly access: ProviderRouteAccessFilter;
  },
): readonly ProviderRouteOption[] {
  const terms = filters.query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return routes.filter(
    (route) =>
      (filters.brandId === null || route.provider.brandId === filters.brandId) &&
      (filters.access === "all" || route.provider.access === filters.access) &&
      terms.every((term) => route.searchText.includes(term)),
  );
}

export function conciseProviderUnavailableReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) return "";
  if (/auth|api[_ -]?key|credential/i.test(normalized)) return "Auth is missing.";
  if (/daemon.*not reachable|not reachable|connection|ECONNREFUSED/i.test(normalized)) {
    return "Local service is unreachable.";
  }
  if (/empty model list|no installed models|no models/i.test(normalized)) return "No models found.";
  if (/endpoint.*failed|request failed/i.test(normalized)) return "Model endpoint failed.";
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}…` : normalized;
}
