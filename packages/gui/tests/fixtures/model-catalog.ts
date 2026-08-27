import type {
  ExecutionTargetAvailability,
  ModelAccess,
  ModelAvailabilityState,
  ModelCatalog,
  ModelDiscoveryState,
  ModelEligibilityState,
} from "@kilnai/gateway-contracts";

export interface TestModelInput {
  readonly targetId?: string;
  readonly label?: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly access?: ModelAccess;
  readonly discovery?: ModelDiscoveryState;
  readonly eligibility?: ModelEligibilityState;
  readonly modelAvailability?: ModelAvailabilityState;
  readonly targetAvailability?: ExecutionTargetAvailability;
  readonly accountOverrideIds?: readonly string[];
}

export function testModelCatalog(...models: readonly TestModelInput[]): ModelCatalog {
  return {
    observedAt: "2026-08-26T16:00:00.000Z",
    models: models.map((model) => ({
      providerId: model.providerId,
      providerRouteId: `${model.providerId}:direct`,
      providerModelId: model.providerModelId,
      displayName: model.label ?? model.providerModelId,
      family: model.providerModelId,
      access: model.access ?? "api",
      discovery: model.discovery ?? "observed",
      eligibility: model.eligibility ?? "eligible",
      availability: model.modelAvailability ?? "available",
      provenance: [],
      targets: model.targetId ? [{
        targetId: model.targetId,
        label: model.label ?? model.providerModelId,
        access: model.access ?? "api",
        availability: model.targetAvailability ?? "available",
        reasonCodes: model.targetAvailability === "unavailable" ? ["target-health-unavailable"] : ["configured"],
        repairActions: model.targetAvailability === "unavailable" ? ["retry-target"] : [],
        eligibleAccountCount: 1,
        accountOverrideIds: model.accountOverrideIds ?? [],
        cost: { kind: "unknown" },
      }] : [],
    })),
  };
}
