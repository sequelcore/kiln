import type { KilnGlobalConfig } from "./global-config.js";
import { resolveGlobalDefaultModel, resolveGlobalDefaultProvider } from "./global-config.js";
import { resolveEnvModel, resolveEnvProvider } from "./env-config.js";
import type { ProviderId } from "../wrapper/session-registry.js";

export interface ProviderRouteCandidate {
  readonly provider: ProviderId;
  readonly model?: string;
}

export interface ResolveProviderRouteCandidatesInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly flagProvider?: string;
  readonly flagModel?: string;
}

export function resolveProviderRouteCandidates(
  input: ResolveProviderRouteCandidatesInput,
): readonly ProviderRouteCandidate[] {
  const explicitProvider = normalizeProvider(input.flagProvider) ?? normalizeProvider(resolveEnvProvider());
  const explicitModel = normalizeModel(input.flagModel) ?? normalizeModel(resolveEnvModel());
  if (explicitProvider) {
    return [{
      provider: explicitProvider,
      ...(resolveCandidateModel(input.globalConfig, explicitProvider, explicitModel) ? {
        model: resolveCandidateModel(input.globalConfig, explicitProvider, explicitModel),
      } : {}),
    }];
  }

  const configuredRoutes = input.globalConfig?.routing?.routes
    ?.map((route): ProviderRouteCandidate | undefined => {
      const provider = normalizeProvider(route.provider);
      if (!provider) return undefined;
      const model = resolveCandidateModel(input.globalConfig, provider, route.model);
      return {
        provider,
        ...(model ? { model } : {}),
      };
    })
    .filter((candidate): candidate is ProviderRouteCandidate => candidate !== undefined);
  if (configuredRoutes && configuredRoutes.length > 0) {
    return dedupeCandidates(configuredRoutes);
  }

  const defaultProvider = normalizeProvider(resolveGlobalDefaultProvider(input.globalConfig));
  if (!defaultProvider) {
    return [];
  }
  const candidates: ProviderRouteCandidate[] = [{
    provider: defaultProvider,
    ...(resolveGlobalDefaultModel(input.globalConfig) ? { model: resolveGlobalDefaultModel(input.globalConfig) } : {}),
  }];
  const fallback = normalizeProvider(input.globalConfig?.routing?.fallback);
  if (fallback && fallback !== defaultProvider) {
    const model = resolveCandidateModel(input.globalConfig, fallback);
    candidates.push({
      provider: fallback,
      ...(model ? { model } : {}),
    });
  }
  return candidates;
}

function resolveCandidateModel(
  globalConfig: KilnGlobalConfig | null | undefined,
  provider: ProviderId,
  explicitModel?: string,
): string | undefined {
  return normalizeModel(explicitModel)
    ?? normalizeModel(globalConfig?.models?.[provider])
    ?? normalizeModel(globalConfig?.models?.default);
}

function dedupeCandidates(candidates: readonly ProviderRouteCandidate[]): readonly ProviderRouteCandidate[] {
  const seen = new Set<string>();
  const deduped: ProviderRouteCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.provider}\0${candidate.model ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function normalizeProvider(value: string | undefined): ProviderId | undefined {
  const normalized = value?.trim();
  return normalized ? normalized as ProviderId : undefined;
}

function normalizeModel(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
