import type {
  ExecutionTargetCost,
  ExecutionTargetReasonCode,
  ExecutionTargetRepairAction,
  GuiProviderModelCapabilities,
  GuiProviderModelDiscoveryProjection,
  GuiProviderModelRouteEntry,
  ModelAccess,
  ModelCapabilities,
  ModelCatalog,
  ModelCatalogEntry,
  ModelCatalogProvenance,
  ModelModality,
} from "@kilnai/gateway-contracts";
import { getGuiProviderMetadata } from "@kilnai/gateway-contracts";

export interface ConfiguredModelTarget {
  readonly targetId: string;
  readonly label: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly providerRouteId?: string;
  readonly access: ModelAccess;
  readonly availability: "available" | "unavailable" | "unresolved";
  readonly reasonCodes: readonly ExecutionTargetReasonCode[];
  readonly repairActions: readonly ExecutionTargetRepairAction[];
  readonly eligibleAccountCount: number;
  readonly accountOverrideIds: readonly string[];
  readonly cost: ExecutionTargetCost;
}

export interface ModelMetadataRecord {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly providerRouteId?: string;
  readonly displayName?: string;
  readonly family?: string;
  readonly releaseDate?: string;
  readonly lifecycle?: "active" | "deprecated" | "unknown";
  readonly inputModalities?: readonly ModelModality[];
  readonly outputModalities?: readonly ModelModality[];
  readonly tools?: boolean;
  readonly structuredOutput?: boolean;
  readonly reasoning?: boolean;
  readonly streaming?: boolean;
  readonly parallelToolCalls?: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly source: string;
  readonly observedAt: string;
}

interface MutableModelEntry {
  entry: ModelCatalogEntry;
  targets: ConfiguredModelTarget[];
}

export function projectModelCatalog(input: {
  readonly discovery: GuiProviderModelDiscoveryProjection;
  readonly configuredTargets: readonly ConfiguredModelTarget[];
  readonly metadata?: readonly ModelMetadataRecord[];
  readonly revision?: string;
}): ModelCatalog {
  const metadata = input.metadata ?? [];
  const models = new Map<string, MutableModelEntry>();
  const discoveries = [...input.discovery.entries].sort(compareDiscovery);

  for (const discovered of discoveries) {
    const enrichment = findMetadata(metadata, discovered);
    const entry = projectDiscoveredModel(input.discovery, discovered, enrichment);
    models.set(modelKey(entry.providerId, entry.providerRouteId, entry.providerModelId), { entry, targets: [] });
  }

  for (const target of [...input.configuredTargets].sort((left, right) => left.targetId.localeCompare(right.targetId))) {
    const matching = matchingModels(models, target);
    const matched = matching.length === 1 ? matching[0] : undefined;
    if (matched) {
      matched.targets.push(target);
      continue;
    }
    const enrichment = findTargetMetadata(metadata, target);
    const providerRouteId = target.providerRouteId ?? `configured:${target.targetId}`;
    const entry = projectConfiguredOnlyModel(input.discovery, target, providerRouteId, enrichment);
    models.set(modelKey(target.providerId, providerRouteId, target.providerModelId), { entry, targets: [target] });
  }

  const projected = [...models.values()]
    .map(({ entry, targets }): ModelCatalogEntry => ({
      ...entry,
      targets: targets.map(projectTarget),
    }))
    .sort(compareModels);

  return {
    observedAt: input.discovery.catalogEvidence.observedAt,
    ...(input.revision ? { revision: input.revision } : {}),
    models: projected,
  };
}

function projectDiscoveredModel(
  discovery: GuiProviderModelDiscoveryProjection,
  model: GuiProviderModelRouteEntry,
  metadata: ModelMetadataRecord | undefined,
): ModelCatalogEntry {
  const discoveryState = discovery.catalogEvidence.status === "failed"
    ? "failed" as const
    : model.freshness.status === "stale" ? "stale" as const : "observed" as const;
  const eligibility = discoveryState === "failed"
    ? "unknown" as const
    : model.eligibility.eligible ? "eligible" as const
      : model.eligibility.reasonCodes.length > 0 ? "ineligible" as const : "unknown" as const;
  const availability = discoveryState !== "observed"
    ? "unknown" as const
    : model.routeHealth.status === "healthy" && eligibility === "eligible"
      ? "available" as const
      : model.routeHealth.status === "unhealthy" || eligibility === "ineligible"
        ? "unavailable" as const : "unknown" as const;
  const source = `${discovery.catalogEvidence.source.kind}:${discovery.catalogEvidence.source.id}`;
  const provenance: ModelCatalogProvenance[] = [{
    field: "discovery",
    source,
    observedAt: discovery.catalogEvidence.observedAt,
  }];
  if (model.modelCapabilities) {
    provenance.push({ field: "capabilities", source: model.rawEvidence.provenance, observedAt: model.freshness.observedAt });
  }
  provenance.push(...metadataProvenance(metadata));
  const capabilities = projectCapabilities(model.modelCapabilities, metadata);
  return {
    providerId: model.providerRoute.providerId,
    providerRouteId: model.providerRoute.scope,
    providerModelId: model.providerRoute.providerModelId,
    access: getGuiProviderMetadata(model.providerRoute.providerId)?.access ?? "api",
    family: metadata?.family ?? model.normalizedModel.family,
    ...(metadata?.displayName ? { displayName: metadata.displayName } : {}),
    ...(metadata?.releaseDate ? { releaseDate: metadata.releaseDate } : {}),
    ...(metadata?.lifecycle ? { lifecycle: metadata.lifecycle } : {}),
    discovery: discoveryState,
    eligibility,
    availability,
    ...(capabilities ? { capabilities } : {}),
    provenance,
    targets: [],
  };
}

