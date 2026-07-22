import type { ModelGatewayConfig, ModelGatewayPrincipalConfig, ModelGatewayVirtualModelConfig } from "@kilnai/core";

export type ResponsesNativeHarness = "codex" | "opencode";

export interface CodexResponsesProjection {
  readonly patch: Record<string, unknown>;
  readonly managedFields: readonly string[];
  readonly catalog: { readonly models: readonly Record<string, unknown>[] };
}

export interface OpenCodeResponsesProjection {
  readonly patch: Record<string, unknown>;
  readonly managedFields: readonly string[];
}

export interface ClaudeMessagesProjection {
  readonly patch: Record<string, unknown>;
  readonly managedFields: readonly string[];
}

interface ProjectionSource {
  readonly principal: ModelGatewayPrincipalConfig;
  readonly models: readonly NativeProjectedVirtualModel[];
  readonly port: number;
}

type NativeProjectedVirtualModel = ModelGatewayVirtualModelConfig & Required<Pick<ModelGatewayVirtualModelConfig, "displayName" | "contextTokens" | "outputTokens">>;

export function resolveResponsesNativeProjectionSource(
  config: ModelGatewayConfig,
  harness: ResponsesNativeHarness,
): ProjectionSource | undefined {
  const principals = config.principals.filter((principal) => principal.ingress === "openai-responses" && principal.nativeHarness === harness);
  if (principals.length > 1) throw new Error(`modelGateway declares multiple ${harness} native harness principals.`);
  const principal = principals[0];
  if (!principal) return undefined;
  const byId = new Map(config.virtualModels.map((model) => [model.id, model]));
  const models = principal.virtualModelIds.map((id) => {
    const model = byId.get(id);
    if (!model) throw new Error(`${harness} native harness principal references unknown virtual model '${id}'.`);
    if (!hasPickerMetadata(model)) throw new Error(`${harness} native harness model '${id}' is missing validated picker metadata.`);
    return model;
  });
  return { principal, models, port: config.port };
}

export function resolveClaudeMessagesNativeProjectionSource(
  config: ModelGatewayConfig,
): ProjectionSource | undefined {
  const principals = config.principals.filter((principal) => principal.ingress === "anthropic-messages" && principal.nativeHarness === "claude");
  if (principals.length > 1) throw new Error("modelGateway declares multiple claude native harness principals.");
  const principal = principals[0];
  if (!principal) return undefined;
  const byId = new Map(config.virtualModels.map((model) => [model.id, model]));
  const models = principal.virtualModelIds.map((id) => {
    const model = byId.get(id);
    if (!model) throw new Error(`claude native harness principal references unknown virtual model '${id}'.`);
    if (!/^(?:claude|anthropic)[A-Za-z0-9._:-]*$/.test(model.id)) {
      throw new Error(`claude native harness model '${id}' must start with claude or anthropic for gateway discovery.`);
    }
    if (!hasPickerMetadata(model)) throw new Error(`claude native harness model '${id}' is missing validated picker metadata.`);
    return model;
  });
  return { principal, models, port: config.port };
}

const CLAUDE_GATEWAY_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
  CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
  CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
  CLAUDE_CODE_DISABLE_THINKING: "1",
  CLAUDE_CODE_MAX_RETRIES: "0",
  MAX_THINKING_TOKENS: "0",
  DISABLE_INTERLEAVED_THINKING: "1",
  DISABLE_PROMPT_CACHING: "1",
};

