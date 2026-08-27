import type {
  ModelAccess,
  ModelAvailabilityState,
  ModelCatalog,
  ModelCatalogEntry,
  ModelExecutionTarget,
} from "./model-catalog.js";

export interface ModelCatalogItem {
  readonly key: string;
  readonly providerId: string;
  readonly providerRouteId: string;
  readonly providerModelId: string;
  readonly access: ModelAccess;
  readonly label: string;
  readonly family: string;
  readonly availability: ModelAvailabilityState;
  readonly configured: boolean;
  readonly targetCount: number;
  readonly targets: readonly ModelExecutionTarget[];
  readonly model: ModelCatalogEntry;
  readonly searchText: string;
}

export type ModelCatalogPrimaryAction =
  | { readonly kind: "configure" }
  | { readonly kind: "select-target"; readonly targetId: string }
  | { readonly kind: "repair-target"; readonly targetId: string }
  | { readonly kind: "choose-target" };

export type ModelCatalogAccessFilter = ModelAccess | "all";

export function projectModelCatalogItems(catalog: ModelCatalog): readonly ModelCatalogItem[] {
  return catalog.models.map((model): ModelCatalogItem => ({
    key: JSON.stringify([model.providerId, model.providerRouteId, model.providerModelId]),
    providerId: model.providerId,
    providerRouteId: model.providerRouteId,
    providerModelId: model.providerModelId,
    access: model.access,
    label: model.displayName ?? model.providerModelId,
    family: model.family,
    availability: model.availability,
    configured: model.targets.length > 0,
    targetCount: model.targets.length,
    targets: model.targets,
    model,
    searchText: [
      model.displayName,
      model.family,
      model.providerId,
      model.providerRouteId,
      model.providerModelId,
      ...model.targets.flatMap((target) => [target.label, target.targetId, ...target.accountOverrideIds]),
    ].filter((value): value is string => Boolean(value)).join(" ").toLowerCase(),
  })).sort((left, right) => left.label.localeCompare(right.label)
    || left.providerId.localeCompare(right.providerId)
    || left.providerRouteId.localeCompare(right.providerRouteId));
}

export function filterModelCatalogItems(
  items: readonly ModelCatalogItem[],
  filters: {
    readonly query: string;
    readonly providerId: string | null;
    readonly access: ModelCatalogAccessFilter;
  },
): readonly ModelCatalogItem[] {
  const terms = filters.query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return items.filter((item) =>
    (filters.providerId === null || item.providerId === filters.providerId)
    && (filters.access === "all" || item.access === filters.access)
    && terms.every((term) => item.searchText.includes(term)));
}

export function modelCatalogPrimaryAction(model: ModelCatalogEntry): ModelCatalogPrimaryAction {
  if (model.targets.length === 0) return { kind: "configure" };
  const available = model.targets.filter((target) => target.availability === "available");
  if (available.length === 1) return { kind: "select-target", targetId: available[0]!.targetId };
  if (available.length > 1 || model.targets.length > 1) return { kind: "choose-target" };
  return { kind: "repair-target", targetId: model.targets[0]!.targetId };
}
