function normalizeNonEmpty(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveEnvProvider(): string | undefined {
  return normalizeNonEmpty(process.env.KILN_PROVIDER);
}

export function resolveEnvModel(): string | undefined {
  return normalizeNonEmpty(process.env.KILN_MODEL);
}

export function resolveEffectiveProvider(
  flagProvider?: string,
  globalProvider?: string,
): string | undefined {
  return (
    normalizeNonEmpty(flagProvider)
    ?? resolveEnvProvider()
    ?? normalizeNonEmpty(globalProvider)
  );
}

export function resolveEffectiveModel(
  flagModel?: string,
  globalModel?: string,
): string | undefined {
  return (
    normalizeNonEmpty(flagModel)
    ?? resolveEnvModel()
    ?? normalizeNonEmpty(globalModel)
  );
}