export function buildClaudeMessagesProjection(input: {
  readonly config: ModelGatewayConfig;
}): ClaudeMessagesProjection | undefined {
  const source = resolveClaudeMessagesNativeProjectionSource(input.config);
  if (!source) return undefined;
  if (source.principal.tokenEnv !== "ANTHROPIC_AUTH_TOKEN") {
    throw new Error("claude native harness projection requires tokenEnv ANTHROPIC_AUTH_TOKEN.");
  }
  const env = {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${source.port}`,
    ...CLAUDE_GATEWAY_ENV,
  };
  const defaultModel = source.models.length === 1 ? source.models[0]!.id : undefined;
  return {
    patch: { env, ...(defaultModel ? { model: defaultModel } : {}) },
    managedFields: [
      ...Object.keys(env).map((key) => `env.${key}`),
      ...(defaultModel ? ["model"] : []),
    ],
  };
}

export function buildCodexResponsesProjection(input: {
  readonly config: ModelGatewayConfig;
  readonly modelCatalogPath: string;
}): CodexResponsesProjection | undefined {
  const source = resolveResponsesNativeProjectionSource(input.config, "codex");
  if (!source) return undefined;
  const models = source.models.map((model) => {
    if (typeof model.baseInstructions !== "string" || model.baseInstructions.trim().length === 0) throw new Error(`codex native harness model '${model.id}' is missing canonical base instructions.`);
    return model as NativeProjectedVirtualModel & Required<Pick<ModelGatewayVirtualModelConfig, "baseInstructions">>;
  });
  const defaultModel = source.models.length === 1 ? source.models[0]!.id : undefined;
  return {
    patch: {
      model_provider: "kiln",
      model_catalog_json: input.modelCatalogPath,
      model_providers: {
        kiln: {
          name: "Kiln",
          base_url: `http://127.0.0.1:${source.port}/v1`,
          env_key: source.principal.tokenEnv,
          requires_openai_auth: false,
          wire_api: "responses",
          request_max_retries: 0,
          stream_max_retries: 0,
          supports_websockets: false,
        },
      },
      ...(defaultModel ? { model: defaultModel } : {}),
    },
    managedFields: ["model_provider", "model_catalog_json", "model_providers.kiln", ...(defaultModel ? ["model"] : [])],
    catalog: { models: models.map((model, index) => codexModelInfo(model, index)) },
  };
}

export function buildOpenCodeResponsesProjection(input: {
  readonly config: ModelGatewayConfig;
  readonly existingEnabledProviders?: readonly string[];
}): OpenCodeResponsesProjection | undefined {
  const source = resolveResponsesNativeProjectionSource(input.config, "opencode");
  if (!source) return undefined;
  const enabledProviders = [...new Set([...(input.existingEnabledProviders ?? []), "kiln"])];
  const defaultModel = source.models.length === 1 ? `kiln/${source.models[0]!.id}` : undefined;
  return {
    patch: {
      provider: {
        kiln: {
          npm: "@ai-sdk/openai",
          name: "Kiln",
          options: {
            baseURL: `http://127.0.0.1:${source.port}/v1`,
            apiKey: `{env:${source.principal.tokenEnv}}`,
          },
          models: Object.fromEntries(source.models.map((model) => [model.id, {
            name: model.displayName,
            limit: { context: model.contextTokens, output: model.outputTokens },
          }])),
        },
      },
      enabled_providers: enabledProviders,
      ...(defaultModel ? { model: defaultModel } : {}),
    },
    managedFields: ["provider.kiln", "enabled_providers", ...(defaultModel ? ["model"] : [])],
  };
}

function codexModelInfo(model: NativeProjectedVirtualModel & Required<Pick<ModelGatewayVirtualModelConfig, "baseInstructions">>, priority: number): Record<string, unknown> {
  const supportsReasoning = model.capabilities.includes("reasoning-controls");
  return {
    slug: model.id,
    display_name: model.displayName,
    description: "Routed by Kiln.",
    supported_reasoning_levels: [],
    shell_type: "default",
    visibility: "list",
    supported_in_api: true,
    priority,
    availability_nux: null,
    upgrade: null,
    base_instructions: model.baseInstructions,
    supports_reasoning_summaries: supportsReasoning,
    support_verbosity: model.capabilities.includes("text-verbosity"),
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: { mode: "tokens", limit: 10_000 },
    supports_parallel_tool_calls: model.capabilities.includes("parallel-tool-calls"),
    context_window: model.contextTokens,
    max_context_window: model.contextTokens,
    experimental_supported_tools: [],
    input_modalities: model.capabilities.includes("input-image-url") || model.capabilities.includes("input-image-base64")
      ? ["text", "image"]
      : ["text"],
  };
}

function hasPickerMetadata(model: ModelGatewayVirtualModelConfig): model is NativeProjectedVirtualModel {
  return typeof model.displayName === "string" && model.displayName.trim().length > 0
    && Number.isSafeInteger(model.contextTokens) && model.contextTokens! > 0
    && Number.isSafeInteger(model.outputTokens) && model.outputTokens! > 0
    && model.outputTokens! <= model.contextTokens!;
}
