export type ProviderCategory = "subscription" | "harness" | "direct-api";

export interface ProviderMeta {
  readonly id: string;
  readonly label: string;
  readonly category: ProviderCategory;
  readonly free?: boolean;
}

export const PROVIDER_METADATA: Record<string, ProviderMeta> = {
  claude: {
    id: "claude",
    label: "Claude",
    category: "harness",
    free: false,
  },
  codex: {
    id: "codex",
    label: "Codex",
    category: "harness",
    free: false,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    category: "harness",
    free: false,
  },
  "codex-oauth": {
    id: "codex-oauth",
    label: "Codex OAuth",
    category: "subscription",
    free: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    category: "direct-api",
    free: false,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    category: "direct-api",
    free: false,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    category: "direct-api",
    free: false,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    category: "direct-api",
    free: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    category: "direct-api",
    free: true,
  },
};

export const PROVIDER_DISPLAY_ORDER = Object.keys(PROVIDER_METADATA);
