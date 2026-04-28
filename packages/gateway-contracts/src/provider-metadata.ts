import type { GuiProviderDescriptor } from "./frames.js";

export type GuiProviderGroup = GuiProviderDescriptor["group"];

export interface GuiProviderMetadata {
  readonly id: string;
  readonly label: string;
  readonly group: GuiProviderGroup;
  readonly free: boolean;
  readonly modelSelection?: "required" | "none";
}

export const GUI_PROVIDER_METADATA = {
  claude: {
    id: "claude",
    label: "Claude",
    group: "harness",
    free: false,
    modelSelection: "none",
  },
  codex: {
    id: "codex",
    label: "Codex",
    group: "harness",
    free: false,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    group: "harness",
    free: false,
  },
  "opencode-go": {
    id: "opencode-go",
    label: "OpenCode Go",
    group: "subscription",
    free: true,
  },
  "opencode-zen": {
    id: "opencode-zen",
    label: "OpenCode Zen",
    group: "direct-api",
    free: false,
  },
  "codex-oauth": {
    id: "codex-oauth",
    label: "Codex OAuth",
    group: "subscription",
    free: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    group: "direct-api",
    free: false,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    group: "direct-api",
    free: false,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    group: "direct-api",
    free: false,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    group: "direct-api",
    free: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    group: "direct-api",
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
