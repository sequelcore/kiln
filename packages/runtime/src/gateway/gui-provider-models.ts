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
  const cliModels = await discoverGuiCliOperatorModels();
  const directProviderDiscovery = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
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
      results.push({
        provider,
        available,
        models: available ? directModels : [],
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
): Promise<Record<string, GuiCliProviderModelDiscovery>> {
  const openCodeDirectDiscovery = await discoverOpenCodeDirectModelDiscovery(providerAvailability);
  const openAiDiscovery = await discoverOpenAiModelDiscovery(providerAvailability.openai);
  const anthropicDiscovery = await discoverAnthropicModelDiscovery(providerAvailability.anthropic);
  const deepSeekDiscovery = await discoverDeepSeekModelDiscovery(providerAvailability.deepseek);
  const openRouterDiscovery = await discoverOpenRouterModelDiscovery(providerAvailability.openrouter);
  const ollamaDiscovery = await discoverOllamaModelDiscovery(providerAvailability.ollama);
  const codexOauthDiscovery = await discoverCodexOauthModelDiscovery(providerAvailability["codex-oauth"]);
  return Object.fromEntries([
    ...(codexOauthDiscovery ? [["codex-oauth", codexOauthDiscovery] as const] : []),
    ...(openAiDiscovery ? [["openai", openAiDiscovery] as const] : []),
    ...(anthropicDiscovery ? [["anthropic", anthropicDiscovery] as const] : []),
    ...(deepSeekDiscovery ? [["deepseek", deepSeekDiscovery] as const] : []),
    ...(openRouterDiscovery ? [["openrouter", openRouterDiscovery] as const] : []),
    ...(ollamaDiscovery ? [["ollama", ollamaDiscovery] as const] : []),
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
  let data: { readonly data?: unknown; readonly models?: unknown } | undefined;
  try {
    const response = await fetch("https://chatgpt.com/backend-api/codex/models", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
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
  } catch {
    return unavailableCliProviderDiscovery(
      "endpoint_error",
      "Codex OAuth model endpoint failed.",
      "unknown",
    );
  }
  const modelSource = Array.isArray(data?.models) ? data.models : data?.data;
  const models = normalizeModelIds(Array.isArray(modelSource)
    ? modelSource.flatMap((entry) => {
      if (typeof entry?.slug === "string") {
        return [entry.slug];
      }
      if (typeof entry?.id === "string") {
        return [entry.id];
      }
      return [];
    })
    : []);
  return models.length > 0
    ? {
        models,
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

async function discoverOpenAiModelDiscovery(
  available: boolean | undefined,
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const token = process.env.OPENAI_API_KEY?.trim() ?? "";
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
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const token = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
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
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const token = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
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
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  const token = process.env.OPENROUTER_API_KEY?.trim() ?? "";
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
): Promise<GuiCliProviderModelDiscovery | undefined> {
  if (available !== true) {
    return undefined;
  }
  let parsed: { readonly models?: unknown } | undefined;
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
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

async function discoverOpenCodeDirectModelDiscovery(
  providerAvailability: Readonly<Record<string, boolean>>,
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
  const envToken = process.env.OPENCODE_API_KEY?.trim() ?? "";
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
                writeJsonLine(proc.stdin, { method: "initialized" });
                writeJsonLine(proc.stdin, {
                  method: "model/list",
                  id: CODEX_APP_SERVER_MODEL_LIST_REQUEST_ID,
                  params: { limit: 100, includeHidden: false },
                });
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

function writeJsonLine(stdin: { write: (chunk: string) => unknown }, message: unknown): void {
  stdin.write(JSON.stringify(message) + "\n");
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
