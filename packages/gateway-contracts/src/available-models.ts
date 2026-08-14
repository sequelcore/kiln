import { z } from "zod";

export const AVAILABLE_MODEL_REASON_CODES = [
  "discovery-observed",
  "discovery-stale",
  "discovery-failed",
  "model-eligible",
  "policy-ineligible",
  "eligibility-unknown",
  "model-available",
  "model-unavailable",
  "availability-unknown",
  "configured-route-present",
  "route-not-configured",
] as const;

export type AvailableModelReasonCode = typeof AVAILABLE_MODEL_REASON_CODES[number];
export type AvailableModelDiscoveryState = "observed" | "stale" | "failed";
export type AvailableModelEligibilityState = "eligible" | "ineligible" | "unknown";
export type AvailableModelAvailabilityState = "available" | "unavailable" | "unknown";
export type AvailableModelConfiguredState = "configured" | "unconfigured";

export interface AvailableModelConfiguredRouteRef {
  readonly routeId: string;
  readonly label: string;
}

/** Secret-free discovery/configuration evidence. It carries no selection or dispatch intent. */
export interface AvailableModelCatalogEntry {
  readonly providerId: string;
  readonly providerRouteId: string;
  readonly providerModelId: string;
  readonly discoveryState: AvailableModelDiscoveryState;
  readonly eligibilityState: AvailableModelEligibilityState;
  readonly availabilityState: AvailableModelAvailabilityState;
  readonly configuredState: AvailableModelConfiguredState;
  readonly configuredRouteRefs: readonly AvailableModelConfiguredRouteRef[];
  readonly reasonCodes: readonly AvailableModelReasonCode[];
}

export interface AvailableModelCatalog {
  readonly observedAt: string;
  readonly entries: readonly AvailableModelCatalogEntry[];
}

const RequiredText = z.string().trim().min(1);
const AvailableModelConfiguredRouteRefSchema: z.ZodType<AvailableModelConfiguredRouteRef> = z.object({
  routeId: RequiredText,
  label: RequiredText,
}).strict();
export const AvailableModelCatalogEntrySchema: z.ZodType<AvailableModelCatalogEntry> = z.object({
  providerId: RequiredText,
  providerRouteId: RequiredText,
  providerModelId: RequiredText,
  discoveryState: z.enum(["observed", "stale", "failed"]),
  eligibilityState: z.enum(["eligible", "ineligible", "unknown"]),
  availabilityState: z.enum(["available", "unavailable", "unknown"]),
  configuredState: z.enum(["configured", "unconfigured"]),
  configuredRouteRefs: z.array(AvailableModelConfiguredRouteRefSchema),
  reasonCodes: z.array(z.enum(AVAILABLE_MODEL_REASON_CODES)),
}).strict();
export const AvailableModelCatalogSchema: z.ZodType<AvailableModelCatalog> = z.object({
  observedAt: z.string().datetime({ offset: true }),
  entries: z.array(AvailableModelCatalogEntrySchema),
}).strict();
