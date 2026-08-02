import type { KilnGlobalConfig } from "./global-config.js";
import { resolveGlobalDefaultModel, resolveGlobalDefaultProvider } from "./global-config.js";
import { resolveEnvModel, resolveEnvProvider } from "./env-config.js";
import type { ProviderId } from "../wrapper/session-registry.js";
import type { ModelTaskSuitabilityLevel, ModelTaskSuitabilityTask } from "@kilnai/core";
import { resolveConfiguredModelTaskSuitability } from "./model-task-suitability.js";
import type { DirectProviderAccountBinding } from "../wrapper/direct-provider-adapter-factory.js";

export interface ProviderRouteCandidate {
  readonly provider: ProviderId;
  readonly model?: string;
  readonly accountBinding?: DirectProviderAccountBinding;
}

export interface ResolveProviderRouteCandidatesInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly flagProvider?: string;
  readonly flagModel?: string;
  readonly taskText?: string;
  readonly agentTaskAffinity?: readonly ModelTaskSuitabilityTask[];
}

export function resolveProviderRouteCandidates(
  input: ResolveProviderRouteCandidatesInput,
): readonly ProviderRouteCandidate[] {
  const explicitProvider = normalizeProvider(input.flagProvider) ?? normalizeProvider(resolveEnvProvider());
  const explicitModel = normalizeModel(input.flagModel) ?? normalizeModel(resolveEnvModel());
  if (explicitProvider) {
    const model = resolveCandidateModel(input.globalConfig, explicitProvider, explicitModel, {
      useConfiguredRouteFallback: true,
    });
    return [materializeProviderRouteCandidate(input.globalConfig, explicitProvider, model)];
  }

  if (explicitModel) {
    const virtualModel = input.globalConfig?.modelGateway?.virtualModels.find(
      (candidate) => candidate.id === explicitModel,
    );
    if (virtualModel) {
      return [materializeProviderRouteCandidate(
        input.globalConfig,
        virtualModel.providerId as ProviderId,
        explicitModel,
      )];
    }
  }

  const configuredRoutes = input.globalConfig?.routing?.routes
    ?.map((route): ProviderRouteCandidate | undefined => {
      const provider = normalizeProvider(route.provider);
      if (!provider) return undefined;
      const model = resolveCandidateModel(input.globalConfig, provider, route.model);
      return materializeProviderRouteCandidate(input.globalConfig, provider, model);
    })
    .filter((candidate): candidate is ProviderRouteCandidate => candidate !== undefined);
  if (configuredRoutes && configuredRoutes.length > 0) {
    return orderCandidatesForTask(
      dedupeCandidates(configuredRoutes),
      inferRouteTask({
        text: input.taskText,
        agentTaskAffinity: input.agentTaskAffinity,
      }),
      input.globalConfig,
    );
  }

  const defaultProvider = normalizeProvider(resolveGlobalDefaultProvider(input.globalConfig));
  if (!defaultProvider) {
    return [];
  }
  const candidates: ProviderRouteCandidate[] = [materializeProviderRouteCandidate(
    input.globalConfig,
    defaultProvider,
    resolveGlobalDefaultModel(input.globalConfig),
  )];
  const fallback = normalizeProvider(input.globalConfig?.routing?.fallback);
  if (fallback && fallback !== defaultProvider) {
    const model = resolveCandidateModel(input.globalConfig, fallback);
    candidates.push(materializeProviderRouteCandidate(input.globalConfig, fallback, model));
  }
  return candidates;
}

function materializeProviderRouteCandidate(
  globalConfig: KilnGlobalConfig | null | undefined,
  provider: ProviderId,
  selectedModel: string | undefined,
): ProviderRouteCandidate {
  const model = normalizeModel(selectedModel);
  const virtualModel = model
    ? globalConfig?.modelGateway?.virtualModels.find((candidate) => candidate.id === model)
    : undefined;
  if (!virtualModel) {
    return { provider, ...(model ? { model } : {}) };
  }
  if (virtualModel.providerId !== provider) {
    throw new Error(
      `Virtual model '${virtualModel.id}' is bound to provider '${virtualModel.providerId}', not '${provider}'.`,
    );
  }
  if (virtualModel.accountIds.length !== 1) {
    throw new Error(`Virtual model '${virtualModel.id}' must bind exactly one account for direct CLI execution.`);
  }
  const accountId = virtualModel.accountIds[0]!;
  const account = globalConfig?.modelGateway?.accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    throw new Error(`Virtual model '${virtualModel.id}' references unknown account '${accountId}'.`);
  }
  if (account.providerId !== provider) {
    throw new Error(
      `Virtual model '${virtualModel.id}' account '${accountId}' is bound to provider '${account.providerId}', not '${provider}'.`,
    );
  }
  return {
    provider,
    model: virtualModel.providerModelId,
    accountBinding: {
      virtualModelId: virtualModel.id,
      accountId,
      credentialId: account.credentialId,
    },
  };
}

