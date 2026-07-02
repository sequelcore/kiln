import type { CreateMessageOptions } from "../index.js";

export interface ProviderToolNameCodec {
  toProviderName(canonicalName: string): string;
  toCanonicalName(providerName: string): string;
}

export function createProviderToolNameCodec(
  canonicalNames: readonly string[],
): ProviderToolNameCodec {
  const canonicalToProvider = new Map<string, string>();
  const providerToCanonical = new Map<string, string>();
  const usedProviderNames = new Set<string>();

  for (const canonicalName of canonicalNames) {
    if (canonicalToProvider.has(canonicalName)) continue;

    const baseName = normalizeProviderToolName(canonicalName);
    let providerName = baseName;
    let suffix = 2;
    while (usedProviderNames.has(providerName)) {
      providerName = `${baseName}_${suffix}`;
      suffix += 1;
    }

    usedProviderNames.add(providerName);
    canonicalToProvider.set(canonicalName, providerName);
    providerToCanonical.set(providerName, canonicalName);
  }

  return {
    toProviderName: (canonicalName) =>
      canonicalToProvider.get(canonicalName) ?? normalizeProviderToolName(canonicalName),
    toCanonicalName: (providerName) => providerToCanonical.get(providerName) ?? providerName,
  };
}

export function collectCanonicalToolNames(options: CreateMessageOptions): string[] {
  const names = new Set(options.tools?.map((tool) => tool.name) ?? []);
  for (const message of options.messages) {
    for (const part of message.parts) {
      if (part.type === "tool_use") names.add(part.name);
    }
  }
  return [...names];
}

function normalizeProviderToolName(name: string): string {
  const normalized = name
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const nonEmpty = normalized.length > 0 ? normalized : "tool";
  return /^[a-zA-Z]/.test(nonEmpty) ? nonEmpty : `tool_${nonEmpty}`;
}
