import { OpenAICompatAdapter } from "./openai-compat.js";
import { OpenCodeAuth, type OpenCodeTier } from "./opencode-auth.js";
import { KilnError } from "../../engine/errors.js";

export const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";

export interface OpenCodeAdapterConfig {
  readonly apiKey: string;
  readonly tier: OpenCodeTier;
  readonly defaultModel: string;
}

export class OpenCodeAdapter extends OpenAICompatAdapter {
  readonly tier: OpenCodeTier;
  readonly defaultModel: string;

  constructor(config: OpenCodeAdapterConfig) {
    const defaultModel = config.defaultModel.trim();
    if (defaultModel.length === 0) {
      throw new KilnError("CONFIG_INVALID", "OpenCode adapter requires a selected model");
    }
    super({
      apiKey: config.apiKey,
      baseUrl: OPENCODE_BASE_URL,
      defaultModel,
      providerName: config.tier === "zen" ? "opencode-zen" : "opencode-go",
    });
    this.tier = config.tier;
    this.defaultModel = defaultModel;
  }

  static async fromAuth(opts: {
    auth?: OpenCodeAuth;
    defaultModel: string;
  }): Promise<OpenCodeAdapter> {
    const auth = opts.auth ?? new OpenCodeAuth();
    const file = await auth.loadAuthFile();
    if (!file) {
      throw new KilnError("PROVIDER_AUTH_FAILED", "OpenCode auth file not found", {
        context: { hint: "run `kiln auth opencode link`" },
      });
    }
    return new OpenCodeAdapter({
      apiKey: file.api_key,
      tier: file.tier,
      defaultModel: opts.defaultModel,
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
