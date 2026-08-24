import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  OPENCODE_BASE_URL,
  createProviderModelEvidence,
  deriveProviderModelEligibility,
  formatProviderModelRouteCooldown,
  type ProviderModelEvidence,
  type ProviderModelEvidenceValue,
} from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  OpenCodeCredentialPoolService,
} from "../agents/credential-pool/index.js";
import { ProviderModelRouteHealthStore } from "../agents/provider-route-health/index.js";
import {
  GUI_PROVIDER_DISPLAY_ORDER,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  type GuiProviderAuthState,
  type GuiProviderDescriptor,
  type GuiProviderDiscoveryResult,
  type GuiProviderDiscoveryStatus,
  type GuiProviderModelCapabilities,
  type GuiProviderModelDiscoveryProjection,
  type GuiProviderModelEligibility,
  type GuiProviderModelRouteEntry,
  type GuiProviderModelRouteHealth,
  type GuiDeliberationLevelId,
} from "@kilnai/gateway-contracts";
import { normalizeRuntimeProviderDiscoveryCatalog } from "./provider-model-adapters/runtime-discovery-catalogs.js";

export interface GuiCliOperatorModelDiscovery {
  readonly claudeModels: string[];
  readonly claudeDiscovery: GuiCliProviderModelDiscovery;
  readonly opencodeModels: string[];
  readonly opencodeDiscovery: GuiCliProviderModelDiscovery;
  readonly codexModels: string[];
  readonly codexDiscovery: GuiCliProviderModelDiscovery;
}

export interface GuiCliProviderModelDiscovery {
  readonly models: string[];
  readonly modelCapabilities?: Readonly<Record<string, GuiProviderModelCapabilities>>;
  readonly modelRouteHealth?: Readonly<Record<string, GuiProviderModelRouteHealth>>;
  readonly status: GuiProviderDiscoveryStatus;
  readonly reason: string;
  readonly authState: GuiProviderAuthState;
}

type OpenCodeDirectProviderId = "opencode-go" | "opencode-zen";
type OpenCodeDirectTier = "go" | "zen";

interface OpenCodeDirectProviderDiscoveryTarget {
  readonly provider: OpenCodeDirectProviderId;
  readonly tier: OpenCodeDirectTier;
  readonly label: string;
  readonly modelsUrl: string;
}

type OpenCodeDirectCredentialResolution =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: string };

const OPENCODE_GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
const OPENCODE_ZEN_MODELS_URL = `${OPENCODE_BASE_URL}/models`;
const CODEX_OAUTH_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const CODEX_OAUTH_MODEL_DISCOVERY_TIMEOUT_MS = 5_000;
const CODEX_OAUTH_MODEL_DISCOVERY_CACHE_TTL_MS = 30_000;
const CODEX_OAUTH_MODELS_CLIENT_VERSION =
  process.env.KILN_CODEX_OAUTH_CLIENT_VERSION?.trim() || "2.0.0";
const CODEX_OAUTH_MODEL_DISCOVERY_DEBUG =
  /^(1|true|yes)$/i.test(process.env.KILN_PROVIDER_AUTH_DEBUG?.trim() ?? "");

let codexOauthModelDiscoveryCache:
  | {
      readonly token: string;
      readonly expiresAt: number;
      readonly result: GuiCliProviderModelDiscovery;
    }
  | undefined;
let codexOauthModelDiscoveryInflight:
  | {
      readonly token: string;
      readonly promise: Promise<GuiCliProviderModelDiscovery>;
    }
  | undefined;

export async function discoverGuiCliOperatorModels(
  providerAvailability?: Readonly<Record<string, boolean>>,
): Promise<GuiCliOperatorModelDiscovery> {
  const discoverOpencode = providerAvailability === undefined || providerAvailability.opencode === true;
  const discoverCodex = providerAvailability === undefined || providerAvailability.codex === true;
  const discoverClaude = providerAvailability === undefined || providerAvailability.claude === true;
  const [claudeDiscovery, opencodeDiscovery, codexDiscovery] = await Promise.all([
    discoverClaude
      ? discoverClaudeCliModelDiscovery()
      : Promise.resolve(unavailableCliProviderDiscovery(
          "cli_missing",
          "Claude Code CLI is unavailable in this runtime.",
          "not_required",
        )),
    discoverOpencode
      ? discoverOpencodeCliModelDiscovery()
      : Promise.resolve(unavailableCliProviderDiscovery(
          "cli_missing",
          "OpenCode CLI is unavailable in this runtime.",
          "not_required",
        )),
    discoverCodex
      ? discoverCodexCliModelDiscovery()
      : Promise.resolve(unavailableCliProviderDiscovery(
          "cli_missing",
          "Codex CLI is unavailable in this runtime.",
          "not_required",
        )),
  ]);
  return {
    claudeModels: claudeDiscovery.models,
    claudeDiscovery,
    opencodeModels: opencodeDiscovery.models,
    opencodeDiscovery,
    codexModels: codexDiscovery.models,
    codexDiscovery,
  };
}

export async function resolveGuiOperatorDiscoveryResults(
  providerAvailability: Readonly<Record<string, boolean>>,
  routeHealthStore?: ProviderModelRouteHealthStore,
  kilnHome?: string,
): Promise<GuiProviderDiscoveryResult[]> {
  const resolvedRouteHealthStore = routeHealthStore ?? new ProviderModelRouteHealthStore({ kilnHome });
  const [cliModels, directProviderDiscovery] = await Promise.all([
    discoverGuiCliOperatorModels(providerAvailability),
    discoverGuiDirectProviderModelDiscovery(providerAvailability, process.env, resolvedRouteHealthStore, kilnHome),
  ]);
  return buildGuiOperatorDiscoveryResults({
    claudeModels: cliModels.claudeModels,
    claudeDiscovery: cliModels.claudeDiscovery,
    opencodeModels: cliModels.opencodeModels,
    opencodeDiscovery: cliModels.opencodeDiscovery,
    codexModels: cliModels.codexModels,
    codexDiscovery: cliModels.codexDiscovery,
    providerAvailability,
    directProviderDiscovery,
  });
}

export function buildGuiOperatorDiscoveryResults(input: {
  readonly claudeModels?: readonly string[];
  readonly claudeDiscovery?: GuiCliProviderModelDiscovery;
  readonly opencodeModels: readonly string[];
  readonly opencodeDiscovery?: GuiCliProviderModelDiscovery;
  readonly codexModels: readonly string[];
  readonly codexDiscovery?: GuiCliProviderModelDiscovery;
  readonly providerAvailability?: Readonly<Record<string, boolean>>;
  readonly directProviderDiscovery?: Readonly<Record<string, GuiCliProviderModelDiscovery>>;
  readonly lastCheckedAt?: string;
}): GuiProviderDiscoveryResult[] {
  const discoveredModelsByProvider: Record<string, readonly string[]> = {
    ...(input.claudeModels && input.claudeModels.length > 0 ? { claude: input.claudeModels } : {}),
    ...(input.codexModels.length > 0 ? { codex: input.codexModels } : {}),
    ...(input.opencodeModels.length > 0 ? { opencode: input.opencodeModels } : {}),
  };
  const lastCheckedAt = input.lastCheckedAt ?? new Date().toISOString();

  const results: GuiProviderDiscoveryResult[] = [];
  for (const provider of GUI_PROVIDER_DISPLAY_ORDER) {
    const meta = getGuiProviderMetadata(provider);
    if (!meta) {
      continue;
    }
    const rawModels = discoveredModelsByProvider[provider] ?? [];
    const models = normalizeModelIds(rawModels);
    const availability = input.providerAvailability?.[provider];

    const cliDiscovery = provider === "claude"
      ? input.claudeDiscovery
      : provider === "codex"
        ? input.codexDiscovery
        : provider === "opencode"
          ? input.opencodeDiscovery
          : undefined;
    if (cliDiscovery) {
      const cliModels = normalizeModelIds(cliDiscovery.models);
      const available = cliDiscovery.status === "available" && cliModels.length > 0;
      const status = available ? "available" : cliDiscovery.status;
      const modelCapabilities = available
        ? filterModelCapabilities(cliDiscovery.modelCapabilities, cliModels)
        : undefined;
      const modelRouteHealth = available
        ? filterModelRouteHealth(cliDiscovery.modelRouteHealth, cliModels)
        : undefined;
      results.push({
        provider,
        available,
        models: available ? cliModels : [],
        ...(modelCapabilities ? { modelCapabilities } : {}),
        ...(modelRouteHealth ? { modelRouteHealth } : {}),
        status,
        reason: cliDiscovery.reason,
        authState: cliDiscovery.authState,
        lastCheckedAt,
      });
      continue;
    }

    const directDiscovery = input.directProviderDiscovery?.[provider];
    if (directDiscovery) {
      const discoveredModels = normalizeModelIds(directDiscovery.models);
      const available = (
        directDiscovery.status === "available"
        && discoveredModels.length > 0
        && availability !== false
      );
      const status = available ? "available" : directDiscovery.status;
      const modelCapabilities = available
        ? filterModelCapabilities(directDiscovery.modelCapabilities, discoveredModels)
        : undefined;
      const modelRouteHealth = available
        ? filterModelRouteHealth(directDiscovery.modelRouteHealth, discoveredModels)
        : undefined;
      results.push({
        provider,
        available,
        models: available ? discoveredModels : [],
        ...(modelCapabilities ? { modelCapabilities } : {}),
        ...(modelRouteHealth ? { modelRouteHealth } : {}),
        status,
        reason: directDiscovery.reason,
        authState: directDiscovery.authState,
        lastCheckedAt,
      });
      continue;
    }

    if (isGuiProviderModeless(provider)) {
      if (availability === true) {
        results.push({
          provider,
          available: true,
          models: [],
          status: "model_selection_not_required",
          reason: `${meta.label} CLI is available. Model selection is not required.`,
          authState: "not_required",
          lastCheckedAt,
        });
        continue;
      }
      const status = defaultUnavailableStatus(meta.group);
      results.push({
        provider,
        available: false,
        models: [],
        status,
        reason: defaultUnavailableReason(meta.label, status),
        authState: defaultAuthState(status),
        lastCheckedAt,
      });
      continue;
    }

    if (models.length > 0 && availability !== false) {
      results.push({
        provider,
        available: true,
        models,
        status: "available",
        reason: `${meta.label} models discovered.`,
        authState: "authenticated",
        lastCheckedAt,
      });
      continue;
    }

    const status = availability === true
      ? "empty_model_list"
      : defaultUnavailableStatus(meta.group);
    results.push({
      provider,
      available: false,
      models: [],
      status,
      reason: defaultUnavailableReason(meta.label, status),
      authState: defaultAuthState(status),
      lastCheckedAt,
    });
  }
  return results;
}