function projectConfiguredOnlyModel(
  discovery: GuiProviderModelDiscoveryProjection,
  target: ConfiguredModelTarget,
  providerRouteId: string,
  metadata: ModelMetadataRecord | undefined,
): ModelCatalogEntry {
  const capabilities = projectCapabilities(undefined, metadata);
  return {
    providerId: target.providerId,
    providerRouteId,
    providerModelId: target.providerModelId,
    access: target.access,
    family: metadata?.family ?? target.providerModelId,
    ...(metadata?.displayName ? { displayName: metadata.displayName } : {}),
    ...(metadata?.releaseDate ? { releaseDate: metadata.releaseDate } : {}),
    ...(metadata?.lifecycle ? { lifecycle: metadata.lifecycle } : {}),
    discovery: discovery.catalogEvidence.status === "failed" ? "failed" : "stale",
    eligibility: "unknown",
    availability: target.availability === "available"
      ? "available"
      : target.availability === "unavailable" ? "unavailable" : "unknown",
    ...(capabilities ? { capabilities } : {}),
    provenance: [
      { field: "target", source: "execution-target-admission", observedAt: discovery.catalogEvidence.observedAt },
      ...metadataProvenance(metadata),
    ],
    targets: [],
  };
}

function projectTarget(target: ConfiguredModelTarget) {
  return {
    targetId: target.targetId,
    label: target.label,
    access: target.access,
    availability: target.availability,
    reasonCodes: [...target.reasonCodes],
    repairActions: [...target.repairActions],
    eligibleAccountCount: target.eligibleAccountCount,
    accountOverrideIds: [...target.accountOverrideIds],
    cost: target.cost,
  };
}

function projectCapabilities(
  discovered: GuiProviderModelCapabilities | undefined,
  metadata: ModelMetadataRecord | undefined,
): ModelCapabilities | undefined {
  if (!discovered && !metadata) return undefined;
  const inputModalities = metadata?.inputModalities
    ?? (discovered?.supportsVision ? ["text", "image"] as const : ["text"] as const);
  const outputModalities = metadata?.outputModalities ?? ["text"] as const;
  return {
    inputModalities,
    outputModalities,
    tools: metadata?.tools ?? discovered?.supportsTools ?? discovered?.supportsFunctionTools ?? false,
    structuredOutput: metadata?.structuredOutput ?? discovered?.supportsStructuredOutput ?? false,
    reasoning: metadata?.reasoning ?? Boolean(discovered?.deliberation),
    ...(metadata?.streaming !== undefined || discovered?.supportsStreaming !== undefined
      ? { streaming: metadata?.streaming ?? discovered?.supportsStreaming ?? false }
      : {}),
    ...(metadata?.parallelToolCalls !== undefined || discovered?.supportsParallelToolCalls !== undefined
      ? { parallelToolCalls: metadata?.parallelToolCalls ?? discovered?.supportsParallelToolCalls ?? false }
      : {}),
    ...(metadata?.contextWindow ?? discovered?.contextWindow
      ? { contextWindow: metadata?.contextWindow ?? discovered?.contextWindow }
      : {}),
    ...(metadata?.maxOutputTokens ? { maxOutputTokens: metadata.maxOutputTokens } : {}),
  };
}

function matchingModels(
  models: ReadonlyMap<string, MutableModelEntry>,
  target: ConfiguredModelTarget,
): MutableModelEntry[] {
  return [...models.values()].filter(({ entry }) =>
    entry.providerId === target.providerId
    && entry.providerModelId === target.providerModelId
    && (target.providerRouteId === undefined || entry.providerRouteId === target.providerRouteId));
}

function findMetadata(
  metadata: readonly ModelMetadataRecord[],
  model: GuiProviderModelRouteEntry,
): ModelMetadataRecord | undefined {
  return metadata.find((candidate) =>
    candidate.providerId === model.providerRoute.providerId
    && candidate.providerModelId === model.providerRoute.providerModelId
    && (candidate.providerRouteId === undefined || candidate.providerRouteId === model.providerRoute.scope));
}

function findTargetMetadata(
  metadata: readonly ModelMetadataRecord[],
  target: ConfiguredModelTarget,
): ModelMetadataRecord | undefined {
  return metadata.find((candidate) =>
    candidate.providerId === target.providerId
    && candidate.providerModelId === target.providerModelId
    && (candidate.providerRouteId === undefined || candidate.providerRouteId === target.providerRouteId));
}

function metadataProvenance(metadata: ModelMetadataRecord | undefined): ModelCatalogProvenance[] {
  if (!metadata) return [];
  return ["displayName", "family", "releaseDate", "lifecycle", "capabilities"]
    .filter((field) => metadata[field as keyof ModelMetadataRecord] !== undefined)
    .map((field) => ({ field, source: metadata.source, observedAt: metadata.observedAt }));
}

function modelKey(providerId: string, providerRouteId: string, providerModelId: string): string {
  return `${providerId}\u0000${providerRouteId}\u0000${providerModelId}`;
}

function compareDiscovery(left: GuiProviderModelRouteEntry, right: GuiProviderModelRouteEntry): number {
  return left.providerRoute.providerId.localeCompare(right.providerRoute.providerId)
    || left.providerRoute.providerModelId.localeCompare(right.providerRoute.providerModelId)
    || left.providerRoute.scope.localeCompare(right.providerRoute.scope);
}

function compareModels(left: ModelCatalogEntry, right: ModelCatalogEntry): number {
  return left.providerId.localeCompare(right.providerId)
    || (left.displayName ?? left.providerModelId).localeCompare(right.displayName ?? right.providerModelId)
    || left.providerRouteId.localeCompare(right.providerRouteId);
}