export function inferRouteTask(input: {
  readonly text?: string;
  readonly agentTaskAffinity?: readonly ModelTaskSuitabilityTask[];
}): ModelTaskSuitabilityTask | undefined {
  const agentTask = input.agentTaskAffinity?.find((task) => task.trim().length > 0);
  if (agentTask) {
    return agentTask;
  }

  const text = input.text?.toLowerCase() ?? "";
  if (text.trim().length === 0) {
    return undefined;
  }

  if (hasAny(text, [
    "frontend",
    "ui",
    "ux",
    "react",
    "component",
    "css",
    "tailwind",
    "layout",
    "responsive",
    "design",
    "browser",
  ])) {
    return "frontend-design";
  }
  if (hasAny(text, [
    "test",
    "tests",
    "tdd",
    "vitest",
    "junit",
    "coverage",
    "regression",
  ])) {
    return "test-writing";
  }
  if (hasAny(text, [
    "research",
    "latest",
    "source",
    "citation",
    "benchmark",
    "compare",
    "analysis",
  ])) {
    return "research";
  }
  if (hasAny(text, [
    "architecture",
    "architectural",
    "ddd",
    "clean architecture",
    "boundary",
    "bounded context",
    "adr",
    "review",
  ])) {
    return "architecture-review";
  }
  if (hasAny(text, [
    "rename",
    "format",
    "mechanical",
    "boilerplate",
    "projection",
    "sync",
    "bulk",
  ])) {
    return "mechanical-edit";
  }
  if (hasAny(text, [
    "backend",
    "api",
    "database",
    "postgres",
    "spring",
    "service",
    "repository",
    "endpoint",
    "runtime",
    "provider",
  ])) {
    return "backend-coding";
  }

  return undefined;
}

function orderCandidatesForTask(
  candidates: readonly ProviderRouteCandidate[],
  task: ModelTaskSuitabilityTask | undefined,
  globalConfig: KilnGlobalConfig | null | undefined,
): readonly ProviderRouteCandidate[] {
  if (!task) {
    return candidates;
  }

  return [...candidates]
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreCandidateForTask(candidate, task, globalConfig),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.candidate);
}

function scoreCandidateForTask(
  candidate: ProviderRouteCandidate,
  task: ModelTaskSuitabilityTask,
  globalConfig: KilnGlobalConfig | null | undefined,
): number {
  if (!candidate.model) {
    return 10;
  }
  const suitability = resolveConfiguredModelTaskSuitability({
    provider: candidate.provider,
    model: candidate.model,
    overrides: globalConfig?.modelTaskSuitability,
  }).find((entry) => entry.task === task);
  if (!suitability) {
    return 10;
  }
  return taskSuitabilityScore(suitability.level) + taskSuitabilitySourceBonus(suitability.source);
}

function taskSuitabilityScore(level: ModelTaskSuitabilityLevel): number {
  switch (level) {
    case "preferred":
      return 30;
    case "capable":
      return 20;
    case "limited":
      return 0;
  }
}

function taskSuitabilitySourceBonus(source: string): number {
  return source === "operator-override" ? 1 : 0;
}

function hasAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function resolveCandidateModel(
  globalConfig: KilnGlobalConfig | null | undefined,
  provider: ProviderId,
  explicitModel?: string,
  options: { readonly useConfiguredRouteFallback?: boolean } = {},
): string | undefined {
  return normalizeModel(explicitModel)
    ?? (options.useConfiguredRouteFallback ? normalizeModel(findConfiguredRouteModel(globalConfig, provider)) : undefined)
    ?? normalizeModel(globalConfig?.models?.[provider])
    ?? normalizeModel(globalConfig?.models?.default);
}

function findConfiguredRouteModel(
  globalConfig: KilnGlobalConfig | null | undefined,
  provider: ProviderId,
): string | undefined {
  return globalConfig?.routing?.routes
    ?.find((route) => normalizeProvider(route.provider) === provider)
    ?.model;
}

function dedupeCandidates(candidates: readonly ProviderRouteCandidate[]): readonly ProviderRouteCandidate[] {
  const seen = new Set<string>();
  const deduped: ProviderRouteCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.provider}\0${candidate.model ?? ""}\0${candidate.accountBinding?.credentialId ?? ""}`;
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
