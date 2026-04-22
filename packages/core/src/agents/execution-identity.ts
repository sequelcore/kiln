export type ExecutionBillingMode =
  | "metered"
  | "subscription"
  | "free"
  | "unknown";

export interface ExecutionIdentity {
  readonly source: "configured" | "runtime-routed";
  readonly provider?: string;
  readonly model?: string;
  readonly canonicalModel?: string;
  readonly billingMode?: ExecutionBillingMode;
}

export interface ResolveExecutionIdentityOptions {
  readonly configuredProvider?: string;
  readonly configuredModel?: string;
  readonly configuredCanonicalModel?: string;
  readonly configuredBillingMode?: ExecutionBillingMode;
  readonly routedProvider?: string;
  readonly routedModel?: string;
  readonly routedCanonicalModel?: string;
  readonly routedBillingMode?: ExecutionBillingMode;
}

function normalize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferCanonicalModel(
  provider: string | undefined,
  model: string | undefined,
): string | undefined {
  const normalizedModel = normalize(model);
  if (!normalizedModel) return undefined;

  const normalizedProvider = normalize(provider);
  if (!normalizedProvider) return normalizedModel;

  const qualifiedPrefix = `${normalizedProvider}/`;
  if (normalizedModel.startsWith(qualifiedPrefix)) {
    return normalize(normalizedModel.slice(qualifiedPrefix.length));
  }

  return normalizedModel;
}

function inferBillingMode(
  provider: string | undefined,
  model: string | undefined,
  canonicalModel: string | undefined,
): ExecutionBillingMode {
  const normalizedProvider = normalize(provider)?.toLowerCase();
  const normalizedModel = normalize(model)?.toLowerCase();
  const normalizedCanonicalModel = normalize(canonicalModel)?.toLowerCase();

  if (normalizedProvider === "codex-oauth") {
    return "subscription";
  }

  if (normalizedProvider === "ollama") {
    return "free";
  }

  const looksFree =
    normalizedModel?.endsWith(":free") === true ||
    normalizedCanonicalModel?.endsWith(":free") === true ||
    normalizedModel?.endsWith("-free") === true ||
    normalizedCanonicalModel?.endsWith("-free") === true;
  if (looksFree) {
    return "free";
  }

  if (
    normalizedProvider === "anthropic" ||
    normalizedProvider === "openai" ||
    normalizedProvider === "deepseek" ||
    normalizedProvider === "openrouter"
  ) {
    return "metered";
  }

  return "unknown";
}

export function resolveExecutionIdentity(
  options: ResolveExecutionIdentityOptions,
): ExecutionIdentity | undefined {
  const configuredProvider = normalize(options.configuredProvider);
  const configuredModel = normalize(options.configuredModel);
  const configuredCanonicalModel = normalize(options.configuredCanonicalModel);
  const routedProvider = normalize(options.routedProvider);
  const routedModel = normalize(options.routedModel);
  const routedCanonicalModel = normalize(options.routedCanonicalModel);
  const hasRoutedIdentity =
    routedProvider !== undefined ||
    routedModel !== undefined ||
    routedCanonicalModel !== undefined ||
    options.routedBillingMode !== undefined;
  const provider = hasRoutedIdentity ? (routedProvider ?? configuredProvider) : configuredProvider;
  const model = hasRoutedIdentity ? (routedModel ?? configuredModel) : configuredModel;
  const canonicalModel = hasRoutedIdentity
    ? (routedCanonicalModel ?? inferCanonicalModel(provider, model) ?? configuredCanonicalModel)
    : (configuredCanonicalModel ?? inferCanonicalModel(provider, model));
  const billingMode = hasRoutedIdentity
    ? (options.routedBillingMode ?? inferBillingMode(provider, model, canonicalModel))
    : (options.configuredBillingMode ?? inferBillingMode(provider, model, canonicalModel));

  if (provider === undefined && model === undefined && canonicalModel === undefined) {
    return undefined;
  }

  return {
    source: hasRoutedIdentity ? "runtime-routed" : "configured",
    provider,
    model,
    canonicalModel,
    billingMode,
  };
}

export function formatExecutionIdentity(identity: ExecutionIdentity): string {
  const lines: string[] = ["[KILN EXECUTION IDENTITY]"];
  if (identity.provider) lines.push(`provider: ${identity.provider}`);
  if (identity.model) lines.push(`model: ${identity.model}`);
  if (identity.canonicalModel && identity.canonicalModel !== identity.model) {
    lines.push(`canonical-model: ${identity.canonicalModel}`);
  }
  if (identity.billingMode) lines.push(`billing-mode: ${identity.billingMode}`);
  lines.push(`source: ${identity.source}`);
  lines.push("If asked about provider/model, use this identity for this turn.");
  return lines.join("\n");
}

export function appendExecutionIdentity(
  basePrompt: string,
  identity?: ExecutionIdentity,
): string {
  if (!identity) return basePrompt;
  const section = formatExecutionIdentity(identity);
  if (basePrompt.trim().length === 0) return section;
  return `${basePrompt}\n\n${section}`;
}
