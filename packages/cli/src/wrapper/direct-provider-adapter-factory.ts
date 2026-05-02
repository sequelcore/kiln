import {
  OpenCodeAdapter,
  type DirectProviderId,
  type ProviderAdapter,
} from "@kilnai/core";
import type { OpenCodeTier } from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  DirectProviderCredentialPoolService,
  OpenCodeCredentialPoolService,
  isPooledDirectProviderId,
} from "@kilnai/runtime";

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

const DIRECT_PROVIDER_ADAPTERS: Readonly<Record<DirectProviderId, DirectProviderAdapterDefinition>> = {
  "codex-oauth": {
    create: (context) => new CodexOAuthCredentialPoolService().createPooledAdapter({
      defaultModel: requireSelectedModel(context),
    }),
  },
  anthropic: {
    create: createPooledDirectProviderAdapter,
  },
  openai: {
    create: createPooledDirectProviderAdapter,
  },
  deepseek: {
    create: createPooledDirectProviderAdapter,
  },
  openrouter: {
    create: createPooledDirectProviderAdapter,
  },
  ollama: {
    create: createPooledDirectProviderAdapter,
  },
  lmstudio: {
    create: createPooledDirectProviderAdapter,
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
  return await definition.create({
    provider: options.provider,
    model: options.model,
    resolveEnv,
  });
}

async function createPooledDirectProviderAdapter(
  context: DirectProviderAdapterContext,
): Promise<ProviderAdapter> {
  if (!isPooledDirectProviderId(context.provider)) {
    throw new Error(`Unsupported pooled direct provider: ${context.provider}`);
  }
  const service = new DirectProviderCredentialPoolService({
    env: {
      ANTHROPIC_API_KEY: context.resolveEnv("ANTHROPIC_API_KEY"),
      OPENAI_API_KEY: context.resolveEnv("OPENAI_API_KEY"),
      DEEPSEEK_API_KEY: context.resolveEnv("DEEPSEEK_API_KEY"),
      OPENROUTER_API_KEY: context.resolveEnv("OPENROUTER_API_KEY"),
      OLLAMA_BASE_URL: context.resolveEnv("OLLAMA_BASE_URL"),
      LMSTUDIO_API_KEY: context.resolveEnv("LMSTUDIO_API_KEY"),
      LMSTUDIO_BASE_URL: context.resolveEnv("LMSTUDIO_BASE_URL"),
    },
  });
  const status = await service.listStatus(context.provider);
  if (status.length === 0) {
    throw new Error(`Missing required credentials for ${context.provider}`);
  }
  return await service.createPooledAdapter({
    provider: context.provider,
    defaultModel: context.model,
    openRouterAppUrl: context.resolveEnv("OPENROUTER_APP_URL"),
    openRouterAppName: context.resolveEnv("OPENROUTER_APP_NAME"),
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
