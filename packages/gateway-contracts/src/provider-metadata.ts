import type { GuiProviderDescriptor } from "./frames.js";

export type GuiProviderGroup = GuiProviderDescriptor["group"];
export type GuiProviderAccess = "subscription" | "harness" | "api" | "local";

export interface GuiProviderMetadata {
  readonly id: string;
  readonly label: string;
  readonly brandId: string;
  readonly group: GuiProviderGroup;
  readonly access: GuiProviderAccess;
  readonly free: boolean;
  readonly modelSelection?: "required" | "none";
  readonly authMethod?: "device_code" | "api_key";
  readonly authTier?: "go" | "zen";
}

export const GUI_PROVIDER_METADATA = {
  claude: {
    id: "claude",
    label: "Claude",
    brandId: "claude",
    group: "harness",
    access: "harness",
    free: false,
    modelSelection: "none",
  },
  codex: {
    id: "codex",
    label: "Codex",
    brandId: "codex",
    group: "harness",
    access: "harness",
    free: false,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    brandId: "opencode",
    group: "harness",
    access: "harness",
    free: false,
  },
  "opencode-go": {
    id: "opencode-go",
    label: "OpenCode Go",
    brandId: "opencode",
    group: "subscription",
    access: "subscription",
    free: true,
    authMethod: "api_key",
    authTier: "go",
  },
  "opencode-zen": {
    id: "opencode-zen",
    label: "OpenCode Zen",
    brandId: "opencode",
    group: "direct-api",
    access: "api",
    free: false,
    authMethod: "api_key",
    authTier: "zen",
  },
  "codex-oauth": {
    id: "codex-oauth",
    label: "Codex OAuth",
    brandId: "codex",
    group: "subscription",
    access: "subscription",
    free: true,
    authMethod: "device_code",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    brandId: "anthropic",
    group: "direct-api",
    access: "api",
    free: false,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    brandId: "openai",
    group: "direct-api",
    access: "api",
    free: false,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    brandId: "deepseek",
    group: "direct-api",
    access: "api",
    free: false,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    brandId: "openrouter",
    group: "direct-api",
    access: "api",
    free: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    brandId: "ollama",
    group: "direct-api",
    access: "local",
    free: true,
  },
  lmstudio: {
    id: "lmstudio",
    label: "LM Studio",
    brandId: "lmstudio",
    group: "direct-api",
    access: "local",
    free: true,
  },
} as const satisfies Readonly<Record<string, GuiProviderMetadata>>;

export const GUI_PROVIDER_DISPLAY_ORDER = Object.keys(GUI_PROVIDER_METADATA);

export function getGuiProviderMetadata(providerId: string): GuiProviderMetadata | undefined {
  const metadataById: Readonly<Record<string, GuiProviderMetadata>> = GUI_PROVIDER_METADATA;
  return metadataById[providerId];
}

export function isGuiProviderModeless(providerId: string): boolean {
  return getGuiProviderMetadata(providerId)?.modelSelection === "none";
}
