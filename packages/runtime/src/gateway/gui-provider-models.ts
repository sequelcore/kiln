import { execSync } from "node:child_process";
import {
  CodexOAuthAuth,
  OpenCodeAuth,
  OPENCODE_BASE_URL,
} from "@kilnai/core";
import {
  GUI_PROVIDER_DISPLAY_ORDER,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  type GuiProviderAuthState,
  type GuiProviderDescriptor,
  type GuiProviderDiscoveryResult,
  type GuiProviderDiscoveryStatus,
  type GuiProviderModelCapabilities,
  type GuiProviderReasoningEffort,
} from "@kilnai/gateway-contracts";

const KNOWN_GUI_PROVIDER_IDS = new Set<string>(GUI_PROVIDER_DISPLAY_ORDER);

export interface GuiCliOperatorModelDiscovery {
  readonly opencodeModels: string[];
  readonly opencodeDiscovery: GuiCliProviderModelDiscovery;
  readonly codexModels: string[];
  readonly codexDiscovery: GuiCliProviderModelDiscovery;
}

export interface GuiCliProviderModelDiscovery {
  readonly models: string[];
  readonly modelCapabilities?: Readonly<Record<string, GuiProviderModelCapabilities>>;
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

const OPENCODE_GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
const OPENCODE_ZEN_MODELS_URL = `${OPENCODE_BASE_URL}/models`;
const CODEX_OAUTH_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const CODEX_OAUTH_MODEL_DISCOVERY_TIMEOUT_MS = 5_000;
const CODEX_OAUTH_MODEL_DISCOVERY_CACHE_TTL_MS = 30_000;
const CODEX_OAUTH_MODELS_CLIENT_VERSION =
  process.env.KILN_CODEX_OAUTH_CLIENT_VERSION?.trim() || "1.0.7";
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

export async function discoverGuiCliOperatorModels(): Promise<GuiCliOperatorModelDiscovery> {
  const [opencodeDiscovery, codexDiscovery] = await Promise.all([
    discoverOpencodeCliModelDiscovery(),
    discoverCodexCliModelDiscovery(),
  ]);
  return {
    opencodeModels: opencodeDiscovery.models,
    opencodeDiscovery,
    codexModels: codexDiscovery.models,
    codexDiscovery,
  };
}

export async function resolveGuiOperatorDiscoveryResults(
  providerAvailability: Readonly<Record<string, boolean>>,
): Promise<GuiProviderDiscoveryResult[]> {
  const [cliModels, directProviderDiscovery] = await Promise.all([
    discoverGuiCliOperatorModels(),
    discoverGuiDirectProviderModelDiscovery(providerAvailability),
  ]);
  return buildGuiOperatorDiscoveryResults({
    opencodeModels: cliModels.opencodeModels,
    opencodeDiscovery: cliModels.opencodeDiscovery,
    codexModels: cliModels.codexModels,
    codexDiscovery: cliModels.codexDiscovery,
    providerAvailability,
    directProviderDiscovery,
  });
}

export function buildGuiOperatorDiscoveryResults(input: {
  readonly opencodeModels: readonly string[];
  readonly opencodeDiscovery?: GuiCliProviderModelDiscovery;
  readonly codexModels: readonly string[];
  readonly codexDiscovery?: GuiCliProviderModelDiscovery;
  readonly providerAvailability?: Readonly<Record<string, boolean>>;
  readonly directProviderDiscovery?: Readonly<Record<string, GuiCliProviderModelDiscovery>>;
  readonly lastCheckedAt?: string;
}): GuiProviderDiscoveryResult[] {
  const discoveredModelsByProvider: Record<string, readonly string[]> = {
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

    if (provider === "opencode" && input.opencodeDiscovery) {
      const opencodeModels = normalizeModelIds(input.opencodeDiscovery.models);
      const available = input.opencodeDiscovery.status === "available" && opencodeModels.length > 0;
      const status = available ? "available" : input.opencodeDiscovery.status;
      results.push({
        provider,
        available,
        models: available ? opencodeModels : [],
        status,
        reason: input.opencodeDiscovery.reason,
        authState: input.opencodeDiscovery.authState,
        lastCheckedAt,
      });
      continue;
    }

    if (provider === "codex" && input.codexDiscovery) {
      const codexModels = normalizeModelIds(input.codexDiscovery.models);
      const available = input.codexDiscovery.status === "available" && codexModels.length > 0;
      const status = available ? "available" : input.codexDiscovery.status;
      results.push({
        provider,
        available,
        models: available ? codexModels : [],
        status,
        reason: input.codexDiscovery.reason,
        authState: input.codexDiscovery.authState,
        lastCheckedAt,
      });
      continue;
    }

    const directDiscovery = input.directProviderDiscovery?.[provider];
    if (directDiscovery) {
      const directModels = normalizeModelIds(directDiscovery.models);
      const available = (
        directDiscovery.status === "available"
        && directModels.length > 0
        && availability !== false
      );
      const status = available ? "available" : directDiscovery.status;
      const modelCapabilities = available
        ? filterModelCapabilities(directDiscovery.modelCapabilities, directModels)
        : undefined;
      results.push({
        provider,
        available,
        models: available ? directModels : [],
        ...(modelCapabilities ? { modelCapabilities } : {}),
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
    discoverOpenCodeDirectModelDiscovery(providerAvailability, env),
    discoverOpenAiModelDiscovery(providerAvailability.openai, env),
    discoverAnthropicModelDiscovery(providerAvailability.anthropic, env),
    discoverDeepSeekModelDiscovery(providerAvailability.deepseek, env),
    discoverOpenRouterModelDiscovery(providerAvailability.openrouter, env),
    discoverOllamaModelDiscovery(providerAvailability.ollama, env),
    discoverLmStudioModelDiscovery(providerAvailability.lmstudio, env),
    discoverCodexOauthModelDiscovery(providerAvailability["codex-oauth"]),
  ]);
  return Object.fromEntries([
    ...(codexOauthDiscovery ? [["codex-oauth", codexOauthDiscovery] as const] : []),
    ...(openAiDiscovery ? [["openai", openAiDiscovery] as const] : []),
    ...(anthropicDiscovery ? [["anthropic", anthropicDiscovery] as const] : []),
    ...(deepSeekDiscovery ? [["deepseek", deepSeekDiscovery] as const] : []),
    ...(openRouterDiscovery ? [["openrouter", openRouterDiscovery] as const] : []),
    ...(ollamaDiscovery ? [["ollama", ollamaDiscovery] as const] : []),
    ...(lmStudioDiscovery ? [["lmstudio", lmStudioDiscovery] as const] : []),
    ...Object.entries(openCodeDirectDiscovery),
  ]);
}

async function discoverCodexOauthModelDiscovery(
  available: boolean | undefined,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  let token = "";
  try {
    token = await new CodexOAuthAuth().getValidAccessToken();
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
  if (token.length === 0) {
    return unavailableCliProviderDiscovery(
      "missing_auth",
      "Codex OAuth authentication is missing.",
      "missing",
    );
  }
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
      codexOauthModelDebug("model endpoint non-ok body", {
        body: await responseDebugBody(response),
      });
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

function countCodexOauthModelCapabilityEntries(entries: readonly unknown[]): number {
  let count = 0;
  for (const entry of entries) {
    const record = asRecord(entry);
    if (record && Object.keys(readCodexOauthModelCapabilities(record)).length > 0) {
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
    const capability = readCodexOauthModelCapabilities(record);
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
  const defaultReasoningEffort =
    readReasoningEffort(record.default_reasoning_effort)
    ?? readReasoningEffort(record.defaultReasoningEffort)
    ?? readReasoningEffort(record.default_reasoning_level)
    ?? readReasoningEffort(record.defaultReasoningLevel);
  const supportedReasoningEfforts =
    readReasoningEffortArray(record.supported_reasoning_efforts)
    ?? readReasoningEffortArray(record.supportedReasoningEfforts)
    ?? readReasoningEffortArray(record.supported_reasoning_levels)
    ?? readReasoningEffortArray(record.supportedReasoningLevels);

  return {
    ...(supportsFunctionTools !== undefined ? { supportsFunctionTools } : {}),
    ...(supportsRuntimeTools !== undefined ? { supportsRuntimeTools } : {}),
    ...(supportsNativeShellTools !== undefined ? { supportsNativeShellTools } : {}),
    ...(supportsNativePatchTools !== undefined ? { supportsNativePatchTools } : {}),
    ...(supportsRuntimeTools !== undefined ? { supportsTools: supportsRuntimeTools } : {}),
    ...(supportsParallelToolCalls !== undefined ? { supportsParallelToolCalls } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(supportsVision !== undefined ? { supportsVision } : {}),
    ...(defaultReasoningEffort !== undefined ? { defaultReasoningEffort } : {}),
    ...(supportedReasoningEfforts !== undefined ? { supportedReasoningEfforts } : {}),
  };
}

function readReasoningEffort(value: unknown): GuiProviderReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "minimal"
    || normalized === "low"
    || normalized === "medium"
    || normalized === "high"
    || normalized === "xhigh"
  ) {
    return normalized;
  }
  if (normalized === "extra_high" || normalized === "extra-high") {
    return "xhigh";
  }
  return undefined;
}

function readReasoningEffortArray(value: unknown): readonly GuiProviderReasoningEffort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const efforts: GuiProviderReasoningEffort[] = [];
  const seen = new Set<GuiProviderReasoningEffort>();
  for (const entry of value) {
    const record = asRecord(entry);
    const effort = readReasoningEffort(entry)
      ?? readReasoningEffort(record?.effort)
      ?? readReasoningEffort(record?.value)
      ?? readReasoningEffort(record?.id);
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    efforts.push(effort);
  }
  return efforts.length > 0 ? efforts : undefined;
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
  const auth = new OpenCodeAuth();
  const authFile = await auth.loadAuthFile().catch(() => null);
  const envToken = env.OPENCODE_API_KEY?.trim() ?? "";
  if (envToken.length > 0) {
    return Object.fromEntries(await Promise.all(
      targets.map(async (target) => [
        target.provider,
        await discoverOpenCodeDirectProviderModels(target, envToken),
      ] as const),
    ));
  }

  const fileToken = authFile?.api_key?.trim() ?? "";
  if (fileToken.length === 0) {
    return Object.fromEntries(targets.map((target) => [
      target.provider,
      unavailableCliProviderDiscovery(
        "missing_auth",
        "OpenCode API key is missing.",
        "missing",
      ),
    ] as const));
  }

  return Object.fromEntries(await Promise.all(
    targets.map(async (target) => {
      if (authFile?.tier !== target.tier) {
        return [
          target.provider,
          unavailableCliProviderDiscovery(
            "missing_auth",
            `Stored OpenCode auth is for ${openCodeTierLabel(authFile?.tier)}, not ${target.label}.`,
            "missing",
          ),
        ] as const;
      }
      return [
        target.provider,
        await discoverOpenCodeDirectProviderModels(target, fileToken),
      ] as const;
    }),
  ));
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

function openCodeTierLabel(tier: string | undefined): string {
  if (tier === "go") return "OpenCode Go";
  if (tier === "zen") return "OpenCode Zen";
  return "an unknown OpenCode tier";
}

export async function discoverOpencodeCliModelDiscovery(): Promise<GuiCliProviderModelDiscovery> {
  const executable = findExecutable([
    "opencode",
    "opencode.exe",
    ...homeExecutableCandidates([
      ".bun\\bin\\opencode.exe",
      "AppData\\Roaming\\npm\\opencode.cmd",
    ]),
  ]);
  if (!executable) {
    return unavailableCliProviderDiscovery(
      "cli_missing",
      "OpenCode CLI executable was not found.",
      "not_required",
    );
  }
  try {
    const output = execSync(`"${executable}" models`, { encoding: "utf8" });
    const models = normalizeModelIds(output.split("\n"));
    return models.length > 0
      ? {
          models,
          status: "available",
          reason: "OpenCode CLI models discovered.",
          authState: "authenticated",
        }
      : unavailableCliProviderDiscovery(
          "empty_model_list",
          "OpenCode CLI returned an empty model list.",
          "unknown",
        );
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "OpenCode CLI models command failed.",
      "unknown",
    );
  }
}

const CODEX_APP_SERVER_INITIALIZE_REQUEST_ID = 1;
const CODEX_APP_SERVER_MODEL_LIST_REQUEST_ID = 2;
const CODEX_APP_SERVER_MODEL_DISCOVERY_TIMEOUT_MS = 5_000;

export async function discoverCodexCliModelDiscovery(): Promise<GuiCliProviderModelDiscovery> {
  const executable = findExecutable([
    "codex",
    ...homeExecutableCandidates([
      "AppData\\Roaming\\npm\\codex.cmd",
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
        stdio: ["pipe", "pipe", "ignore"],
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
        proc.kill();
        resolve(result);
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
  return unavailableCliProviderDiscovery(
    "endpoint_error",
    message.trim().length > 0
      ? `Codex app-server error: ${message.trim()}`
      : "Codex app-server returned an error.",
    "unknown",
  );
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
  return relativePaths.map((relativePath) => `${home}\\${relativePath}`);
}

function findExecutable(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" --version`, { stdio: "ignore" });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export type GuiProviderSwitchResolution =
  | {
      readonly ok: true;
      readonly provider: string;
      readonly modelForSessionManager: string;
      readonly modelForAck?: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

export function providerRequiresSelectedModelMessage(provider: string): string {
  return `Provider '${provider}' requires a selected model.`;
}

export function resolveGuiProviderSwitch(input: {
  readonly provider: unknown;
  readonly model: unknown;
  readonly models?: Record<string, string[]>;
  readonly discovery?: readonly GuiProviderDiscoveryResult[];
}): GuiProviderSwitchResolution {
  const nextProvider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (!nextProvider) {
    return {
      ok: false,
      error: "Provider switch request must include a provider id",
    };
  }
  if (!KNOWN_GUI_PROVIDER_IDS.has(nextProvider)) {
    return {
      ok: false,
      error: `Provider '${nextProvider}' is unknown`,
    };
  }

  const discoveryResult = input.discovery?.find((entry) => entry.provider === nextProvider);
  if (discoveryResult && !discoveryResult.available) {
    return {
      ok: false,
      error: discoveryResult.reason,
    };
  }
  const discoveredProviderModels = discoveryResult
    ? [...discoveryResult.models]
    : input.models?.[nextProvider];
  if (discoveredProviderModels === undefined) {
    return {
      ok: false,
      error: `Provider '${nextProvider}' is unavailable`,
    };
  }
  const providerModels = isGuiProviderModeless(nextProvider) ? [] : discoveredProviderModels;
  if (providerModels.length === 0) {
    if (!isGuiProviderModeless(nextProvider)) {
      return {
        ok: false,
        error: `Provider '${nextProvider}' has no available models`,
      };
    }
    const requestedModel = typeof input.model === "string" ? input.model.trim() : "";
    if (requestedModel.length > 0) {
      return {
        ok: false,
        error: `Provider '${nextProvider}' does not advertise model '${requestedModel}'`,
      };
    }
    return {
      ok: true,
      provider: nextProvider,
      modelForSessionManager: "",
    };
  }

  const requestedModel = typeof input.model === "string" ? input.model.trim() : "";
  if (requestedModel.length === 0) {
    return {
      ok: false,
      error: providerRequiresSelectedModelMessage(nextProvider),
    };
  }
  if (!providerModels.includes(requestedModel)) {
    return {
      ok: false,
      error: `Provider '${nextProvider}' does not advertise model '${requestedModel}'`,
    };
  }
  return {
    ok: true,
    provider: nextProvider,
    modelForSessionManager: requestedModel,
    modelForAck: requestedModel,
  };
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
