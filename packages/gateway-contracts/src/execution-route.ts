/**
 * Canonical operator execution-route projections.
 *
 * A route id is the operator's selection authority. Provider and provider-model
 * ids are retained on projections only as derived execution evidence and must
 * not be accepted as a substitute for route selection.
 */

export type ExecutionRouteAvailability = "available" | "unavailable" | "unresolved";

/** Stable, machine-readable explanations for a route's current availability. */
export type ExecutionRouteReasonCode =
  | "configured"
  | "route-not-configured"
  | "missing-provider"
  | "missing-model"
  | "missing-credentials"
  | "credential-unavailable"
  | "provider-unavailable"
  | "model-unavailable"
  | "route-evidence-pending"
  | "route-health-unknown"
  | "route-health-unavailable"
  | "account-unavailable"
  | "account-capacity-exhausted"
  | "quota-exhausted"
  | "quota-stale"
  | "quota-unknown"
  | "policy-denied"
  | "catalog-stale"
  | "catalog-failed"
  | "unknown";

/** Deterministic operator repair affordances for a route diagnostic. */
export type ExecutionRouteRepairAction =
  | "authenticate-provider"
  | "refresh-route-catalog"
  | "retry-route"
  | "review-route-configuration"
  | "select-another-route"
  | "check-provider"
  | "check-account";

/** Shared identity and admission evidence for a configured route. */
interface ExecutionRouteCatalogEntryBase {
  readonly routeId: string;
  readonly label: string;
  /** Derived provider identity; never the operator selection key. */
  readonly providerId: string;
  /** Derived provider model identity; never the operator selection key. */
  readonly providerModelId: string;
  readonly availability: ExecutionRouteAvailability;
  readonly reasonCodes: readonly ExecutionRouteReasonCode[];
  readonly repairActions: readonly ExecutionRouteRepairAction[];
}

export type ExecutionRouteAccountSelectionSummary =
  | {
    readonly mode: "automatic";
    readonly eligibleAccountCount: number;
    readonly allowOperatorOverride: true;
  }
  | {
    readonly mode: "exact";
    readonly eligibleAccountCount: 1;
    readonly allowOperatorOverride: false;
  };

/**
 * A configured route is retained even when runtime evidence cannot admit it.
 * Account aliases are exposed only for automatic account selection; they are
 * secret-free display/selection handles, never credential ids or material.
 */
export type ExecutionRouteCatalogEntry =
  | (ExecutionRouteCatalogEntryBase & {
      readonly accountSelection: Extract<ExecutionRouteAccountSelectionSummary, { readonly mode: "automatic" }>;
      readonly accountOverrideIds?: readonly string[];
    })
  | (ExecutionRouteCatalogEntryBase & {
      readonly accountSelection: Extract<ExecutionRouteAccountSelectionSummary, { readonly mode: "exact" }>;
      readonly accountOverrideIds?: never;
    });

export interface ExecutionRouteCatalog {
  readonly routes: readonly ExecutionRouteCatalogEntry[];
  /** Runtime observation time, when the catalog was produced. */
  readonly observedAt?: string;
  /** Runtime/config revision used to derive the projection, when available. */
  readonly revision?: string;
}

/** Operator intent selects one configured route and may narrow its account policy. */
export interface ExecutionRouteSelectionIntent {
  readonly routeId: string;
  readonly accountOverrideId?: string;
}

export const ExecutionRouteAvailabilitySchema = z.enum(["available", "unavailable", "unresolved"]);
export const ExecutionRouteReasonCodeSchema = z.enum([
  "configured",
  "route-not-configured",
  "missing-provider",
  "missing-model",
  "missing-credentials",
  "credential-unavailable",
  "provider-unavailable",
  "model-unavailable",
  "route-evidence-pending",
  "route-health-unknown",
  "route-health-unavailable",
  "account-unavailable",
  "account-capacity-exhausted",
  "quota-exhausted",
  "quota-stale",
  "quota-unknown",
  "policy-denied",
  "catalog-stale",
  "catalog-failed",
  "unknown",
]);
export const ExecutionRouteRepairActionSchema = z.enum([
  "authenticate-provider",
  "refresh-route-catalog",
  "retry-route",
  "review-route-configuration",
  "select-another-route",
  "check-provider",
  "check-account",
]);
const AutomaticExecutionRouteAccountSelectionSchema = z.object({ mode: z.literal("automatic"), eligibleAccountCount: z.number().int().nonnegative(), allowOperatorOverride: z.literal(true) }).strict();
const ExactExecutionRouteAccountSelectionSchema = z.object({ mode: z.literal("exact"), eligibleAccountCount: z.literal(1), allowOperatorOverride: z.literal(false) }).strict();
export const ExecutionRouteAccountSelectionSummarySchema: z.ZodType<ExecutionRouteAccountSelectionSummary> = z.discriminatedUnion("mode", [
  AutomaticExecutionRouteAccountSelectionSchema,
  ExactExecutionRouteAccountSelectionSchema,
]);
const ExecutionRouteCatalogEntryBaseSchema = {
  routeId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  providerModelId: z.string().trim().min(1),
  availability: ExecutionRouteAvailabilitySchema,
  reasonCodes: z.array(ExecutionRouteReasonCodeSchema),
  repairActions: z.array(ExecutionRouteRepairActionSchema),
};
export const ExecutionRouteCatalogEntrySchema: z.ZodType<ExecutionRouteCatalogEntry> = z.union([
  z.object({
    ...ExecutionRouteCatalogEntryBaseSchema,
    accountSelection: AutomaticExecutionRouteAccountSelectionSchema,
    accountOverrideIds: z.array(z.string().trim().min(1)).optional(),
  }).strict(),
  z.object({
    ...ExecutionRouteCatalogEntryBaseSchema,
    accountSelection: ExactExecutionRouteAccountSelectionSchema,
  }).strict(),
]);
export const ExecutionRouteCatalogSchema: z.ZodType<ExecutionRouteCatalog> = z.object({
  routes: z.array(ExecutionRouteCatalogEntrySchema),
  observedAt: z.string().datetime({ offset: true }).optional(),
  revision: z.string().trim().min(1).optional(),
}).strict();
export const ExecutionRouteSelectionIntentSchema: z.ZodType<ExecutionRouteSelectionIntent> = z.object({
  routeId: z.string().trim().min(1),
  accountOverrideId: z.string().trim().min(1).optional(),
}).strict();

export interface ExecutionRouteChanged {
  readonly type: "execution_route_changed";
  readonly routeId: string;
  readonly requestId: string;
  /** Derived execution evidence; route identity remains authoritative. */
  readonly providerId?: string;
  /** Derived execution evidence; route identity remains authoritative. */
  readonly providerModelId?: string;
}

export interface ExecutionRouteChangeFailed {
  readonly type: "execution_route_change_failed";
  readonly routeId: string;
  readonly requestId: string;
  readonly reasonCode: ExecutionRouteReasonCode;
  readonly reason: string;
  readonly repairActions: readonly ExecutionRouteRepairAction[];
}

export interface ExecutionRouteThreadMeta {
  readonly routeId: string;
  /** Derived execution evidence, not a selection authority. */
  readonly provider?: string;
  /** Derived execution evidence, not a selection authority. */
  readonly model?: string;
  readonly providerSessionId?: string;
  readonly lastUsedAt?: string;
}
import { z } from "zod";
