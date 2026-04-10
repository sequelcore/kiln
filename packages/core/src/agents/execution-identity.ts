export interface ExecutionIdentity {
  readonly source: "configured" | "runtime-routed";
  readonly provider?: string;
  readonly model?: string;
}

export interface ResolveExecutionIdentityOptions {
  readonly configuredProvider?: string;
  readonly configuredModel?: string;
  readonly routedProvider?: string;
  readonly routedModel?: string;
}

function normalize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveExecutionIdentity(
  options: ResolveExecutionIdentityOptions,
): ExecutionIdentity | undefined {
  const configuredProvider = normalize(options.configuredProvider);
  const configuredModel = normalize(options.configuredModel);
  const routedProvider = normalize(options.routedProvider);
  const routedModel = normalize(options.routedModel);
  const hasRoutedIdentity = routedProvider !== undefined || routedModel !== undefined;
  const provider = hasRoutedIdentity ? (routedProvider ?? configuredProvider) : configuredProvider;
  const model = hasRoutedIdentity ? (routedModel ?? configuredModel) : configuredModel;

  if (provider === undefined && model === undefined) {
    return undefined;
  }

  return {
    source: hasRoutedIdentity ? "runtime-routed" : "configured",
    provider,
    model,
  };
}

export function formatExecutionIdentity(identity: ExecutionIdentity): string {
  const lines: string[] = ["[KILN EXECUTION IDENTITY]"];
  if (identity.provider) lines.push(`provider: ${identity.provider}`);
  if (identity.model) lines.push(`model: ${identity.model}`);
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
