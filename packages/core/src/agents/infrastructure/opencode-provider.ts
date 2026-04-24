import { OpenAICompatAdapter } from "./openai-compat.js";
import { OpenCodeAuth, type OpenCodeTier } from "./opencode-auth.js";
import { KilnError } from "../../engine/errors.js";

export const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";

export const OPENCODE_GO_DEFAULT_MODEL = "minimax-m2.5";
export const OPENCODE_ZEN_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

export const OPENCODE_GO_MODELS = [
  "minimax-m2.5",
  "minimax-m2.7",
  "glm-5",
  "glm-5.1",
  "kimi-k2.5",
  "kimi-k2.6",
  "mimo-v2-pro",
  "mimo-v2-omni",
  "mimo-v2.5-pro",
  "mimo-v2.5",
  "qwen3.5-plus",
  "qwen3.6-plus",
] as const;

export const OPENCODE_ZEN_MODELS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.4",
  "google/gemini-2.5-pro",
] as const;

export interface OpenCodeAdapterConfig {
  readonly apiKey: string;
  readonly tier: OpenCodeTier;
  readonly defaultModel?: string;
}

export class OpenCodeAdapter extends OpenAICompatAdapter {
  readonly tier: OpenCodeTier;
  readonly defaultModel: string;

  constructor(config: OpenCodeAdapterConfig) {
    const defaultModel =
      config.defaultModel ??
      (config.tier === "zen" ? OPENCODE_ZEN_DEFAULT_MODEL : OPENCODE_GO_DEFAULT_MODEL);
    super({
      apiKey: config.apiKey,
      baseUrl: OPENCODE_BASE_URL,
      defaultModel,
      providerName: config.tier === "zen" ? "opencode-zen" : "opencode-go",
    });
    this.tier = config.tier;
    this.defaultModel = defaultModel;
  }

  static async fromAuth(opts?: {
    auth?: OpenCodeAuth;
    defaultModel?: string;
  }): Promise<OpenCodeAdapter> {
    const auth = opts?.auth ?? new OpenCodeAuth();
    const file = await auth.loadAuthFile();
    if (!file) {
      throw new KilnError("PROVIDER_AUTH_FAILED", "OpenCode auth file not found", {
        context: { hint: "run `kiln auth opencode link`" },
      });
    }
    return new OpenCodeAdapter({
      apiKey: file.api_key,
      tier: file.tier,
      defaultModel: opts?.defaultModel,
    });
  }
}

export class OpenCodeRateLimitError extends KilnError {
  readonly resetAt?: Date;
  readonly provider: "opencode-go" | "opencode-zen";
  constructor(
    message: string,
    context: { status: number; resetAt?: Date; provider: "opencode-go" | "opencode-zen" },
  ) {
    super("PROVIDER_RATE_LIMITED", message, {
      context: { ...context, retryable: true },
    });
    this.resetAt = context.resetAt;
    this.provider = context.provider;
  }
}

export class OpenCodeQuotaError extends KilnError {
  readonly provider: "opencode-go" | "opencode-zen";
  constructor(
    message: string,
    context: { status: number; provider: "opencode-go" | "opencode-zen" },
  ) {
    super("PROVIDER_QUOTA_EXCEEDED", message, {
      context: { ...context, retryable: false },
    });
    this.provider = context.provider;
  }
}