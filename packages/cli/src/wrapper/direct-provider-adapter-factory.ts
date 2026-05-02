import {
  AnthropicAdapter,
  CodexOAuthAdapter,
  CodexOAuthAuth,
  DeepSeekAdapter,
  OllamaAdapter,
  OpenAIAdapter,
  OpenCodeAdapter,
  OpenRouterAdapter,
  type DirectProviderId,
  type ProviderAdapter,
} from "@kilnai/core";
import type { OpenCodeTier } from "@kilnai/core";
import { OpenCodeCredentialPoolService } from "@kilnai/runtime";

type EnvMap = Readonly<Record<string, string | undefined>>;

export interface DirectProviderAdapterOptions {
  readonly provider: DirectProviderId;
  readonly model?: string;
  readonly configEnv?: EnvMap;
  readonly runtimeEnv?: EnvMap;
  readonly processEnv?: EnvMap;
}

interface DirectProviderAdapterContext {
  readonly provider: DirectProviderId;
  readonly model?: string;
  readonly resolveEnv: (name: string) => string | undefined;
  readonly requireApiKey: (name: string) => string;
}

type DirectProviderAdapterDefinition = {
  readonly create: (context: DirectProviderAdapterContext) => ProviderAdapter | Promise<ProviderAdapter>;
};

function requireSelectedModel(context: DirectProviderAdapterContext): string {
  const model = context.model?.trim();
  if (!model) {
    throw new Error(`Direct provider '${context.provider}' requires a non-empty configured model`);
  }
  return model;
}

function createApiKeyAdapter(
  envName: string,
  create: (apiKey: string, context: DirectProviderAdapterContext) => ProviderAdapter,
): DirectProviderAdapterDefinition {
  return {
    create: (context) => create(context.requireApiKey(envName), context),
  };
}

const DIRECT_PROVIDER_ADAPTERS: Readonly<Record<DirectProviderId, DirectProviderAdapterDefinition>> = {
  "codex-oauth": {
    create: (context) => new CodexOAuthAdapter({
      auth: new CodexOAuthAuth(),
      defaultModel: requireSelectedModel(context),
    }),
  },
  anthropic: createApiKeyAdapter(
    "ANTHROPIC_API_KEY",
    (apiKey, context) => new AnthropicAdapter({
      apiKey,
      defaultModel: context.model,
    }),
  ),
  openai: createApiKeyAdapter(
    "OPENAI_API_KEY",
    (apiKey, context) => new OpenAIAdapter({
      apiKey,
      defaultModel: context.model,
    }),
  ),
  deepseek: createApiKeyAdapter(
    "DEEPSEEK_API_KEY",
    (apiKey, context) => new DeepSeekAdapter({
      apiKey,
      defaultModel: context.model,
    }),
  ),
  openrouter: createApiKeyAdapter(
    "OPENROUTER_API_KEY",
    (apiKey, context) => new OpenRouterAdapter({
      apiKey,
      defaultModel: context.model,
      appUrl: context.resolveEnv("OPENROUTER_APP_URL"),
      appName: context.resolveEnv("OPENROUTER_APP_NAME"),
    }),
  ),
  ollama: {
    create: (context) => new OllamaAdapter({
      baseUrl: context.resolveEnv("OLLAMA_BASE_URL"),
      defaultModel: context.model,
    }),
  },
  "opencode-go": {
    create: (context) => createOpenCodeAdapter("go", context),
  },
  "opencode-zen": {
    create: (context) => createOpenCodeAdapter("zen", context),
  },
};

export async function createDirectProviderAdapter(
  options: DirectProviderAdapterOptions,
): Promise<ProviderAdapter> {
  const definition = DIRECT_PROVIDER_ADAPTERS[options.provider];
  if (!definition) {
    throw new Error(`Unsupported direct provider: ${options.provider}`);
  }

  const processEnv = options.processEnv ?? process.env;
  const resolveEnv = (name: string): string | undefined =>
    options.runtimeEnv?.[name] ?? options.configEnv?.[name] ?? processEnv[name];
  const requireApiKey = (name: string): string => {
    const apiKey = resolveEnv(name);
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(`Missing required API key for ${options.provider}: ${name}`);
    }
    return apiKey;
  };

  return await definition.create({
    provider: options.provider,
    model: options.model,
    resolveEnv,
    requireApiKey,
  });
}

async function createOpenCodeAdapter(
  tier: OpenCodeTier,
  context: DirectProviderAdapterContext,
): Promise<ProviderAdapter> {
  const envApiKey = context.resolveEnv("OPENCODE_API_KEY");
  if (envApiKey && envApiKey.trim().length > 0) {
    return new OpenCodeAdapter({
      apiKey: envApiKey,
      tier,
      defaultModel: requireSelectedModel(context),
    });
  }

  const service = new OpenCodeCredentialPoolService();
  const status = await service.listStatus();
  if (!status.some((entry) => entry.tier === tier)) {
    throw new Error(`Missing required API key for ${context.provider}: OPENCODE_API_KEY`);
  }

  return await service.createPooledAdapter({
    tier,
    defaultModel: requireSelectedModel(context),
  });
}
