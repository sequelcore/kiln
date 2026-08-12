import type { ModelGatewayConfig, ModelGatewayPrincipalConfig, ModelGatewayVirtualModelConfig } from "@kilnai/core";

export type ResponsesNativeHarness = "codex" | "opencode";

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
  const models = resolveNativeProjectionModels(config, principal, harness);
  return { principal, models, port: config.port };
}

export function resolveClaudeMessagesNativeProjectionSource(
  config: ModelGatewayConfig,
): ProjectionSource | undefined {
  const principals = config.principals.filter((principal) => principal.ingress === "anthropic-messages" && principal.nativeHarness === "claude");
  if (principals.length > 1) throw new Error("modelGateway declares multiple claude native harness principals.");
  const principal = principals[0];
  if (!principal) return undefined;
  const models = resolveNativeProjectionModels(config, principal, "claude", (model, id) => {
    if (!/^(?:claude|anthropic)[A-Za-z0-9._:-]*$/.test(model.id)) {
      throw new Error(`claude native harness model '${id}' must start with claude or anthropic for gateway discovery.`);
    }
  });
  return { principal, models, port: config.port };
}

function resolveNativeProjectionModels(
  config: ModelGatewayConfig,
  principal: ModelGatewayPrincipalConfig,
  harness: ResponsesNativeHarness | "claude",
  validateModel?: (model: ModelGatewayVirtualModelConfig, id: string) => void,
): readonly NativeProjectedVirtualModel[] {
  if (principal.virtualModelIds.length === 0) {
    throw new Error(`${harness} native harness principal must reference at least one virtual model.`);
  }

  const referencedIds = new Set<string>();
  for (const id of principal.virtualModelIds) {
    if (referencedIds.has(id)) throw new Error(`${harness} native harness principal repeats virtual model id '${id}'.`);
    referencedIds.add(id);
  }

  const byId = new Map<string, ModelGatewayVirtualModelConfig>();
  const duplicateIds = new Set<string>();
  for (const model of config.virtualModels) {
    if (byId.has(model.id)) duplicateIds.add(model.id);
    else byId.set(model.id, model);
  }

  return principal.virtualModelIds.map((id) => {
    if (duplicateIds.has(id)) throw new Error(`${harness} native harness references duplicate virtual model definitions for '${id}'.`);
    const model = byId.get(id);
    if (!model) throw new Error(`${harness} native harness principal references unknown virtual model '${id}'.`);
    validateModel?.(model, id);
    if (!hasPickerMetadata(model)) throw new Error(`${harness} native harness model '${id}' is missing validated picker metadata.`);
    return model;
  });
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

export function buildOpenCodeResponsesProjection(input: {
  readonly config: ModelGatewayConfig;
}): OpenCodeResponsesProjection | undefined {
  const source = resolveResponsesNativeProjectionSource(input.config, "opencode");
  if (!source) return undefined;
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
    },
    managedFields: ["provider.kiln"],
  };
}

function hasPickerMetadata(model: ModelGatewayVirtualModelConfig): model is NativeProjectedVirtualModel {
  return typeof model.displayName === "string" && model.displayName.trim().length > 0
    && Number.isSafeInteger(model.contextTokens) && model.contextTokens! > 0
    && Number.isSafeInteger(model.outputTokens) && model.outputTokens! > 0
    && model.outputTokens! <= model.contextTokens!;
}
