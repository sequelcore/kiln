import {
  defaultGlobalConfig,
  readGlobalConfig,
  writeGlobalConfig,
  type KilnGlobalConfig,
} from "../config/global-config.js";

export interface OperatorProviderSelectionPreference {
  readonly provider: string;
  readonly model: string | null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveGuiProviderSelectionPreference(
  config: KilnGlobalConfig | null | undefined,
): OperatorProviderSelectionPreference | null {
  const provider = normalizeText(config?.ui?.providerSelection?.provider);
  if (!provider) {
    return null;
  }
  return {
    provider,
    model: normalizeText(config?.ui?.providerSelection?.model),
  };
}

export function persistGuiProviderSelectionPreference(
  provider: string,
  model: string | null | undefined,
  configOverride?: KilnGlobalConfig | null,
): void {
  const resolvedProvider = normalizeText(provider);
  if (!resolvedProvider) {
    return;
  }
  const resolvedModel = normalizeText(model);
  const current = configOverride ?? readGlobalConfig() ?? defaultGlobalConfig();
  writeGlobalConfig({
    ...current,
    ui: {
      ...current.ui,
      providerSelection: {
        provider: resolvedProvider,
        ...(resolvedModel ? { model: resolvedModel } : {}),
      },
    },
  });
}
