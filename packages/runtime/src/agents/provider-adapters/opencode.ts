import { OpenAICompatAdapter } from "./openai-compat.js";
import type { AgentResponse, CreateMessageOptions, OpenCodeTier } from "@kilnai/core/agents";
import { safeProviderRequestIdentity } from "@kilnai/core/agents";
import { KilnError } from "@kilnai/core/engine";

export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_BASE_URL = OPENCODE_ZEN_BASE_URL;

export interface OpenCodeAdapterConfig {
  readonly apiKey: string;
  readonly tier: OpenCodeTier;
  readonly defaultModel: string;
  readonly internalRetry?: boolean;
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
      baseUrl: openCodeBaseUrlForTier(config.tier),
      defaultModel,
      providerName: config.tier === "zen" ? "opencode-zen" : "opencode-go",
      internalRetry: config.internalRetry,
    });
    this.tier = config.tier;
    this.defaultModel = defaultModel;
  }

  override createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    return options.tools && options.tools.length > 0
      ? this.createMessageViaStream(options)
      : super.createMessage(options);
  }

  protected override buildHeaders(
    options?: { readonly sessionId?: string; readonly requestIdentity?: { readonly projectId?: string; readonly requestId?: string } },
  ): Record<string, string> {
    const headers = super.buildHeaders(options);
    const identity = safeProviderRequestIdentity(options?.requestIdentity);
    headers["x-opencode-client"] = "kiln";
    headers["User-Agent"] = "kiln/3.0.0-beta.1";
    if (options?.sessionId) headers["x-opencode-session"] = options.sessionId;
    if (identity?.projectId) headers["x-opencode-project"] = identity.projectId;
    if (identity?.requestId) headers["x-opencode-request"] = identity.requestId;
    return headers;
  }

  protected override resolveMaxTokens(options: CreateMessageOptions): number {
    const requested = super.resolveMaxTokens(options);
    const cap = openCodeModelOutputCap(this.defaultModel);
    return cap === undefined ? requested : Math.min(requested, cap);
  }

  protected override projectToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
    return isMoonshotModel(this.defaultModel) ? lowerMoonshotSchema(schema) : schema;
  }
}

function isMoonshotModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes("kimi") || normalized.includes("moonshot");
}

function openCodeModelOutputCap(model: string): number | undefined {
  // OpenCode's CLI transport caps Kimi K2.7 Code output requests at 32,000 tokens.
  return model.toLowerCase().includes("kimi-k2.7-code") ? 32_000 : undefined;
}

/** Moonshot rejects sibling keywords on $ref and tuple-form array items. */
function lowerMoonshotSchema(value: unknown): Record<string, unknown> {
  const projected = lowerMoonshotNode(value);
  return isRecord(projected) ? projected : {};
}

function lowerMoonshotNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lowerMoonshotNode);
  if (!isRecord(value)) return value;
  if (typeof value.$ref === "string") return { $ref: value.$ref };
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (key === "items" && Array.isArray(value.prefixItems)) return [];
    if (key === "items" && Array.isArray(child)) return [[key, tupleItemsSchema(child)]];
    if (key === "prefixItems") {
      if (!Array.isArray(child)) return [];
      // Moonshot only accepts one uniform item schema. Include both tuple and tail schemas
      // rather than rejecting valid tuple prefixes when the source also declares `items`.
      const tail = value.items;
      const variants = tail === undefined
        ? child
        : [...child, ...(Array.isArray(tail) ? tail : [tail])];
      return [["items", tupleItemsSchema(variants)]];
    }
    if (key === "unevaluatedItems") return [];
    return [[key, lowerMoonshotNode(child)]];
  }));
}

function tupleItemsSchema(items: readonly unknown[]): unknown {
  const projected = items.map(lowerMoonshotNode);
  if (projected.length === 0) return {};
  if (projected.length === 1) return projected[0];
  return { anyOf: projected };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function openCodeBaseUrlForTier(tier: OpenCodeTier): string {
  return tier === "go" ? OPENCODE_GO_BASE_URL : OPENCODE_ZEN_BASE_URL;
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