export function projectGuiOperatorModels(
  discovery: readonly GuiProviderDiscoveryResult[],
): Record<string, string[]> {
  return Object.fromEntries(
    discovery.flatMap((entry) => (
      entry.available
        ? [[entry.provider, [...entry.models]]]
        : []
    )),
  );
}

export function projectGuiProviderModelDiscovery(
  discovery: readonly GuiProviderDiscoveryResult[],
  options: { readonly observedAt?: string } = {},
): GuiProviderModelDiscoveryProjection {
  const observedAt = options.observedAt ?? latestProviderObservation(discovery) ?? new Date().toISOString();
  const catalogs = discovery.map((entry) => normalizeRuntimeProviderDiscoveryCatalog({
    providerId: entry.provider,
    family: runtimeAdapterFamily(entry.provider),
    discovery: {
      models: entry.models,
      status: entry.status,
      reason: entry.reason,
      authState: entry.authState,
    },
    observedAt: entry.lastCheckedAt || observedAt,
    freshness: entry.status === "stale" ? "stale" : "fresh",
    ...(isHarnessProvider(entry.provider)
      ? {
          harnessId: entry.provider,
          reportedProviderId: entry.provider,
        }
      : {}),
  }));
  const entries = catalogs.flatMap((catalog) => catalog.routes.map((catalogRoute) => {
    const route = enrichRouteHealthEvidence(catalogRoute, discovery, observedAt);
    const sourceEntry = discovery.find((item) => item.provider === route.identity.route.providerId);
    const rawEvidence = catalog.rawEntries.find((raw) =>
      raw.providerModelId === route.identity.route.providerModelId
      && raw.scope === route.identity.route.scope
    );
    const decision = deriveProviderModelEligibility(route, {
      use: "interactive",
      evaluatedAt: observedAt,
      requiredStates: [
        "discovered",
        "authenticated",
        "entitled",
        "policyAdmitted",
        "routeHealthy",
      ],
      requiredCapabilities: [],
      minimumCapabilityAuthority: "harness-reported",
      minimumStateAuthority: "harness-reported",
      requireProbe: false,
    }, []);
    return projectGuiProviderModelRouteEntry({
      route,
      rawId: rawEvidence?.rawId ?? route.identity.route.providerModelId,
      rawProvenance: rawEvidence?.provenance ?? catalog.source.id,
      observedAt: catalog.observedAt,
      expiresAt: route.observations.find((observation) => observation.expiresAt)?.expiresAt,
      discovery: sourceEntry,
      eligibility: {
        eligible: decision.eligible,
        reasonCodes: decision.reasons,
      },
    });
  }));
  const total = catalogs.reduce((sum, catalog) => sum + catalog.rawEntries.length, 0);
  const failure = catalogs.flatMap((catalog) => catalog.failures)[0];
  return {
    catalogEvidence: {
      status: classifyGuiProviderCatalogEvidence(catalogs),
      source: {
        kind: "runtime-provider-catalog",
        id: "gui-provider-model-discovery",
      },
      observedAt,
      counts: {
        total,
        returned: entries.length,
        omitted: Math.max(0, total - entries.length),
      },
      ...(failure
        ? {
            failure: {
              classification: failure.classification,
              summary: failure.summary,
            },
          }
        : {}),
    },
    entries,
  };
}

function latestProviderObservation(
  discovery: readonly GuiProviderDiscoveryResult[],
): string | undefined {
  let latest: { readonly value: string; readonly timestamp: number } | undefined;
  for (const entry of discovery) {
    const timestamp = Date.parse(entry.lastCheckedAt);
    if (Number.isFinite(timestamp) && (!latest || timestamp > latest.timestamp)) {
      latest = { value: entry.lastCheckedAt, timestamp };
    }
  }
  return latest?.value;
}

function enrichRouteHealthEvidence(
  route: ProviderModelEvidence,
  discovery: readonly GuiProviderDiscoveryResult[],
  observedAt: string,
): ProviderModelEvidence {
  const diagnostic = discovery.find((entry) =>
    entry.provider === route.identity.route.providerId
  )?.modelRouteHealth?.[route.identity.route.providerModelId];
  if (!diagnostic) return route;

  const source = {
    kind: "runtime-diagnostic" as const,
    id: `route-health:${route.identity.route.providerId}`,
  };
  const routeHealthValue = diagnostic.healthy ? "confirmed" : "denied";
  return createProviderModelEvidence({
    identity: route.identity,
    aliases: route.aliases,
    states: {
      ...route.states,
      routeHealthy: routeHealthValue,
    },
    observations: [
      ...route.observations,
      {
        state: "routeHealthy",
        value: routeHealthValue,
        provenance: source.id,
        authority: "runtime-observed",
        source,
        observedAt,
        freshness: "fresh",
      },
    ],
    failures: route.failures,
  });
}

export function markGuiProviderDiscoveryStale(
  discovery: readonly GuiProviderDiscoveryResult[],
): GuiProviderDiscoveryResult[] {
  return discovery.map((entry) => ({
    ...entry,
    available: false,
    status: "stale",
    authState: "unknown",
    reason: entry.status === "stale"
      ? entry.reason
      : `Cached provider discovery from ${entry.lastCheckedAt}; refresh is pending. ${entry.reason}`,
  }));
}

function projectGuiProviderModelRouteEntry(input: {
  readonly route: ProviderModelEvidence;
  readonly rawId: string;
  readonly rawProvenance: string;
  readonly observedAt: string;
  readonly expiresAt?: string;
  readonly discovery?: GuiProviderDiscoveryResult;
  readonly eligibility: GuiProviderModelEligibility;
}): GuiProviderModelRouteEntry {
  const routeHealth = input.discovery?.modelRouteHealth?.[input.route.identity.route.providerModelId];
  const routeHealthState = evidenceState(input.route, "routeHealthy");
  const policyState = evidenceState(input.route, "policyAdmitted");
  return {
    normalizedModel: input.route.identity.normalizedModel,
    providerRoute: input.route.identity.route,
    ...(input.route.identity.harness ? { harnessRoute: input.route.identity.harness } : {}),
    rawEvidence: {
      rawId: input.rawId,
      provenance: input.rawProvenance,
    },
    credentialEvidence: {
      state: credentialEvidenceState(evidenceState(input.route, "authenticated")),
      source: evidenceSourceId(input.route, "authenticated"),
    },
    entitlementEvidence: {
      state: entitlementEvidenceState(evidenceState(input.route, "entitled")),
      source: evidenceSourceId(input.route, "entitled"),
    },
    freshness: {
      status: freshnessStatus(input.route),
      observedAt: input.observedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    },
    routeHealth: {
      status: routeHealth?.healthy === false
        ? "unhealthy"
        : routeHealthState === "confirmed"
          ? "healthy"
          : routeHealthState === "denied"
            ? "unhealthy"
            : "unknown",
      ...(routeHealth?.reason ? { reason: routeHealth.reason } : {}),
    },
    policyAdmission: {
      use: "interactive",
      status: policyState === "confirmed"
        ? "admitted"
        : policyState === "denied"
          ? "denied"
          : "unknown",
    },
    eligibility: input.eligibility,
    ...(input.discovery?.modelCapabilities?.[input.route.identity.route.providerModelId]
      ? { modelCapabilities: input.discovery.modelCapabilities[input.route.identity.route.providerModelId] }
      : {}),
  };
}

function classifyGuiProviderCatalogEvidence(
  catalogs: readonly ReturnType<typeof normalizeRuntimeProviderDiscoveryCatalog>[],
): GuiProviderModelDiscoveryProjection["catalogEvidence"]["status"] {
  if (catalogs.length === 0) {
    return "failed";
  }
  if (catalogs.every((catalog) => catalog.classification === "available")) {
    return "complete";
  }
  if (catalogs.every((catalog) => catalog.rawEntries.length === 0 && catalog.failures.length > 0)) {
    return "failed";
  }
  return "partial";
}

function evidenceState(
  evidence: ProviderModelEvidence,
  state: keyof ProviderModelEvidence["states"],
): ProviderModelEvidenceValue {
  return evidence.states[state];
}

function credentialEvidenceState(
  state: ProviderModelEvidenceValue,
): GuiProviderModelRouteEntry["credentialEvidence"]["state"] {
  if (state === "confirmed") return "authenticated";
  if (state === "denied") return "missing";
  if (state === "not-required") return "not-required";
  return "unknown";
}

function entitlementEvidenceState(
  state: ProviderModelEvidenceValue,
): GuiProviderModelRouteEntry["entitlementEvidence"]["state"] {
  if (state === "confirmed") return "confirmed";
  if (state === "denied") return "denied";
  if (state === "not-required") return "not-required";
  return "unknown";
}

function freshnessStatus(
  evidence: ProviderModelEvidence,
): GuiProviderModelRouteEntry["freshness"]["status"] {
  const freshnessValues = evidence.observations.map((observation) => observation.freshness);
  if (freshnessValues.includes("stale") || freshnessValues.includes("expired")) {
    return "stale";
  }
  if (freshnessValues.length > 0 && freshnessValues.every((freshness) => freshness === "fresh")) {
    return "fresh";
  }
  return "unknown";
}

function evidenceSourceId(
  evidence: ProviderModelEvidence,
  state: keyof ProviderModelEvidence["states"],
): string {
  return evidence.observations.find((observation) => observation.state === state)?.source.id
    ?? evidence.aliases[0]?.source.id
    ?? evidence.identity.route.providerId;
}

function runtimeAdapterFamily(
  providerId: string,
): Parameters<typeof normalizeRuntimeProviderDiscoveryCatalog>[0]["family"] {
  if (providerId === "codex") return "codex-harness";
  if (providerId === "opencode") return "opencode-harness";
  if (providerId === "openrouter") return "openrouter";
  if (providerId === "ollama" || providerId === "lmstudio") return "local-provider";
  if (providerId === "opencode-go" || providerId === "opencode-zen") return "opencode-service";
  return "direct-provider";
}

function isHarnessProvider(providerId: string): boolean {
  return providerId === "codex" || providerId === "opencode";
}

function normalizeModelIds(models: readonly string[]): string[] {
  const result: string[] = [];
  for (const model of models) {
    const trimmed = model.trim();
    if (trimmed.length > 0 && !result.includes(trimmed)) {
      result.push(trimmed);
    }
  }
  return result;
}

