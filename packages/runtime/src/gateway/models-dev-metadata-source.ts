import type { ModelModality } from "@kilnai/gateway-contracts";
import type { ModelMetadataRecord } from "./model-catalog-projector.js";

const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json";
const MODELS_DEV_TIMEOUT_MS = 5_000;
const MODEL_MODALITIES = new Set<ModelModality>(["text", "image", "audio", "video", "pdf"]);
const KILN_PROVIDER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  openai: ["codex-oauth"],
  anthropic: ["claude"],
};

export type ModelsDevMetadataLoadResult =
  | { readonly status: "available"; readonly records: readonly ModelMetadataRecord[] }
  | { readonly status: "unavailable"; readonly reason: "request-failed" | "invalid-response" };

export function parseModelsDevCatalog(value: unknown, observedAt: string): readonly ModelMetadataRecord[] {
  if (!isRecord(value) || !isInstant(observedAt)) return [];
  const records: ModelMetadataRecord[] = [];
  for (const [providerId, providerValue] of Object.entries(value)) {
    if (!requiredText(providerId) || !isRecord(providerValue) || !isRecord(providerValue.models)) continue;
    for (const [providerModelId, modelValue] of Object.entries(providerValue.models)) {
      const model = parseModel(providerId, providerModelId, modelValue, observedAt);
      if (model) records.push(model);
    }
  }
  const directKeys = new Set(records.map((record) => `${record.providerId}\u0000${record.providerModelId}`));
  const aliases = records.flatMap((record) => (KILN_PROVIDER_ALIASES[record.providerId] ?? [])
    .filter((providerId) => !directKeys.has(`${providerId}\u0000${record.providerModelId}`))
    .map((providerId): ModelMetadataRecord => ({ ...record, providerId })));
  return [...records, ...aliases].sort((left, right) => left.providerId.localeCompare(right.providerId)
    || left.providerModelId.localeCompare(right.providerModelId));
}

export async function loadModelsDevMetadata(options: {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
} = {}): Promise<ModelsDevMetadataLoadResult> {
  const request = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS);
  try {
    const response = await request(MODELS_DEV_CATALOG_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { status: "unavailable", reason: "request-failed" };
    const value: unknown = await response.json();
    const records = parseModelsDevCatalog(value, (options.now ?? (() => new Date()))().toISOString());
    if (!isRecord(value)) return { status: "unavailable", reason: "invalid-response" };
    return { status: "available", records };
  } catch {
    return { status: "unavailable", reason: "request-failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseModel(
  providerId: string,
  providerModelId: string,
  value: unknown,
  observedAt: string,
): ModelMetadataRecord | undefined {
  if (!requiredText(providerModelId) || !isRecord(value)) return undefined;
  const displayName = readText(value.name);
  if (!displayName) return undefined;
  const modalities = isRecord(value.modalities) ? value.modalities : undefined;
  const limits = isRecord(value.limit) ? value.limit : undefined;
  const status = readText(value.status);
  return {
    providerId,
    providerModelId,
    displayName,
    ...(readText(value.family) ? { family: readText(value.family) } : {}),
    ...(readDate(value.release_date) ? { releaseDate: readDate(value.release_date) } : {}),
    ...(status ? { lifecycle: status === "deprecated" ? "deprecated" : "active" } : {}),
    ...(readModalities(modalities?.input).length > 0 ? { inputModalities: readModalities(modalities?.input) } : {}),
    ...(readModalities(modalities?.output).length > 0 ? { outputModalities: readModalities(modalities?.output) } : {}),
    ...(typeof value.tool_call === "boolean" ? { tools: value.tool_call } : {}),
    ...(typeof value.structured_output === "boolean" ? { structuredOutput: value.structured_output } : {}),
    ...(typeof value.reasoning === "boolean" ? { reasoning: value.reasoning } : {}),
    ...(positiveInteger(limits?.context) ? { contextWindow: positiveInteger(limits?.context) } : {}),
    ...(positiveInteger(limits?.output) ? { maxOutputTokens: positiveInteger(limits?.output) } : {}),
    source: `models.dev:${providerId}`,
    observedAt,
  };
}

function readModalities(value: unknown): readonly ModelModality[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((candidate): candidate is ModelModality =>
    typeof candidate === "string" && MODEL_MODALITIES.has(candidate as ModelModality)))];
}

function readText(value: unknown): string | undefined {
  return requiredText(value) ? value.trim() : undefined;
}

function readDate(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u.test(value) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function requiredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