function filterModelCapabilities(
  capabilities: Readonly<Record<string, GuiProviderModelCapabilities>> | undefined,
  models: readonly string[],
): Readonly<Record<string, GuiProviderModelCapabilities>> | undefined {
  if (!capabilities) return undefined;
  const filtered: Record<string, GuiProviderModelCapabilities> = {};
  for (const model of models) {
    const capability = capabilities[model];
    if (capability) {
      filtered[model] = capability;
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function filterModelRouteHealth(
  routeHealth: Readonly<Record<string, GuiProviderModelRouteHealth>> | undefined,
  models: readonly string[],
): Readonly<Record<string, GuiProviderModelRouteHealth>> | undefined {
  if (!routeHealth) return undefined;
  const filtered: Record<string, GuiProviderModelRouteHealth> = {};
  for (const model of models) {
    const health = routeHealth[model];
    if (health) {
      filtered[model] = health;
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function defaultUnavailableStatus(group: GuiProviderDescriptor["group"]): GuiProviderDiscoveryStatus {
  return group === "harness" ? "cli_missing" : "missing_auth";
}

function defaultAuthState(status: GuiProviderDiscoveryStatus): GuiProviderAuthState {
  if (status === "missing_auth") return "missing";
  if (status === "auth_expired") return "expired";
  if (status === "cli_missing" || status === "daemon_unreachable") return "not_required";
  return "unknown";
}

function defaultUnavailableReason(label: string, status: GuiProviderDiscoveryStatus): string {
  if (status === "empty_model_list") {
    return `No models were discovered for ${label}.`;
  }
  return `${label} is unavailable in this runtime.`;
}

export async function discoverGuiDirectProviderModelDiscovery(
  providerAvailability: Readonly<Record<string, boolean>>,
  env: Readonly<Record<string, string | undefined>> = process.env,
  routeHealthStore?: ProviderModelRouteHealthStore,
  kilnHome?: string,
): Promise<Record<string, GuiCliProviderModelDiscovery>> {
  const [
    openCodeDirectDiscovery,
    openAiDiscovery,
    anthropicDiscovery,
    deepSeekDiscovery,
    openRouterDiscovery,
    ollamaDiscovery,
    lmStudioDiscovery,
    codexOauthDiscovery,
  ] = await Promise.all([
    discoverOpenCodeDirectModelDiscovery(providerAvailability, env, kilnHome),
    discoverOpenAiModelDiscovery(providerAvailability.openai, env),
    discoverAnthropicModelDiscovery(providerAvailability.anthropic, env),
    discoverDeepSeekModelDiscovery(providerAvailability.deepseek, env),
    discoverOpenRouterModelDiscovery(providerAvailability.openrouter, env),
    discoverOllamaModelDiscovery(providerAvailability.ollama, env),
    discoverLmStudioModelDiscovery(providerAvailability.lmstudio, env),
    discoverCodexOauthModelDiscovery(providerAvailability["codex-oauth"], kilnHome),
  ]);
  const discoveries = Object.fromEntries([
    ...(codexOauthDiscovery ? [["codex-oauth", codexOauthDiscovery] as const] : []),
    ...(openAiDiscovery ? [["openai", openAiDiscovery] as const] : []),
    ...(anthropicDiscovery ? [["anthropic", anthropicDiscovery] as const] : []),
    ...(deepSeekDiscovery ? [["deepseek", deepSeekDiscovery] as const] : []),
    ...(openRouterDiscovery ? [["openrouter", openRouterDiscovery] as const] : []),
    ...(ollamaDiscovery ? [["ollama", ollamaDiscovery] as const] : []),
    ...(lmStudioDiscovery ? [["lmstudio", lmStudioDiscovery] as const] : []),
    ...Object.entries(openCodeDirectDiscovery),
  ]);
  return routeHealthStore
    ? await attachProviderModelRouteHealth(discoveries, routeHealthStore)
    : discoveries;
}

async function attachProviderModelRouteHealth(
  discoveries: Record<string, GuiCliProviderModelDiscovery>,
  routeHealthStore: ProviderModelRouteHealthStore,
): Promise<Record<string, GuiCliProviderModelDiscovery>> {
  const entries = await Promise.all(Object.entries(discoveries).map(async ([provider, discovery]) => {
    if (discovery.status !== "available" || discovery.models.length === 0) {
      return [provider, discovery] as const;
    }
    const routeHealthEntries = await Promise.all(discovery.models.map(async (model) => {
      const decision = await routeHealthStore.evaluateRouteHealth(provider, model);
      return [model, decision] as const;
    }));
    const modelRouteHealth = Object.fromEntries(routeHealthEntries.map(([model, decision]) => ([
      model,
      {
        healthy: decision.healthy,
        ...(!decision.healthy
          ? {
              reason: formatProviderModelRouteCooldown(decision),
              ...(decision.cooldownUntil ? { cooldownUntil: decision.cooldownUntil } : {}),
            }
          : {}),
      } satisfies GuiProviderModelRouteHealth,
    ] as const)));
    return [
      provider,
      Object.keys(modelRouteHealth).length > 0
        ? { ...discovery, modelRouteHealth }
        : discovery,
    ] as const;
  }));
  return Object.fromEntries(entries);
}

async function discoverCodexOauthModelDiscovery(
  available: boolean | undefined,
  kilnHome?: string,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const credentialPool = new CodexOAuthCredentialPoolService({ kilnHome });
  let tokenCandidates: readonly { readonly credentialId: string; readonly accessToken: string }[] = [];
  try {
    tokenCandidates = await credentialPool.listValidAccessTokenCandidates();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return unavailableCliProviderDiscovery(
      /expir/i.test(message) ? "auth_expired" : "missing_auth",
      /expir/i.test(message)
        ? "Codex OAuth authentication is expired."
        : "Codex OAuth authentication is missing.",
      /expir/i.test(message) ? "expired" : "missing",
    );
  }
  if (tokenCandidates.length === 0) {
    return unavailableCliProviderDiscovery(
      "missing_auth",
      "Codex OAuth authentication is missing.",
      "missing",
    );
  }
  let sawRejectedCredential = false;
  for (const candidate of tokenCandidates) {
    const result = await discoverCodexOauthModelsWithCache(candidate.accessToken);
    if (isCodexOauthRejectedCredential(result)) {
      sawRejectedCredential = true;
      await credentialPool.recordAuthenticationFailure(candidate.credentialId);
      codexOauthModelDebug("skipping rejected credential", {
        credentialId: candidate.credentialId,
        status: result.status,
        authState: result.authState,
      });
      continue;
    }
    return result;
  }
  return unavailableCliProviderDiscovery(
    "auth_expired",
    sawRejectedCredential
      ? "All Codex OAuth credentials were rejected by the model endpoint. Sign in again."
      : "Codex OAuth authentication is expired.",
    "expired",
  );
}

async function discoverCodexOauthModelsWithCache(token: string): Promise<GuiCliProviderModelDiscovery> {
  const cachedDiscovery = codexOauthModelDiscoveryCache;
  if (
    cachedDiscovery
    && cachedDiscovery.token === token
    && cachedDiscovery.expiresAt > Date.now()
  ) {
    return cachedDiscovery.result;
  }
  if (
    codexOauthModelDiscoveryInflight
    && codexOauthModelDiscoveryInflight.token === token
  ) {
    return await codexOauthModelDiscoveryInflight.promise;
  }
  const discovery = discoverCodexOauthModelsFromEndpoint(token);
  codexOauthModelDiscoveryInflight = { token, promise: discovery };
  try {
    const result = await discovery;
    if (result.status === "available" || result.status === "empty_model_list") {
      codexOauthModelDiscoveryCache = {
        token,
        expiresAt: Date.now() + CODEX_OAUTH_MODEL_DISCOVERY_CACHE_TTL_MS,
        result,
      };
    }
    return result;
  } finally {
    if (codexOauthModelDiscoveryInflight?.promise === discovery) {
      codexOauthModelDiscoveryInflight = undefined;
    }
  }
}

function isCodexOauthRejectedCredential(result: GuiCliProviderModelDiscovery): boolean {
  return result.status === "auth_expired" && result.authState === "expired";
}

async function discoverCodexOauthModelsFromEndpoint(token: string): Promise<GuiCliProviderModelDiscovery> {
  let data: { readonly data?: unknown; readonly models?: unknown } | undefined;
  const modelsUrl = new URL(CODEX_OAUTH_MODELS_URL);
  modelsUrl.searchParams.set("client_version", CODEX_OAUTH_MODELS_CLIENT_VERSION);
  try {
    codexOauthModelDebug("requesting model discovery", {
      url: modelsUrl.toString(),
      timeoutMs: CODEX_OAUTH_MODEL_DISCOVERY_TIMEOUT_MS,
      hasToken: token.length > 0,
    });
    const response = await fetch(modelsUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CODEX_OAUTH_MODEL_DISCOVERY_TIMEOUT_MS),
    });
    codexOauthModelDebug("model endpoint response", {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      contentType: responseHeader(response, "content-type"),
      requestId: responseHeader(response, "x-request-id"),
      cfRay: responseHeader(response, "cf-ray"),
      authError: responseHeader(response, "x-openai-authorization-error"),
      authErrorCode: responseHeader(response, "x-openai-authorization-error-code"),
    });
    if (!response.ok) {
      const body = await responseDebugBody(response);
      codexOauthModelDebug("model endpoint non-ok body", {
        body,
      });
      if (response.status === 401 || response.status === 403) {
        return unavailableCliProviderDiscovery(
          "auth_expired",
          isInvalidatedCodexOauthResponse(body ?? "")
            ? "Codex OAuth authentication was invalidated. Sign in again."
            : "Codex OAuth authentication was rejected by the model endpoint.",
          "expired",
        );
      }
      return unavailableCliProviderDiscovery(
        "endpoint_error",
        "Codex OAuth model endpoint failed.",
        "unknown",
      );
    }
    const parsed = await response.json();
    data = typeof parsed === "object" && parsed !== null
      ? parsed as { readonly data?: unknown; readonly models?: unknown }
      : undefined;
    const modelSource = Array.isArray(data?.models) ? data.models : data?.data;
    const capabilityCount = Array.isArray(modelSource)
      ? countCodexOauthModelCapabilityEntries(modelSource)
      : 0;
    codexOauthModelDebug("model endpoint parsed", {
      hasModelsArray: Array.isArray(data?.models),
      hasDataArray: Array.isArray(data?.data),
      modelCount: Array.isArray(data?.models)
        ? data.models.length
        : Array.isArray(data?.data)
          ? data.data.length
          : 0,
      capabilityCount,
    });
  } catch (error) {
    codexOauthModelDebug("model endpoint request failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      timeoutMs: CODEX_OAUTH_MODEL_DISCOVERY_TIMEOUT_MS,
    });
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "Codex OAuth model endpoint failed.",
      "unknown",
    );
  }
  const modelSource = Array.isArray(data?.models) ? data.models : data?.data;
  const modelEntries = Array.isArray(modelSource) ? modelSource : [];
  const models = normalizeModelIds(modelEntries.flatMap((entry) => {
    const modelId = readCodexOauthModelId(entry);
    return modelId ? [modelId] : [];
  }));
  const modelCapabilities = extractCodexOauthModelCapabilities(modelEntries, models);
  return models.length > 0
    ? {
        models,
        ...(modelCapabilities ? { modelCapabilities } : {}),
        status: "available",
        reason: "Codex OAuth models discovered.",
        authState: "authenticated",
      }
    : unavailableCliProviderDiscovery(
        "empty_model_list",
        "Codex OAuth model endpoint returned an empty model list.",
        "unknown",
      );
}

function isInvalidatedCodexOauthResponse(body: string): boolean {
  return /token_invalidated|invalidated/i.test(body);
}

function countCodexOauthModelCapabilityEntries(entries: readonly unknown[]): number {
  let count = 0;
  for (const entry of entries) {
    const record = asRecord(entry);
    if (record && Object.keys(readCodexOauthModelCapabilities(record, readCodexOauthModelId(record))).length > 0) {
      count += 1;
    }
  }
  return count;
}

function extractCodexOauthModelCapabilities(
  entries: readonly unknown[],
  models: readonly string[],
): Readonly<Record<string, GuiProviderModelCapabilities>> | undefined {
  const discoveredModels = new Set(models);
  const capabilities: Record<string, GuiProviderModelCapabilities> = {};
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    const model = readCodexOauthModelId(record);
    if (!model || !discoveredModels.has(model)) continue;
    const capability = readCodexOauthModelCapabilities(record, model);
    if (Object.keys(capability).length > 0) {
      capabilities[model] = capability;
    }
  }
  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}

function readCodexOauthModelId(entry: unknown): string | undefined {
  const record = asRecord(entry);
  if (!record) return undefined;
  return readString(record.slug)?.trim() || readString(record.id)?.trim() || undefined;
}

function readCodexOauthModelCapabilities(
  record: Readonly<Record<string, unknown>>,
  model: string | undefined,
): GuiProviderModelCapabilities {
  const supportsFunctionTools = readCodexOauthModelSupportsFunctionTools(record);
  const supportsRuntimeTools = supportsFunctionTools;
  const supportsNativeShellTools = readCodexOauthModelSupportsNativeShellTools(record);
  const supportsNativePatchTools = readCodexOauthModelSupportsNativePatchTools(record);
  const supportsParallelToolCalls =
    readBoolean(record.supports_parallel_tool_calls)
    ?? readBoolean(record.supportsParallelToolCalls);
  const contextWindow =
    readFiniteNumber(record.context_window)
    ?? readFiniteNumber(record.contextWindow);
  const inputModalities =
    readStringArray(record.input_modalities)
    ?? readStringArray(record.inputModalities);
  const supportsVision = inputModalities?.some((modality) => modality.toLowerCase() === "image");
  const defaultLevel =
    readDeliberationLevelId(record.default_reasoning_effort)
    ?? readDeliberationLevelId(record.defaultReasoningEffort)
    ?? readDeliberationLevelId(record.default_reasoning_level)
    ?? readDeliberationLevelId(record.defaultReasoningLevel);
  const levels =
    readDeliberationLevelArray(record.supported_reasoning_efforts)
    ?? readDeliberationLevelArray(record.supportedReasoningEfforts)
    ?? readDeliberationLevelArray(record.supported_reasoning_levels)
    ?? readDeliberationLevelArray(record.supportedReasoningLevels);
  const deliberation = model && levels
    ? {
        provider: "codex-oauth",
        model,
        levels: levels.map((id) => ({ id })),
        ...(defaultLevel && levels.includes(defaultLevel) ? { defaultLevel } : {}),
        supportsAdaptive: true,
        evidence: {
          sourceIdentity: "codex-oauth-model-catalog",
          sourceRevision: readString(record.version)?.trim() || model,
          observedAt: new Date().toISOString(),
        },
      }
    : undefined;

  return {
    ...(supportsFunctionTools !== undefined ? { supportsFunctionTools } : {}),
    ...(supportsRuntimeTools !== undefined ? { supportsRuntimeTools } : {}),
    ...(supportsNativeShellTools !== undefined ? { supportsNativeShellTools } : {}),
    ...(supportsNativePatchTools !== undefined ? { supportsNativePatchTools } : {}),
    ...(supportsRuntimeTools !== undefined ? { supportsTools: supportsRuntimeTools } : {}),
    ...(supportsParallelToolCalls !== undefined ? { supportsParallelToolCalls } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(supportsVision !== undefined ? { supportsVision } : {}),
    ...(deliberation !== undefined ? { deliberation } : {}),
  };
}

function readDeliberationLevelId(value: unknown): GuiDeliberationLevelId | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(normalized) ? normalized : undefined;
}

function readDeliberationLevelArray(value: unknown): readonly GuiDeliberationLevelId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const levels: GuiDeliberationLevelId[] = [];
  const seen = new Set<GuiDeliberationLevelId>();
  for (const entry of value) {
    const record = asRecord(entry);
    const level = readDeliberationLevelId(entry)
      ?? readDeliberationLevelId(record?.effort)
      ?? readDeliberationLevelId(record?.value)
      ?? readDeliberationLevelId(record?.id);
    if (!level || seen.has(level)) continue;
    seen.add(level);
    levels.push(level);
  }
  return levels.length > 0 ? levels : undefined;
}

function readCodexOauthModelSupportsFunctionTools(record: Readonly<Record<string, unknown>>): boolean | undefined {
  const explicitSupportsTools =
    readBoolean(record.supports_tools)
    ?? readBoolean(record.supportsTools)
    ?? readBoolean(record.supports_function_calling)
    ?? readBoolean(record.supportsFunctionCalling)
    ?? readBoolean(record.supports_tool_calls)
    ?? readBoolean(record.supportsToolCalls);
  if (explicitSupportsTools !== undefined) return explicitSupportsTools;

  const experimentalSupportedTools =
    readStringArray(record.experimental_supported_tools)
    ?? readStringArray(record.experimentalSupportedTools);
  if (experimentalSupportedTools && experimentalSupportedTools.length > 0) return true;

  return undefined;
}

function readCodexOauthModelSupportsNativeShellTools(
  record: Readonly<Record<string, unknown>>,
): boolean | undefined {
  const shellType = readString(record.shell_type) ?? readString(record.shellType);
  if (!shellType) return undefined;
  return shellType !== "disabled";
}

function readCodexOauthModelSupportsNativePatchTools(
  record: Readonly<Record<string, unknown>>,
): boolean | undefined {
  const applyPatchToolType =
    readString(record.apply_patch_tool_type)
    ?? readString(record.applyPatchToolType);
  if (!applyPatchToolType) return undefined;
  return applyPatchToolType !== "disabled";
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function codexOauthModelDebug(message: string, context: Record<string, unknown>): void {
  if (!CODEX_OAUTH_MODEL_DISCOVERY_DEBUG) {
    return;
  }
  console.warn(`[gui-provider-models:codex-oauth][debug] ${message}`, context);
}

function responseHeader(response: Response, name: string): string | undefined {
  const headers = (response as { readonly headers?: { get?: (header: string) => string | null } }).headers;
  return headers?.get?.(name) ?? undefined;
}

async function responseDebugBody(response: Response): Promise<string | undefined> {
  const clone = (response as { readonly clone?: () => Response }).clone;
  const source = typeof clone === "function" ? clone.call(response) : response;
  const text = (source as { readonly text?: () => Promise<string> }).text;
  if (typeof text !== "function") {
    return undefined;
  }
  try {
    const body = await text.call(source);
    return redactDebugBody(body).slice(0, 1_000);
  } catch (error) {
    return `failed to read response body: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function redactDebugBody(body: string): string {
  return body
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, "Bearer <redacted>")
    .replace(/"(access_token|refresh_token|id_token|token)"\s*:\s*"[^"]+"/gi, "\"$1\":\"<redacted>\"");
}

async function discoverOpenAiModelDiscovery(
  available: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const token = env.OPENAI_API_KEY?.trim() ?? "";
  if (token.length === 0) {
    return unavailableCliProviderDiscovery(
      "missing_auth",
      "OPENAI_API_KEY is missing.",
      "missing",
    );
  }

  let parsed: { readonly data?: unknown; readonly models?: unknown } | undefined;
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      return unavailableCliProviderDiscovery(
        "endpoint_error",
        "OpenAI model endpoint failed.",
        "unknown",
      );
    }
    const data = await response.json();
    parsed = typeof data === "object" && data !== null
      ? data as { readonly data?: unknown; readonly models?: unknown }
      : undefined;
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "OpenAI model endpoint failed.",
      "unknown",
    );
  }

  const rawModels = extractProviderModelIds(parsed);
  if (rawModels.length === 0) {
    return unavailableCliProviderDiscovery(
      "empty_model_list",
      "OpenAI model endpoint returned an empty model list.",
      "unknown",
    );
  }
  const models = rawModels.filter(isUsableOpenAiChatModelId);
  return models.length > 0
    ? {
        models,
        status: "available",
        reason: "OpenAI models discovered.",
        authState: "authenticated",
      }
    : unavailableCliProviderDiscovery(
        "empty_model_list",
        "OpenAI model endpoint returned no usable chat models.",
        "unknown",
      );
}

function isUsableOpenAiChatModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (
    lower.startsWith("text-")
    || lower.startsWith("dall-e")
    || lower.startsWith("sora")
    || lower.startsWith("tts-")
    || lower.startsWith("whisper")
    || lower.includes("embedding")
    || lower.includes("moderation")
    || lower.includes("image")
    || lower.includes("realtime")
    || lower.includes("audio")
    || lower.includes("transcribe")
    || lower === "computer-use-preview"
  ) {
    return false;
  }
  if (lower.startsWith("ft:")) {
    return lower.startsWith("ft:gpt-") || /^ft:o\d/.test(lower);
  }
  return lower.startsWith("gpt-") || /^o\d/.test(lower);
}

async function discoverAnthropicModelDiscovery(
  available: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const token = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (token.length === 0) {
    return unavailableCliProviderDiscovery(
      "missing_auth",
      "ANTHROPIC_API_KEY is missing.",
      "missing",
    );
  }

  let parsed: { readonly data?: unknown; readonly models?: unknown } | undefined;
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": token,
      },
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      return unavailableCliProviderDiscovery(
        "endpoint_error",
        "Anthropic model endpoint failed.",
        "unknown",
      );
    }
    const data = await response.json();
    parsed = typeof data === "object" && data !== null
      ? data as { readonly data?: unknown; readonly models?: unknown }
      : undefined;
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "Anthropic model endpoint failed.",
      "unknown",
    );
  }

  const rawModels = extractProviderModelIds(parsed);
  if (rawModels.length === 0) {
    return unavailableCliProviderDiscovery(
      "empty_model_list",
      "Anthropic model endpoint returned an empty model list.",
      "unknown",
    );
  }
  const models = extractAnthropicMessageModelIds(parsed);
  return models.length > 0
    ? {
        models,
        status: "available",
        reason: "Anthropic models discovered.",
        authState: "authenticated",
      }
    : unavailableCliProviderDiscovery(
        "empty_model_list",
        "Anthropic model endpoint returned no message-capable models.",
        "unknown",
      );
}

function extractAnthropicMessageModelIds(
  data: { readonly data?: unknown; readonly models?: unknown } | undefined,
): string[] {
  const source = Array.isArray(data?.data) ? data.data : data?.models;
  if (!Array.isArray(source)) {
    return [];
  }
  return normalizeModelIds(source.flatMap((entry) => (
    isUsableAnthropicMessageModelEntry(entry) && typeof entry?.id === "string"
      ? [entry.id]
      : []
  )));
}

function isUsableAnthropicMessageModelEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const modelId = "id" in entry ? entry.id : undefined;
  if (typeof modelId !== "string") {
    return false;
  }
  const lower = modelId.toLowerCase();
  if (
    !lower.startsWith("claude-")
    || lower.includes("embedding")
    || lower.includes("moderation")
    || lower.includes("image")
    || lower.includes("audio")
    || lower.includes("transcribe")
    || lower.includes("tts")
    || lower.includes("whisper")
    || lower.includes("realtime")
  ) {
    return false;
  }
  const capabilities = "capabilities" in entry ? entry.capabilities : undefined;
  return anthropicMessagesCapability(capabilities) !== false;
}

function anthropicMessagesCapability(capabilities: unknown): boolean | undefined {
  if (typeof capabilities !== "object" || capabilities === null) {
    return undefined;
  }
  const messages = "messages" in capabilities ? capabilities.messages : undefined;
  if (typeof messages === "boolean") {
    return messages;
  }
  if (typeof messages !== "object" || messages === null) {
    return undefined;
  }
  const supported = "supported" in messages ? messages.supported : undefined;
  return typeof supported === "boolean" ? supported : undefined;
}

async function discoverDeepSeekModelDiscovery(
  available: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const token = env.DEEPSEEK_API_KEY?.trim() ?? "";
  if (token.length === 0) {
    return unavailableCliProviderDiscovery(
      "missing_auth",
      "DEEPSEEK_API_KEY is missing.",
      "missing",
    );
  }

  let parsed: { readonly data?: unknown; readonly models?: unknown } | undefined;
  try {
    const response = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      return unavailableCliProviderDiscovery(
        "endpoint_error",
        "DeepSeek model endpoint failed.",
        "unknown",
      );
    }
    const data = await response.json();
    parsed = typeof data === "object" && data !== null
      ? data as { readonly data?: unknown; readonly models?: unknown }
      : undefined;
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "DeepSeek model endpoint failed.",
      "unknown",
    );
  }

  const rawModels = extractProviderModelIds(parsed);
  if (rawModels.length === 0) {
    return unavailableCliProviderDiscovery(
      "empty_model_list",
      "DeepSeek model endpoint returned an empty model list.",
      "unknown",
    );
  }
  const models = rawModels.filter(isUsableDeepSeekChatModelId);
  return models.length > 0
    ? {
        models,
        status: "available",
        reason: "DeepSeek models discovered.",
        authState: "authenticated",
      }
    : unavailableCliProviderDiscovery(
        "empty_model_list",
        "DeepSeek model endpoint returned no usable chat models.",
        "unknown",
      );
}

function isUsableDeepSeekChatModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (!lower.startsWith("deepseek-")) {
    return false;
  }
  return !(
    lower.includes("embedding")
    || lower.includes("rerank")
    || lower.includes("moderation")
    || lower.includes("image")
    || lower.includes("audio")
    || lower.includes("speech")
    || lower.includes("transcribe")
    || lower.includes("tts")
    || lower.includes("whisper")
  );
}

async function discoverOpenRouterModelDiscovery(
  available: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const token = env.OPENROUTER_API_KEY?.trim() ?? "";
  if (token.length === 0) {
    return unavailableCliProviderDiscovery(
      "missing_auth",
      "OPENROUTER_API_KEY is missing.",
      "missing",
    );
  }

  let parsed: { readonly data?: unknown; readonly models?: unknown } | undefined;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      return unavailableCliProviderDiscovery(
        "endpoint_error",
        "OpenRouter model endpoint failed.",
        "unknown",
      );
    }
    const data = await response.json();
    parsed = typeof data === "object" && data !== null
      ? data as { readonly data?: unknown; readonly models?: unknown }
      : undefined;
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "OpenRouter model endpoint failed.",
      "unknown",
    );
  }

  const rawModels = extractProviderModelIds(parsed);
  if (rawModels.length === 0) {
    return unavailableCliProviderDiscovery(
      "empty_model_list",
      "OpenRouter model endpoint returned an empty model list.",
      "unknown",
    );
  }
  const models = extractOpenRouterTextChatModelIds(parsed);
  return models.length > 0
    ? {
        models,
        status: "available",
        reason: "OpenRouter models discovered.",
        authState: "authenticated",
      }
    : unavailableCliProviderDiscovery(
        "empty_model_list",
        "OpenRouter model endpoint returned no usable text chat models.",
        "unknown",
      );
}

function extractOpenRouterTextChatModelIds(
  data: { readonly data?: unknown; readonly models?: unknown } | undefined,
): string[] {
  const source = Array.isArray(data?.data) ? data.data : data?.models;
  if (!Array.isArray(source)) {
    return [];
  }
  return normalizeModelIds(source.flatMap((entry) => (
    isUsableOpenRouterTextChatModelEntry(entry) && typeof entry?.id === "string"
      ? [entry.id]
      : []
  )));
}

function isUsableOpenRouterTextChatModelEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const modelId = "id" in entry ? entry.id : undefined;
  if (typeof modelId !== "string") {
    return false;
  }
  const trimmed = modelId.trim();
  if (!trimmed.includes("/")) {
    return false;
  }

  const architecture = "architecture" in entry ? entry.architecture : undefined;
  const outputModalities = openRouterModalities(architecture, "output_modalities");
  if (outputModalities.length > 0) {
    return outputModalities.includes("text");
  }

  const modality = openRouterModality(architecture);
  if (modality) {
    const lowerModality = modality.toLowerCase();
    if (lowerModality.includes("->")) {
      return lowerModality.split("->").some((part) => part.trim() === "text")
        && lowerModality.split("->").at(-1)?.trim() === "text";
    }
    if (!lowerModality.includes("text")) {
      return false;
    }
  }

  const lower = trimmed.toLowerCase();
  return !(
    lower.includes("embedding")
    || lower.includes("rerank")
    || lower.includes("moderation")
    || lower.includes("image")
    || lower.includes("audio")
    || lower.includes("speech")
    || lower.includes("transcribe")
    || lower.includes("tts")
    || lower.includes("whisper")
  );
}

function openRouterModalities(architecture: unknown, key: "input_modalities" | "output_modalities"): string[] {
  if (typeof architecture !== "object" || architecture === null) {
    return [];
  }
  const value = (architecture as Partial<Record<"input_modalities" | "output_modalities", unknown>>)[key];
  return Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === "string" ? [entry.toLowerCase()] : [])
    : [];
}

function openRouterModality(architecture: unknown): string | undefined {
  if (typeof architecture !== "object" || architecture === null) {
    return undefined;
  }
  const modality = "modality" in architecture ? architecture.modality : undefined;
  return typeof modality === "string" ? modality : undefined;
}

async function discoverOllamaModelDiscovery(
  available: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  let parsed: { readonly models?: unknown } | undefined;
  try {
    const baseUrl = env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      return unavailableCliProviderDiscovery(
        "daemon_unreachable",
        "Ollama daemon is not reachable at http://localhost:11434.",
        "not_required",
      );
    }
    const data = await response.json();
    parsed = typeof data === "object" && data !== null
      ? data as { readonly models?: unknown }
      : undefined;
  } catch {
    return unavailableCliProviderDiscovery(
      "daemon_unreachable",
      "Ollama daemon is not reachable at http://localhost:11434.",
      "not_required",
    );
  }

  const models = extractOllamaLocalModelNames(parsed);
  return models.length > 0
    ? {
        models,
        status: "available",
        reason: "Ollama models discovered.",
        authState: "not_required",
      }
    : unavailableCliProviderDiscovery(
        "empty_model_list",
        "Ollama daemon returned no installed models.",
        "not_required",
      );
}

function extractOllamaLocalModelNames(data: { readonly models?: unknown } | undefined): string[] {
  if (!Array.isArray(data?.models)) {
    return [];
  }
  return normalizeModelIds(data.models.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    if ("name" in entry && typeof entry.name === "string") {
      return [entry.name];
    }
    if ("model" in entry && typeof entry.model === "string") {
      return [entry.model];
    }
    return [];
  }));
}

async function discoverLmStudioModelDiscovery(
  available: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const baseUrl = env.LMSTUDIO_BASE_URL?.trim() || "http://localhost:1234/v1";
  const token = env.LMSTUDIO_API_KEY?.trim();
  let parsed: { readonly data?: unknown; readonly models?: unknown } | undefined;
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      return unavailableCliProviderDiscovery(
        "daemon_unreachable",
        `LM Studio server is not reachable at ${baseUrl}.`,
        "not_required",
      );
    }
    const data = await response.json();
    parsed = typeof data === "object" && data !== null
      ? data as { readonly data?: unknown; readonly models?: unknown }
      : undefined;
  } catch {
    return unavailableCliProviderDiscovery(
      "daemon_unreachable",
      `LM Studio server is not reachable at ${baseUrl}.`,
      "not_required",
    );
  }

  const models = extractProviderModelIds(parsed);
  return models.length > 0
    ? {
        models,
        status: "available",
        reason: "LM Studio models discovered.",
        authState: token ? "authenticated" : "not_required",
      }
    : unavailableCliProviderDiscovery(
        "empty_model_list",
        "LM Studio server returned no loaded models.",
        "not_required",
      );
}

async function discoverOpenCodeDirectModelDiscovery(
  providerAvailability: Readonly<Record<string, boolean>>,
  env: Readonly<Record<string, string | undefined>>,
  kilnHome?: string,
): Promise<Record<string, GuiCliProviderModelDiscovery>> {
  const allTargets: readonly OpenCodeDirectProviderDiscoveryTarget[] = [
    {
      provider: "opencode-go",
      tier: "go",
      label: "OpenCode Go",
      modelsUrl: OPENCODE_GO_MODELS_URL,
    },
    {
      provider: "opencode-zen",
      tier: "zen",
      label: "OpenCode Zen",
      modelsUrl: OPENCODE_ZEN_MODELS_URL,
    },
  ];
  const targets = allTargets.filter((target) => providerAvailability[target.provider] === true);
  if (targets.length === 0) {
    return {};
  }
  const envToken = env.OPENCODE_API_KEY?.trim() ?? "";
  if (envToken.length > 0) {
    return Object.fromEntries(await Promise.all(
      targets.map(async (target) => [
        target.provider,
        await discoverOpenCodeDirectProviderModels(target, envToken),
      ] as const),
    ));
  }

  return Object.fromEntries(await Promise.all(
    targets.map(async (target) => {
      const credential = await resolveOpenCodeDirectCredential(target, kilnHome);
      if (!credential.ok) {
        return [
          target.provider,
          unavailableCliProviderDiscovery(
            "missing_auth",
            credential.reason,
            "missing",
          ),
        ] as const;
      }
      return [
        target.provider,
        await discoverOpenCodeDirectProviderModels(target, credential.token),
      ] as const;
    }),
  ));
}

async function resolveOpenCodeDirectCredential(
  target: OpenCodeDirectProviderDiscoveryTarget,
  kilnHome?: string,
): Promise<OpenCodeDirectCredentialResolution> {
  const pool = await new OpenCodeCredentialPoolService({ kilnHome }).createPool(target.tier);
  const credential = pool.getAllCredentials().find((candidate) => candidate.auth.api_key.trim().length > 0);
  if (credential) {
    return { ok: true, token: credential.auth.api_key.trim() };
  }
  return { ok: false, reason: `No ${target.label} credential is linked.` };
}

async function discoverOpenCodeDirectProviderModels(
  target: OpenCodeDirectProviderDiscoveryTarget,
  token: string,
): Promise<GuiCliProviderModelDiscovery> {
  let parsed: { readonly data?: unknown; readonly models?: unknown } | undefined;
  try {
    const response = await fetch(target.modelsUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      return unavailableCliProviderDiscovery(
        "endpoint_error",
        `${target.label} model endpoint failed.`,
        "unknown",
      );
    }
    const data = await response.json();
    parsed = typeof data === "object" && data !== null
      ? data as { readonly data?: unknown; readonly models?: unknown }
      : undefined;
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      `${target.label} model endpoint failed.`,
      "unknown",
    );
  }

  const models = extractProviderModelIds(parsed);
  return models.length > 0
    ? {
        models,
        status: "available",
        reason: `${target.label} models discovered.`,
        authState: "authenticated",
      }
    : unavailableCliProviderDiscovery(
        "empty_model_list",
        `${target.label} model endpoint returned an empty model list.`,
        "unknown",
      );
}

function extractProviderModelIds(
  data: { readonly data?: unknown; readonly models?: unknown } | undefined,
): string[] {
  const source = Array.isArray(data?.data) ? data.data : data?.models;
  if (!Array.isArray(source)) {
    return [];
  }
  return normalizeModelIds(source.flatMap((entry) => {
    if (typeof entry?.id === "string") {
      return [entry.id];
    }
    if (typeof entry?.slug === "string") {
      return [entry.slug];
    }
    if (typeof entry?.name === "string") {
      return [entry.name];
    }
    return [];
  }));
}

export interface OpenCodeExecutableResolution {
  readonly path: string;
  readonly evidence: {
    readonly executable: string;
    readonly version: string;
  };
}

export function resolveOpenCodeExecutable(): OpenCodeExecutableResolution | undefined {
  const probe = resolveExecutable([
    "opencode",
    "opencode.exe",
    ...homeExecutableCandidates([
      ".bun\\bin\\opencode.exe",
      "AppData\\Roaming\\npm\\opencode.cmd",
    ]),
  ], (candidate) => candidate.version !== undefined);
  if (probe?.version === undefined) return undefined;
  const executableName = probe.path.replaceAll("\\", "/").split("/").at(-1) ?? "opencode";
  return {
    path: probe.path,
    evidence: {
      executable: `<operator-harness>/${executableName}`,
      version: probe.version,
    },
  };
}

const OPENCODE_MODEL_DISCOVERY_TIMEOUT_MS = 5_000;
const OPENCODE_CANONICAL_DELIBERATION_VARIANTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly GuiDeliberationLevelId[];

interface OpenCodeModelCatalogProcess {
  readonly url: string;
  readonly close: () => void;
}

export async function discoverOpencodeCliModelDiscovery(): Promise<GuiCliProviderModelDiscovery> {
  const executable = resolveOpenCodeExecutable();
  if (!executable) {
    return unavailableCliProviderDiscovery(
      "cli_missing",
      "OpenCode CLI executable was not found.",
      "not_required",
    );
  }
  try {
    const server = await startOpenCodeModelCatalogServer(executable.path);
    try {
      const response = await readOpenCodeModelCatalog(server.url);
      if (!response.ok) {
        return unavailableCliProviderDiscovery(
          "endpoint_error",
          "OpenCode local model API failed.",
          "unknown",
        );
      }
      const payload = await response.json();
      const entries = asRecord(payload)?.data;
      if (!Array.isArray(entries)) {
        return unavailableCliProviderDiscovery(
          "endpoint_error",
          "OpenCode local model API returned an invalid model catalog.",
          "unknown",
        );
      }
      const observedAt = new Date().toISOString();
      const sourceRevision = openCodeCatalogSourceRevision(executable.evidence.version, entries);
      const discovered = extractOpenCodeCliModelCatalog(entries, sourceRevision, observedAt);
      return discovered.models.length > 0
        ? {
            models: discovered.models,
            ...(discovered.modelCapabilities ? { modelCapabilities: discovered.modelCapabilities } : {}),
            status: "available",
            reason: "OpenCode CLI models discovered through its local model API.",
            authState: "authenticated",
          }
        : unavailableCliProviderDiscovery(
            "empty_model_list",
            "OpenCode local model API returned an empty model list.",
            "unknown",
          );
    } finally {
      server.close();
    }
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "OpenCode CLI model server failed.",
      "unknown",
    );
  }
}

function extractOpenCodeCliModelCatalog(
  entries: readonly unknown[],
  sourceRevision: string,
  observedAt: string,
): {
  readonly models: string[];
  readonly modelCapabilities?: Readonly<Record<string, GuiProviderModelCapabilities>>;
} {
  const models: string[] = [];
  const modelCapabilities: Record<string, GuiProviderModelCapabilities> = {};
  for (const entry of entries) {
    const record = asRecord(entry);
    const id = readString(record?.id)?.trim();
    const providerId = readString(record?.providerID)?.trim();
    if (!id || !providerId || record?.enabled !== true) continue;
    const model = `${providerId}/${id}`;
    models.push(model);
    const variantIds = new Set(extractOpenCodeDeliberationVariants(record.variants).map(({ id }) => id));
    const levels = OPENCODE_CANONICAL_DELIBERATION_VARIANTS
      .filter((variant) => variantIds.has(variant as GuiDeliberationLevelId))
      .map((id) => ({ id: id as GuiDeliberationLevelId }));
    if (levels.length === 0) continue;
    modelCapabilities[model] = {
      deliberation: {
        provider: "opencode",
        model,
        levels,
        // OpenCode variants are named request overlays. The catalog does not
        // define a provider-side adaptive selection policy for Kiln to invoke.
        supportsAdaptive: false,
        evidence: {
          sourceIdentity: "opencode-cli-model-catalog",
          sourceRevision,
          observedAt,
        },
      },
    };
  }
  return {
    models: normalizeModelIds(models),
    ...(Object.keys(modelCapabilities).length > 0 ? { modelCapabilities } : {}),
  };
}

interface OpenCodeDeliberationVariantEvidence {
  readonly id: GuiDeliberationLevelId;
  readonly semantics: readonly Readonly<Record<string, boolean | number | string>>[];
}

function extractOpenCodeDeliberationVariants(value: unknown): readonly OpenCodeDeliberationVariantEvidence[] {
  if (!Array.isArray(value)) return [];
  const variants: OpenCodeDeliberationVariantEvidence[] = [];
  for (const variant of value) {
    const record = asRecord(variant);
    const id = readDeliberationLevelId(record?.id);
    if (!id || !OPENCODE_CANONICAL_DELIBERATION_VARIANTS.includes(
      id as (typeof OPENCODE_CANONICAL_DELIBERATION_VARIANTS)[number],
    )) {
      continue;
    }
    const semantics = openCodeVariantReasoningSemantics(record);
    if (!openCodeVariantSemanticsMatchLevel(id, semantics)) continue;
    if (!variants.some((candidate) => candidate.id === id)) variants.push({ id, semantics });
  }
  return variants;
}

function openCodeVariantReasoningSemantics(
  variant: Readonly<Record<string, unknown>> | undefined,
): readonly Readonly<Record<string, boolean | number | string>>[] {
  if (!variant) return [];
  const semantics: Array<Readonly<Record<string, boolean | number | string>>> = [];
  for (const container of [variant.body, variant.settings]) {
    const record = asRecord(container);
    if (!record) continue;
    for (const field of ["reasoningEffort", "reasoning_effort", "effort"] as const) {
      const value = readDeliberationLevelId(record[field]);
      if (value) semantics.push({ kind: "effort", field, value });
    }
    const reasoning = asRecord(record.reasoning);
    const reasoningEffort = readDeliberationLevelId(reasoning?.effort);
    if (reasoningEffort) semantics.push({ kind: "effort", field: "reasoning.effort", value: reasoningEffort });
    const reasoningConfig = asRecord(record.reasoningConfig);
    const maxReasoningEffort = readDeliberationLevelId(reasoningConfig?.maxReasoningEffort);
    if (maxReasoningEffort) {
      semantics.push({ kind: "effort", field: "reasoningConfig.maxReasoningEffort", value: maxReasoningEffort });
    }
    const reasoningConfigType = readString(reasoningConfig?.type)?.trim().toLowerCase();
    if (reasoningConfigType === "enabled" || reasoningConfigType === "adaptive" || reasoningConfigType === "disabled") {
      semantics.push({ kind: "toggle", field: "reasoningConfig.type", value: reasoningConfigType });
    }
    const modelParams = asRecord(record.modelParams);
    const modelParamsEffort = readDeliberationLevelId(modelParams?.reasoning_effort);
    if (modelParamsEffort) {
      semantics.push({ kind: "effort", field: "modelParams.reasoning_effort", value: modelParamsEffort });
    }
    const outputConfigEffort = readDeliberationLevelId(asRecord(modelParams?.output_config)?.effort);
    if (outputConfigEffort) {
      semantics.push({ kind: "effort", field: "modelParams.output_config.effort", value: outputConfigEffort });
    }
    const thinking = asRecord(record.thinking) ?? asRecord(record.thinkingConfig);
    const thinkingLevel = readDeliberationLevelId(thinking?.thinkingLevel);
    if (thinkingLevel) semantics.push({ kind: "effort", field: "thinking.thinkingLevel", value: thinkingLevel });
    const thinkingType = readString(thinking?.type)?.trim().toLowerCase();
    if (thinkingType === "enabled" || thinkingType === "adaptive" || thinkingType === "disabled") {
      semantics.push({ kind: "toggle", field: "thinking.type", value: thinkingType });
    }
    for (const [field, value] of [
      ["thinking.budgetTokens", thinking?.budgetTokens],
      ["thinking.thinkingBudget", thinking?.thinkingBudget],
      ["reasoning.max_tokens", reasoning?.max_tokens],
      ["reasoningConfig.budgetTokens", reasoningConfig?.budgetTokens],
      ["thinking_budget", record.thinking_budget],
      ["thinkingBudget", record.thinkingBudget],
    ] as const) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        semantics.push({ kind: "budget", field, value });
      }
    }
    if (typeof record.enable_thinking === "boolean") {
      semantics.push({ kind: "toggle", field: "enable_thinking", value: record.enable_thinking });
    }
    if (typeof record.enableThinking === "boolean") {
      semantics.push({ kind: "toggle", field: "enableThinking", value: record.enableThinking });
    }
    const thinkingMode = readString(asRecord(record.chat_template_kwargs)?.thinking_mode)?.trim().toLowerCase();
    if (thinkingMode === "enabled" || thinkingMode === "disabled") {
      semantics.push({ kind: "toggle", field: "chat_template_kwargs.thinking_mode", value: thinkingMode });
    }
  }
  return semantics;
}

function openCodeVariantSemanticsMatchLevel(
  id: GuiDeliberationLevelId,
  semantics: readonly Readonly<Record<string, boolean | number | string>>[],
): boolean {
  const effortValues = semantics
    .filter((entry) => entry.kind === "effort")
    .map((entry) => entry.value);
  const explicitlyEnabled = semantics.some((entry) =>
    (entry.kind === "toggle" && (entry.value === true || entry.value === "enabled" || entry.value === "adaptive"))
    || (entry.kind === "budget" && typeof entry.value === "number" && entry.value > 0));
  const explicitlyDisabled = semantics.some((entry) =>
    (entry.kind === "toggle" && (entry.value === false || entry.value === "disabled"))
    || (entry.kind === "budget" && entry.value === 0));
  if (effortValues.length > 0) {
    return effortValues.every((value) => value === id)
      && (id === "none" ? !explicitlyEnabled : !explicitlyDisabled);
  }
  return id === "none" ? explicitlyDisabled && !explicitlyEnabled : explicitlyEnabled && !explicitlyDisabled;
}

function openCodeCatalogSourceRevision(executableVersion: string, entries: readonly unknown[]): string {
  // Snapshot only capability-relevant, non-secret fields. Headers and request
  // bodies can carry credentials and must never become durable evidence.
  const snapshot = entries.flatMap((entry) => {
    const record = asRecord(entry);
    const id = readString(record?.id)?.trim();
    const providerId = readString(record?.providerID)?.trim();
    if (!id || !providerId || record?.enabled !== true) return [];
    return [{
      model: `${providerId}/${id}`,
      variants: [...extractOpenCodeDeliberationVariants(record.variants)]
        .sort((left, right) => left.id.localeCompare(right.id)),
    }];
  }).sort((left, right) => left.model.localeCompare(right.model));
  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16);
  return `${executableVersion}:${digest}`;
}

async function startOpenCodeModelCatalogServer(executable: string): Promise<OpenCodeModelCatalogProcess> {
  const { spawn } = await import("node:child_process");
  return await new Promise<OpenCodeModelCatalogProcess>((resolve, reject) => {
    const proc = spawn(executable, ["serve", "--hostname=127.0.0.1", "--port=0"], {
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(executable),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    const close = () => {
      if (process.platform === "win32" && typeof proc.pid === "number") {
        try {
          execFileSync("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          return;
        } catch {
          // Fall back to Node's process handle if the platform helper is unavailable.
        }
      }
      try {
        proc.kill();
      } catch {
        // The child may have exited after publishing its listening URL.
      }
    };
    const finish = (result: OpenCodeModelCatalogProcess | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (result instanceof Error) {
        close();
        reject(result);
      } else {
        resolve(result);
      }
    };
    const timeout = setTimeout(() => finish(new Error("OpenCode local model server timed out.")), OPENCODE_MODEL_DISCOVERY_TIMEOUT_MS);
    // OpenCode's SDK uses this same child-owned ephemeral-port handshake. It
    // removes the close-and-rebind window of reserving a port in the parent.
    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      for (const line of stdout.split(/\r?\n/u)) {
        if (!line.startsWith("opencode server listening")) continue;
        const url = /\bon\s+(http:\/\/127\.0\.0\.1:\d+)\b/u.exec(line)?.[1];
        if (url) {
          finish({ url, close });
          return;
        }
      }
    });
    proc.stderr?.on("data", () => undefined);
    proc.on("error", () => finish(new Error("OpenCode local model server failed.")));
    proc.on("close", () => finish(new Error("OpenCode local model server exited before becoming ready.")));
  });
}

async function readOpenCodeModelCatalog(serverUrl: string): Promise<Response> {
  const deadline = Date.now() + OPENCODE_MODEL_DISCOVERY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetch(`${serverUrl}/api/model`, { signal: AbortSignal.timeout(1_000) });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error("OpenCode local model API did not become ready.");
}

/**
 * The operator's installed Claude Code, resolved identically for discovery and
 * for managed execution.  The Agent SDK bundles its own Claude Code build and
 * uses it whenever `pathToClaudeCodeExecutable` is absent, so a caller that
 * skips this resolver silently executes a different binary than the one whose
 * catalog was discovered.  Every Claude executable decision must come through
 * here; a second resolver would reintroduce that divergence.
 */
export interface ClaudeCodeExecutableResolution {
  readonly path: string;
  readonly evidence: {
    readonly executable: string;
    readonly version: string;
  };
}

export function resolveClaudeCodeExecutable(): ClaudeCodeExecutableResolution | undefined {
  // A candidate that runs but reports no version cannot carry admission
  // evidence, so it is skipped rather than ending resolution.
  const probe = resolveExecutable(
    [
      ...homeExecutableCandidates(process.platform === "win32"
        ? [".local/bin/claude.exe", ".local/bin/claude"]
        : [".local/bin/claude", ".local/bin/claude.exe"]),
      "claude",
      "claude.exe",
    ],
    (candidate) => candidate.version !== undefined,
  );
  if (probe?.version === undefined) {
    return undefined;
  }
  const executableName = probe.path.replaceAll("\\", "/").split("/").at(-1) ?? "claude";
  return {
    path: probe.path,
    evidence: {
      executable: `<operator-harness>/${executableName}`,
      version: probe.version,
    },
  };
}

/**
 * Claude Code does not expose a stable `models` command.  Its Agent SDK
 * control plane exposes the authenticated catalog without sending a model
 * turn, so managed-route admission can remain evidence based.
 */
export async function discoverClaudeCliModelDiscovery(): Promise<GuiCliProviderModelDiscovery> {
  const executable = resolveClaudeCodeExecutable();
  if (!executable) {
    return unavailableCliProviderDiscovery("cli_missing", "Claude Code executable was not found.", "not_required");
  }
  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const control = query({
      prompt: "",
      options: { permissionMode: "plan", pathToClaudeCodeExecutable: executable.path },
    });
    try {
      const supportedModels = await boundedClaudeSupportedModels(control);
      const models = normalizeModelIds(supportedModels.flatMap((model) => [
        model.value,
        ...(model.resolvedModel ? [model.resolvedModel] : []),
      ]));
      const modelCapabilities = extractClaudeCliModelCapabilities(
        supportedModels,
        executable.evidence.version,
      );
      return models.length > 0
        ? {
            models,
            ...(modelCapabilities ? { modelCapabilities } : {}),
            status: "available",
            reason: "Claude Code models discovered through the Agent SDK control plane.",
            authState: "authenticated",
          }
        : unavailableCliProviderDiscovery("empty_model_list", "Claude Code returned an empty model catalog.", "unknown");
    } finally {
      control.close();
    }
  } catch (error) {
    if (error instanceof ClaudeModelDiscoveryTimeoutError) {
      return unavailableCliProviderDiscovery("endpoint_timeout", "Claude Code model discovery timed out.", "unknown");
    }
    return unavailableCliProviderDiscovery("endpoint_error", "Claude Code model discovery failed.", "unknown");
  }
}

class ClaudeModelDiscoveryTimeoutError extends Error {}

const CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

async function boundedClaudeSupportedModels(
  control: {
    readonly supportedModels: () => Promise<readonly {
      readonly value: string;
      readonly resolvedModel?: string;
      readonly supportsEffort?: boolean;
      readonly supportedEffortLevels?: readonly string[];
      readonly supportsAdaptiveThinking?: boolean;
    }[]>;
  },
): Promise<readonly {
  readonly value: string;
  readonly resolvedModel?: string;
  readonly supportsEffort?: boolean;
  readonly supportedEffortLevels?: readonly string[];
  readonly supportsAdaptiveThinking?: boolean;
}[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      control.supportedModels(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new ClaudeModelDiscoveryTimeoutError()), CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function extractClaudeCliModelCapabilities(
  models: readonly {
    readonly value: string;
    readonly resolvedModel?: string;
    readonly supportsEffort?: boolean;
    readonly supportedEffortLevels?: readonly string[];
    readonly supportsAdaptiveThinking?: boolean;
  }[],
  executableVersion: string,
): Readonly<Record<string, GuiProviderModelCapabilities>> | undefined {
  const capabilities: Record<string, GuiProviderModelCapabilities> = {};
  for (const model of models) {
    // Claude's SDK is the authority for this executable. A missing or false
    // effort flag is not a license to inherit levels from another Claude model.
    if (model.supportsEffort !== true) continue;
    const levels = readDeliberationLevelArray(model.supportedEffortLevels)?.filter(
      (level) => CLAUDE_AGENT_SDK_EFFORT_LEVELS.has(level),
    );
    if (!levels || levels.length === 0) continue;
    for (const modelId of normalizeModelIds([model.value, ...(model.resolvedModel ? [model.resolvedModel] : [])])) {
      capabilities[modelId] = {
        deliberation: {
          provider: "claude",
          model: modelId,
          levels: levels.map((id) => ({ id })),
          supportsAdaptive: model.supportsAdaptiveThinking === true,
          evidence: {
            sourceIdentity: "claude-code-model-catalog",
            sourceRevision: executableVersion,
            observedAt: new Date().toISOString(),
          },
        },
      };
    }
  }
  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}

const CLAUDE_AGENT_SDK_EFFORT_LEVELS = new Set<GuiDeliberationLevelId>([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const CODEX_APP_SERVER_INITIALIZE_REQUEST_ID = 1;
const CODEX_APP_SERVER_MODEL_LIST_REQUEST_ID = 2;
const CODEX_APP_SERVER_MODEL_DISCOVERY_TIMEOUT_MS = 5_000;
let codexCliModelDiscoveryInFlight: Promise<GuiCliProviderModelDiscovery> | undefined;
let unreapedCodexAppServer: ChildProcess | undefined;

export function discoverCodexCliModelDiscovery(): Promise<GuiCliProviderModelDiscovery> {
  if (unreapedCodexAppServer?.exitCode === null) {
    return Promise.resolve(unavailableCliProviderDiscovery(
      "endpoint_error",
      "A previous Codex app-server process did not confirm shutdown; discovery is blocked until it closes.",
      "unknown",
    ));
  }
  unreapedCodexAppServer = undefined;
  if (codexCliModelDiscoveryInFlight) {
    return codexCliModelDiscoveryInFlight;
  }
  const discovery = discoverCodexCliModelDiscoveryOnce();
  const tracked = discovery.finally(() => {
    if (codexCliModelDiscoveryInFlight === tracked) {
      codexCliModelDiscoveryInFlight = undefined;
    }
  });
  codexCliModelDiscoveryInFlight = tracked;
  return tracked;
}

async function discoverCodexCliModelDiscoveryOnce(): Promise<GuiCliProviderModelDiscovery> {
  const executable = findExecutable([
    ...homeExecutableCandidates([
      "AppData\\Roaming\\npm\\codex.cmd",
    ]),
    "codex",
    ...homeExecutableCandidates([
      ".codex\\.sandbox-bin\\codex.exe",
    ]),
  ]);
  if (!executable) {
    return unavailableCliProviderDiscovery(
      "cli_missing",
      "Codex CLI executable was not found.",
      "not_required",
    );
  }
  try {
    const { spawn } = await import("node:child_process");
    return await new Promise<GuiCliProviderModelDiscovery>((resolve) => {
      const proc = spawn(executable, ["app-server"], {
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(executable),
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
      let buffer = "";
      let initialized = false;
      let settled = false;
      const finish = (result: GuiCliProviderModelDiscovery): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        void stopProviderDiscoveryProcess(proc).then((closed) => {
          if (closed) {
            resolve(result);
            return;
          }
          unreapedCodexAppServer = proc;
          proc.once("close", () => {
            if (unreapedCodexAppServer === proc) {
              unreapedCodexAppServer = undefined;
            }
          });
          resolve(unavailableCliProviderDiscovery(
            "endpoint_error",
            "Codex app-server did not confirm shutdown; further discovery is blocked until it closes.",
            "unknown",
          ));
        });
      };
      const timer = setTimeout(() => {
        finish(unavailableCliProviderDiscovery(
          "endpoint_timeout",
          "Codex app-server did not return models before timeout.",
          "unknown",
        ));
      }, CODEX_APP_SERVER_MODEL_DISCOVERY_TIMEOUT_MS);
      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>;
            if (msg.id === CODEX_APP_SERVER_INITIALIZE_REQUEST_ID) {
              if (isJsonRpcErrorMessage(msg)) {
                finish(classifyCodexCliAppServerError(msg.error));
                return;
              }
              if (msg.result !== undefined) {
                initialized = true;
                const acceptedInitialized = writeJsonLine(proc.stdin, { method: "initialized" });
                const acceptedModelList = acceptedInitialized && writeJsonLine(proc.stdin, {
                  method: "model/list",
                  id: CODEX_APP_SERVER_MODEL_LIST_REQUEST_ID,
                  params: { limit: 100, includeHidden: false },
                });
                if (!acceptedModelList) {
                  finish(unavailableCliProviderDiscovery(
                    "endpoint_error",
                    "Codex app-server closed before accepting model discovery requests.",
                    "unknown",
                  ));
                  return;
                }
              }
              continue;
            }
            if (msg.id === CODEX_APP_SERVER_MODEL_LIST_REQUEST_ID) {
              if (isJsonRpcErrorMessage(msg)) {
                finish(classifyCodexCliAppServerError(msg.error));
                return;
              }
              if (msg.result !== undefined) {
                const data = (msg.result as { data?: Array<{ id?: unknown }> }).data ?? [];
                const models = normalizeModelIds(data.flatMap((model) => (
                  typeof model.id === "string" ? [model.id] : []
                )));
                finish(models.length > 0
                  ? {
                      models,
                      status: "available",
                      reason: "Codex CLI models discovered.",
                      authState: "authenticated",
                    }
                  : unavailableCliProviderDiscovery(
                      "empty_model_list",
                      "Codex app-server returned an empty model list.",
                      "unknown",
                    ));
                return;
              }
            }
          } catch {
            // ignore malformed json while bootstrapping app-server
          }
        }
      });
      proc.on("error", () => {
        finish(unavailableCliProviderDiscovery(
          "endpoint_error",
          "Codex app-server failed to start.",
          "unknown",
        ));
      });
      bindWritableError(proc.stdin, () => {
        finish(unavailableCliProviderDiscovery(
          "endpoint_error",
          "Codex app-server closed before accepting model discovery requests.",
          "unknown",
        ));
      });
      proc.on("close", () => {
        finish(unavailableCliProviderDiscovery(
          "endpoint_error",
          initialized
            ? "Codex app-server exited before returning models."
            : "Codex app-server exited before initialization completed.",
          "unknown",
        ));
      });
      writeJsonLine(proc.stdin, {
        method: "initialize",
        id: CODEX_APP_SERVER_INITIALIZE_REQUEST_ID,
        params: {
          clientInfo: {
            name: "kiln",
            title: "Kiln",
            version: "0.1.0",
          },
          capabilities: null,
        },
      });
    });
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "Codex app-server model discovery failed.",
      "unknown",
    );
  }
}

async function stopProviderDiscoveryProcess(proc: ChildProcess): Promise<boolean> {
  if (proc.exitCode !== null) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (closed: boolean) => {
      if (finished) return;
      finished = true;
      if (forceTimer) clearTimeout(forceTimer);
      proc.off("close", onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    proc.once("close", onClose);
    forceTimer = setTimeout(() => finish(false), 1_000);

    if (process.platform === "win32" && typeof proc.pid === "number") {
      try {
        execFileSync("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
          timeout: 1_000,
        });
      } catch {
        // Fall through to the direct process handle when taskkill is unavailable.
      }
    }
    if (proc.exitCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        finish(proc.exitCode !== null);
      }
    } else {
      finish(true);
    }
  });
}

function unavailableCliProviderDiscovery(
  status: GuiProviderDiscoveryStatus,
  reason: string,
  authState: GuiProviderAuthState,
): GuiCliProviderModelDiscovery {
  return {
    models: [],
    status,
    reason,
    authState,
  };
}

function isJsonRpcErrorMessage(message: Record<string, unknown>): message is {
  readonly error: { readonly message?: unknown };
} {
  return typeof message.error === "object" && message.error !== null;
}

function classifyCodexCliAppServerError(error: { readonly message?: unknown }): GuiCliProviderModelDiscovery {
  const message = typeof error.message === "string" ? error.message : "";
  if (/(auth|login|unauthori[sz]ed|forbidden|token|credential)/i.test(message)) {
    return unavailableCliProviderDiscovery(
      "missing_auth",
      "Codex CLI authentication is missing or expired.",
      "missing",
    );
  }
  if (isCodexModelVersionUnsupportedMessage(message)) {
    return unavailableCliProviderDiscovery(
      "model_version_unsupported",
      `Codex CLI model support is out of date: ${message.trim()}`,
      "authenticated",
    );
  }
  return unavailableCliProviderDiscovery(
    "endpoint_error",
    message.trim().length > 0
      ? `Codex app-server error: ${message.trim()}`
      : "Codex app-server returned an error.",
    "unknown",
  );
}

function isCodexModelVersionUnsupportedMessage(message: string): boolean {
  return /model requires a newer version of Codex/i.test(message);
}

function writeJsonLine(stdin: { write: (chunk: string) => unknown }, message: unknown): boolean {
  try {
    stdin.write(JSON.stringify(message) + "\n");
    return true;
  } catch {
    return false;
  }
}

function bindWritableError(stdin: { on?: (event: "error", listener: () => void) => unknown }, listener: () => void): void {
  stdin.on?.("error", listener);
}

function homeExecutableCandidates(relativePaths: readonly string[]): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) {
    return [];
  }
  return relativePaths.map((relativePath) => join(home, ...relativePath.split(/[\\/]+/u)));
}

const CLI_VERSION_PATTERN = /\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/u;

interface ExecutableProbe {
  readonly path: string;
  readonly version: string | undefined;
}

/**
 * The only place a candidate list is probed.  Callers differ in what they
 * accept -- a bare path is enough to launch a CLI, while Claude admission also
 * needs a reported version -- but they must not differ in resolution order, so
 * every resolver expresses that difference as `accept` instead of its own loop.
 */
function resolveExecutable(
  candidates: readonly string[],
  accept: (probe: ExecutableProbe) => boolean,
): ExecutableProbe | undefined {
  for (const candidate of candidates) {
    try {
      // stdout is captured because a version is what distinguishes callers;
      // stdin and stderr stay discarded so a chatty shim cannot make a probe
      // fail on buffered output it was never asked to produce.
      const output = execFileSync(candidate, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(candidate),
      });
      const probe: ExecutableProbe = { path: candidate, version: output.match(CLI_VERSION_PATTERN)?.[0] };
      if (accept(probe)) {
        return probe;
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function findExecutable(candidates: readonly string[]): string | undefined {
  return resolveExecutable(candidates, () => true)?.path;
}

export function providerRequiresSelectedModelMessage(provider: string): string {
  return `Provider '${provider}' requires a selected model.`;
}

export function buildWelcomeProviderDescriptors(
  discoveryOrModels: readonly GuiProviderDiscoveryResult[] | Record<string, string[]>,
): GuiProviderDescriptor[] {
  if (Array.isArray(discoveryOrModels)) {
    return discoveryOrModels.flatMap((entry) => {
      const meta = getGuiProviderMetadata(entry.provider);
      if (!meta) {
        return [];
      }
      return {
        id: entry.provider,
        label: meta.label,
        group: meta.group,
        free: meta.free,
        models: [...entry.models],
        available: entry.available,
        status: entry.status,
        reason: entry.reason,
        authState: entry.authState,
        lastCheckedAt: entry.lastCheckedAt,
      } satisfies GuiProviderDescriptor;
    });
  }

  const models = discoveryOrModels as Record<string, string[]>;
  return GUI_PROVIDER_DISPLAY_ORDER.flatMap((id) => {
    const meta = getGuiProviderMetadata(id);
    if (!meta) {
      return [];
    }
    if (!Object.prototype.hasOwnProperty.call(models, id)) {
      return [];
    }
    const providerModels = isGuiProviderModeless(id) ? [] : normalizeModelIds(models[id] ?? []);
    if (!providerModels || (providerModels.length === 0 && !isGuiProviderModeless(id))) {
      return [];
    }
    return {
      id,
      label: meta.label,
      group: meta.group,
      free: meta.free,
      models: providerModels,
      available: true,
    } satisfies GuiProviderDescriptor;
  });
}
