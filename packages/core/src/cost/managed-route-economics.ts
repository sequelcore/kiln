import { createHash } from "node:crypto";
import type { ManagedAgentAuthorityProfile } from "../agents/managed-invocation/index.js";

export type ManagedEconomicConfidence = "high" | "medium" | "low";

export type ManagedEconomicEvidenceAuthority =
  | "provider-reported"
  | "configured"
  | "calculated-estimate";

export interface ManagedEconomicEvidenceIdentity {
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly confidence: ManagedEconomicConfidence;
  readonly authority: ManagedEconomicEvidenceAuthority;
}

export type ManagedEconomicScheme =
  | {
      readonly kind: "currency";
      readonly currency: string;
    }
  | {
      readonly kind: "credit";
      readonly creditSchemeId: string;
    }
  | {
      readonly kind: "unit";
    };

/**
 * Exact non-negative decimal. `atoms` is canonical base-10 and `scale` records
 * the decimal position; persisted arithmetic never passes through Number.
 */
export interface ManagedEconomicAmount {
  readonly atoms: string;
  readonly scale: number;
  readonly unit: string;
  readonly scheme: ManagedEconomicScheme;
}

/** Parses a provider decimal string without routing the value through Number. */
export function createManagedEconomicAmountFromDecimal(input: {
  readonly value: string;
  readonly unit: string;
  readonly scheme: ManagedEconomicScheme;
}): ManagedEconomicAmount {
  if (typeof input.value !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(input.value)) {
    throw new ManagedEconomicValidationError("managed economic decimal must be canonical and non-negative");
  }
  const [integer, fraction = ""] = input.value.split(".");
  const trimmedFraction = fraction.replace(/0+$/u, "");
  const atoms = `${integer}${trimmedFraction}`.replace(/^0+(?=[0-9])/u, "") || "0";
  const amount: ManagedEconomicAmount = {
    atoms,
    scale: trimmedFraction.length,
    unit: input.unit,
    scheme: input.scheme,
  };
  validateManagedEconomicAmount(amount);
  return amount;
}

export type ManagedEconomicClass =
  | "subscription"
  | "included"
  | "free"
  | "metered"
  | "unknown"
  | "estimated";

export interface ManagedEconomicPriceIdentity {
  readonly providerId: string;
  readonly modelId: string;
  readonly authBillingChannel: string;
  readonly executionMode: string;
  readonly serviceTier: string;
  readonly rateCardId: string;
  readonly rateCardRevision: string;
  readonly unit: string;
  readonly scheme: ManagedEconomicScheme;
  readonly unitScheduleDigest: string;
  readonly contextClass: string;
  readonly cacheClass: string;
  readonly auxiliaryScheduleDigest: string;
  readonly evidence: ManagedEconomicEvidenceIdentity;
}

export type ManagedEconomicPriceEvidence =
  | {
      readonly kind: "subscription";
      readonly identity: ManagedEconomicPriceIdentity;
    }
  | {
      readonly kind: "included";
      readonly identity: ManagedEconomicPriceIdentity;
      readonly allowanceId: string;
    }
  | {
      readonly kind: "free";
      readonly identity: ManagedEconomicPriceIdentity;
    }
  | {
      readonly kind: "metered";
      readonly identity: ManagedEconomicPriceIdentity;
    }
  | {
      readonly kind: "unknown";
      readonly identity: ManagedEconomicPriceIdentity;
      readonly reason: string;
    }
  | {
      readonly kind: "estimated";
      readonly identity: ManagedEconomicPriceIdentity;
      readonly estimationMethod: string;
    };

export interface ManagedEconomicQuotaBucket {
  readonly bucketId: string;
  readonly dimension: string;
  readonly remaining: ManagedEconomicAmount | null;
  readonly windowDurationMinutes?: number | null;
  readonly resetsAt: string | null;
}

export interface ManagedEconomicCreditEvidence {
  readonly status: "available" | "unavailable" | "unlimited" | "unknown";
  readonly balance: ManagedEconomicAmount | null;
}

export interface ManagedEconomicSpendControlEvidence {
  readonly status: "available" | "exhausted" | "unknown";
  readonly limit: ManagedEconomicAmount | null;
  readonly used: ManagedEconomicAmount | null;
  readonly remainingPercent: number | null;
  readonly resetsAt: string | null;
}

export type ManagedEconomicQuotaExhaustionReason =
  | "rate-limit-reached"
  | "workspace-owner-credits-depleted"
  | "workspace-member-credits-depleted"
  | "workspace-owner-usage-limit-reached"
  | "workspace-member-usage-limit-reached"
  | "spend-control-reached"
  | "unknown";

export interface ManagedEconomicQuotaObservation {
  readonly credits?: ManagedEconomicCreditEvidence | null;
  readonly spendControl?: ManagedEconomicSpendControlEvidence | null;
  readonly exhaustionReason?: ManagedEconomicQuotaExhaustionReason | null;
}

export type ManagedEconomicQuotaEvidence = ManagedEconomicQuotaObservation & (
  | {
      readonly kind: "known";
      readonly capacityIdentity: string;
      readonly subscriptionClass: Exclude<ManagedEconomicClass, "estimated">;
      readonly quotaClassId: string;
      readonly buckets: readonly ManagedEconomicQuotaBucket[];
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "unlimited";
      readonly capacityIdentity: string;
      readonly subscriptionClass: Exclude<ManagedEconomicClass, "estimated">;
      readonly quotaClassId: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "unknown";
      readonly capacityIdentity: string;
      readonly subscriptionClass: "unknown";
      readonly reason: string;
      readonly evidence: ManagedEconomicEvidenceIdentity | null;
    });

export interface ManagedEconomicRouteIdentity {
  readonly routeId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  readonly authBillingChannel: string;
  readonly executionMode: string;
  readonly serviceTier: string;
  readonly accountPolicyId: string | null;
  readonly fallbackPosture: "disabled" | "committed";
  readonly overagePosture: "disabled" | "committed";
  readonly rateCardId: string;
  readonly rateCardRevision: string;
  readonly priceEvidenceDigest: string;
  /** Price class known from the committed route evidence, before settlement. */
  readonly priceClass?: ManagedEconomicClass;
  readonly unit: string;
  readonly scheme: ManagedEconomicScheme;
  readonly contextClass: string;
  readonly cacheClass: string;
  readonly auxiliaryScheduleDigest: string;
  readonly envelopeDigest: string;
}

export type ManagedEconomicAccountIdentity =
  | {
      readonly kind: "account-bound";
      readonly capacityIdentity: string;
      readonly accountRef: string;
      readonly credentialRevision: string;
      readonly creditPosture: "disabled" | "committed";
      readonly overagePosture: "disabled" | "committed";
      readonly quotaEvidence?: ManagedEconomicQuotaEvidence | null;
    }
  | {
      readonly kind: "accountless";
    };

export interface ManagedEconomicExecutionIdentity {
  readonly route: ManagedEconomicRouteIdentity;
  readonly account: ManagedEconomicAccountIdentity;
}

export interface ManagedEconomicComparisonDomain {
  readonly id: string;
  readonly rank: number;
  readonly basis: {
    readonly unit: string;
    readonly scheme: ManagedEconomicScheme;
    readonly rateCardBasis: string;
    readonly envelopeSemantics: string;
  };
}

export type ManagedEconomicExecutionEnvelope =
  | {
      readonly kind: "bounded";
      readonly digest: string;
      readonly limits: readonly ManagedEconomicAmount[];
    }
  | {
      readonly kind: "unbounded";
      readonly missingDimensions: readonly string[];
    };

export type ManagedEconomicComparableReservation =
  | {
      readonly kind: "exact";
      readonly amount: ManagedEconomicAmount;
    }
  | {
      readonly kind: "not-comparable";
      readonly reason:
        | "subscription-basis"
        | "included-basis"
        | "estimated-basis"
        | "unknown-basis"
        | "economic-basis-unavailable";
    };

export type ManagedEconomicCeiling =
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "finite";
      readonly amount: ManagedEconomicAmount;
    };

export interface ManagedEconomicExecutionAlternative {
  readonly identity: ManagedEconomicExecutionIdentity;
  readonly comparisonDomain: ManagedEconomicComparisonDomain;
  readonly priorityRank: number;
  readonly priceEvidence?: ManagedEconomicPriceEvidence | null;
  readonly executionEnvelope: ManagedEconomicExecutionEnvelope;
  readonly worstCaseReservation: ManagedEconomicComparableReservation;
  readonly ceiling: ManagedEconomicCeiling;
  readonly accountSelectionReason: "existing-affinity" | "least-pressure" | "affinity-rebind" | "accountless";
  readonly observedAffinityRevision: string | null;
}

export type ManagedEconomicCoreRejectionReason =
  | "quota-evidence-missing"
  | "quota-evidence-stale"
  | "price-evidence-missing"
  | "price-evidence-stale"
  | "comparison-domain-incompatible"
  | "execution-envelope-unbounded"
  | "ceiling-exceeded";

export interface ManagedEconomicCoreRejection {
  readonly stage: "economic-selection";
  readonly reason: ManagedEconomicCoreRejectionReason;
  readonly alternativeIdentity: ManagedEconomicExecutionIdentity;
}

export type ManagedEconomicOrderingReason =
  | "higher-comparison-domain-rank"
  | "higher-priority-rank"
  | "higher-worst-case-reservation"
  | "stable-route-id-order"
  | "stable-capacity-identity-order";

export interface ManagedEconomicNotSelected {
  readonly alternativeIdentity: ManagedEconomicExecutionIdentity;
  readonly reason: ManagedEconomicOrderingReason;
}

export interface ManagedEconomicSelectionRequest {
  /** Injected decision time makes freshness evaluation replay-stable. */
  readonly decisionAt: string;
  readonly evidenceRequirements: {
    readonly quota: "optional" | "required-for-account-bound";
    readonly price: "optional" | "required";
  };
  readonly alternatives: readonly ManagedEconomicExecutionAlternative[];
}

export interface ManagedEconomicPolicyIdentity {
  readonly policyId: string;
  readonly schemaVersion: number;
  readonly policyRevision: string;
  readonly policyDigest: string;
  readonly comparisonDomains: readonly ManagedEconomicComparisonDomain[];
  readonly noRouteAction: "deny";
  readonly evidenceRequirements: ManagedEconomicSelectionRequest["evidenceRequirements"];
}

export type ManagedEconomicSelectionExplanation =
  | {
      readonly kind: "only-eligible-alternative";
      readonly cheapestRouteClaim: false;
    }
  | {
      readonly kind: "configured-domain-order";
      readonly cheapestRouteClaim: false;
    }
  | {
      readonly kind: "configured-priority-order";
      readonly cheapestRouteClaim: false;
    }
  | {
      readonly kind: "lower-comparable-reservation";
      readonly cheapestRouteClaim: true;
    }
  | {
      readonly kind: "stable-identity-order";
      readonly cheapestRouteClaim: false;
    };

export type ManagedEconomicSelectionDecision =
  | {
      readonly kind: "selected";
      readonly selected: ManagedEconomicExecutionAlternative;
      readonly rejected: readonly ManagedEconomicCoreRejection[];
      readonly notSelected: readonly ManagedEconomicNotSelected[];
      readonly explanation: ManagedEconomicSelectionExplanation;
    }
  | {
      readonly kind: "denied";
      readonly rejected: readonly ManagedEconomicCoreRejection[];
    };

export interface ManagedEconomicCallerConstraint {
  readonly routeIds?: readonly string[];
  readonly providerIds?: readonly string[];
  readonly modelIds?: readonly string[];
}

export type ManagedEconomicAdoptedAccountPolicy =
  | { readonly kind: "accountless" }
  | { readonly kind: "account-bound"; readonly accountPolicyId: string };

export interface ManagedEconomicAdmittedCandidateIdentity {
  readonly routeId: string;
  readonly sourceIdentity: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  readonly accountPolicy: ManagedEconomicAdoptedAccountPolicy;
  /** Digest of the complete, secret/path-free execution authority projection. */
  readonly profileAuthorityDigest: string;
}

/** Config-owned route evidence before Runtime attaches current account evidence. */
export interface ManagedEconomicAdoptedRoute {
  readonly admittedIdentity: ManagedEconomicAdmittedCandidateIdentity;
  readonly route: ManagedEconomicRouteIdentity;
  readonly comparisonDomain: ManagedEconomicComparisonDomain;
  readonly priorityRank: number;
  readonly priceEvidence: ManagedEconomicPriceEvidence;
  readonly rateSchedule: {
    readonly unitRates: readonly ManagedEconomicReservationUnitRate[];
    readonly auxiliaryCharges: readonly ManagedEconomicReservationAuxiliaryCharge[];
  };
  readonly executionEnvelope: Extract<ManagedEconomicExecutionEnvelope, { readonly kind: "bounded" }>;
  readonly worstCaseReservation: ManagedEconomicComparableReservation;
  readonly ceiling: ManagedEconomicCeiling;
}

export interface ManagedEconomicAdoptedSnapshotInput {
  readonly policy: ManagedEconomicPolicyIdentity;
  readonly adoptedAt: string;
  /** Durable decision-time basis; replay must not resample wall-clock time. */
  readonly adoptedDecisionAt: string;
  readonly callerConstraints: ManagedEconomicCallerConstraint;
  readonly routes: readonly ManagedEconomicAdoptedRoute[];
}

export interface ManagedEconomicAdoptedSnapshot extends ManagedEconomicAdoptedSnapshotInput {
  readonly candidateSetDigest: string;
  readonly snapshotDigest: string;
}

export interface ManagedEconomicAdoptedSnapshotExpectation {
  readonly policyId: string;
  readonly policyRevision: string;
  readonly candidateSetDigest: string;
  readonly admittedCandidates: readonly ManagedEconomicAdmittedCandidateIdentity[];
  readonly callerConstraints: ManagedEconomicCallerConstraint;
}

export interface ManagedEconomicReservation {
  readonly reservationId: string;
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly policy: ManagedEconomicPolicyIdentity;
  readonly selectedIdentity: ManagedEconomicExecutionIdentity;
  readonly priceIdentity: ManagedEconomicPriceIdentity | null;
  readonly envelope: Extract<ManagedEconomicExecutionEnvelope, { readonly kind: "bounded" }>;
  readonly amounts: readonly ManagedEconomicAmount[];
  readonly authorityRevision: string;
}

export interface ManagedEconomicCommitment {
  readonly commitmentId: string;
  readonly reservation: ManagedEconomicReservation;
  readonly rejected: readonly ManagedEconomicCoreRejection[];
  readonly notSelected: readonly ManagedEconomicNotSelected[];
}

export type ManagedEconomicSettlement =
  | {
      readonly kind: "charged";
      readonly reservationId: string;
      readonly dispatchFenceId: string;
      readonly actualIdentity: ManagedEconomicExecutionIdentity;
      readonly units: readonly ManagedEconomicAmount[];
      readonly charge: ManagedEconomicAmount;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "estimated";
      readonly reservationId: string;
      readonly dispatchFenceId: string;
      readonly actualIdentity: ManagedEconomicExecutionIdentity;
      readonly units: readonly ManagedEconomicAmount[];
      readonly estimate: ManagedEconomicAmount;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "subscription";
      readonly reservationId: string;
      readonly dispatchFenceId: string;
      readonly actualIdentity: ManagedEconomicExecutionIdentity;
      readonly units: readonly ManagedEconomicAmount[];
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "included";
      readonly reservationId: string;
      readonly dispatchFenceId: string;
      readonly actualIdentity: ManagedEconomicExecutionIdentity;
      readonly units: readonly ManagedEconomicAmount[];
      readonly allowanceId: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "free";
      readonly reservationId: string;
      readonly dispatchFenceId: string;
      readonly actualIdentity: ManagedEconomicExecutionIdentity;
      readonly units: readonly ManagedEconomicAmount[];
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "unknown";
      readonly reservationId: string;
      readonly dispatchFenceId: string;
      readonly actualIdentity: ManagedEconomicExecutionIdentity | null;
      readonly reason: string;
      readonly evidence: ManagedEconomicEvidenceIdentity | null;
    }
  | {
      readonly kind: "pending";
      readonly reservationId: string;
      readonly dispatchFenceId: string;
    }
  | {
      readonly kind: "leaked";
      readonly reservationId: string;
      readonly dispatchFenceId: string;
      readonly reason: string;
    };

export interface ManagedEconomicSettlementExpectation {
  readonly reservationId: string;
  readonly dispatchFenceId: string;
  readonly selectedIdentity: ManagedEconomicExecutionIdentity;
}

export interface ManagedEconomicExecutionReport {
  readonly actualIdentity: ManagedEconomicExecutionIdentity;
  readonly usage:
    | {
        readonly kind: "complete";
        readonly units: readonly ManagedEconomicAmount[];
      }
    | {
        readonly kind: "incomplete";
        readonly knownUnits: readonly ManagedEconomicAmount[];
        readonly reason: string;
      };
  readonly evidence: ManagedEconomicEvidenceIdentity;
  readonly providerCharge?: {
    readonly amount: ManagedEconomicAmount;
    readonly evidence: ManagedEconomicEvidenceIdentity;
  };
}

export function createManagedEconomicSettlement(input: {
  readonly commitment: ManagedEconomicCommitment;
  readonly dispatchFenceId: string;
  readonly adoptedRoute: ManagedEconomicAdoptedRoute;
  readonly report: ManagedEconomicExecutionReport;
}): ManagedEconomicSettlement {
  const expectation: ManagedEconomicSettlementExpectation = {
    reservationId: input.commitment.reservation.reservationId,
    dispatchFenceId: input.dispatchFenceId,
    selectedIdentity: input.commitment.reservation.selectedIdentity,
  };
  requireEvidenceIdentity(input.report.evidence);
  if (
    digestManagedEconomicValue(input.report.actualIdentity)
    !== digestManagedEconomicValue(expectation.selectedIdentity)
  ) {
    throw new ManagedEconomicValidationError("execution report actual identity does not match commitment");
  }
  const units = input.report.usage.kind === "complete"
    ? input.report.usage.units
    : input.report.usage.knownUnits;
  for (const unit of units) validateManagedEconomicAmount(unit);
  if (input.report.providerCharge !== undefined) {
    validateManagedEconomicAmount(input.report.providerCharge.amount);
    requireEvidenceIdentity(input.report.providerCharge.evidence);
    if (
      input.report.providerCharge.amount.unit !== input.adoptedRoute.route.unit
      || !sameScheme(input.report.providerCharge.amount.scheme, input.adoptedRoute.route.scheme)
    ) {
      throw new ManagedEconomicValidationError(
        "provider charge does not match the committed route scheme",
      );
    }
    return validateManagedEconomicSettlement({
      kind: "charged",
      reservationId: expectation.reservationId,
      dispatchFenceId: expectation.dispatchFenceId,
      actualIdentity: input.report.actualIdentity,
      units,
      charge: input.report.providerCharge.amount,
      evidence: input.report.providerCharge.evidence,
    }, expectation);
  }
  if (input.report.usage.kind === "incomplete") {
    requireIdentity(input.report.usage.reason, "incomplete execution usage reason");
    return validateManagedEconomicSettlement({
      kind: "unknown",
      reservationId: expectation.reservationId,
      dispatchFenceId: expectation.dispatchFenceId,
      actualIdentity: input.report.actualIdentity,
      reason: input.report.usage.reason,
      evidence: input.report.evidence,
    }, expectation);
  }
  const common = {
    reservationId: expectation.reservationId,
    dispatchFenceId: expectation.dispatchFenceId,
    actualIdentity: input.report.actualIdentity,
    units,
    evidence: input.report.evidence,
  } as const;
  const price = input.adoptedRoute.priceEvidence;
  if (price.kind === "subscription" || price.kind === "free") {
    return validateManagedEconomicSettlement({ ...common, kind: price.kind }, expectation);
  }
  if (price.kind === "included") {
    return validateManagedEconomicSettlement({
      ...common,
      kind: "included",
      allowanceId: price.allowanceId,
    }, expectation);
  }
  if (price.kind === "metered" || price.kind === "estimated") {
    if (input.adoptedRoute.route.scheme.kind === "unit") {
      return validateManagedEconomicSettlement({
        kind: "unknown",
        reservationId: expectation.reservationId,
        dispatchFenceId: expectation.dispatchFenceId,
        actualIdentity: input.report.actualIdentity,
        reason: "local-estimate-scheme-unavailable",
        evidence: input.report.evidence,
      }, expectation);
    }
    const estimate = deriveManagedEconomicMinimumReservation({
      unitRates: input.adoptedRoute.rateSchedule.unitRates,
      usageLimits: units,
      auxiliaryCharges: input.adoptedRoute.rateSchedule.auxiliaryCharges,
      outputUnit: input.adoptedRoute.route.unit,
      targetScheme: input.adoptedRoute.route.scheme,
    });
    const sourceDigest = digestManagedEconomicValue({
      report: input.report,
      rateSchedule: input.adoptedRoute.rateSchedule,
      priceIdentity: price.identity,
    });
    return validateManagedEconomicSettlement({
      ...common,
      kind: "estimated",
      estimate,
      evidence: {
        sourceIdentity: `kiln-local-estimate:${input.report.evidence.sourceIdentity}`,
        sourceRevision: sourceDigest,
        sourceDigest,
        observedAt: input.report.evidence.observedAt,
        validUntil: input.report.evidence.validUntil,
        confidence: input.report.evidence.confidence,
        authority: "calculated-estimate",
      },
    }, expectation);
  }
  return validateManagedEconomicSettlement({
    kind: "unknown",
    reservationId: expectation.reservationId,
    dispatchFenceId: expectation.dispatchFenceId,
    actualIdentity: input.report.actualIdentity,
    reason: "price-authority-unavailable",
    evidence: input.report.evidence,
  }, expectation);
}

/** Validates settlement identity and exact economic evidence against one commitment fence. */
export function validateManagedEconomicSettlement(
  settlement: ManagedEconomicSettlement,
  expectation: ManagedEconomicSettlementExpectation,
): ManagedEconomicSettlement {
  requireAllowed(
    settlement.kind,
    ["charged", "estimated", "subscription", "included", "free", "unknown", "pending", "leaked"],
    "settlement kind",
  );
  requireIdentity(settlement.reservationId, "settlement reservation id");
  requireIdentity(settlement.dispatchFenceId, "settlement dispatch fence id");
  if (settlement.reservationId !== expectation.reservationId) {
    throw new ManagedEconomicValidationError("settlement reservation does not match commitment");
  }
  if (settlement.dispatchFenceId !== expectation.dispatchFenceId) {
    throw new ManagedEconomicValidationError("settlement dispatch fence does not match commitment");
  }
  if (settlement.kind === "pending") return settlement;
  if (settlement.kind === "leaked") {
    requireIdentity(settlement.reason, "leaked settlement reason");
    return settlement;
  }
  if (settlement.kind === "unknown") {
    requireIdentity(settlement.reason, "unknown settlement reason");
    if (
      settlement.actualIdentity !== null
      && digestManagedEconomicValue(settlement.actualIdentity)
        !== digestManagedEconomicValue(expectation.selectedIdentity)
    ) {
      throw new ManagedEconomicValidationError("settlement actual identity does not match commitment");
    }
    if (settlement.evidence !== null) requireEvidenceIdentity(settlement.evidence);
    return settlement;
  }
  if (
    digestManagedEconomicValue(settlement.actualIdentity)
    !== digestManagedEconomicValue(expectation.selectedIdentity)
  ) {
    throw new ManagedEconomicValidationError("settlement actual identity does not match commitment");
  }
  if (!Array.isArray(settlement.units)) {
    throw new ManagedEconomicValidationError("settlement units must be an array");
  }
  const units = new Set<string>();
  for (const unit of settlement.units) {
    validateManagedEconomicAmount(unit);
    if (unit.scheme.kind !== "unit") {
      throw new ManagedEconomicValidationError("settlement provider units must use the unit scheme");
    }
    if (units.has(unit.unit)) {
      throw new ManagedEconomicValidationError("settlement provider units must be unique");
    }
    units.add(unit.unit);
  }
  requireEvidenceIdentity(settlement.evidence);
  if (settlement.kind === "charged") {
    validateManagedEconomicAmount(settlement.charge);
    if (settlement.evidence.authority !== "provider-reported") {
      throw new ManagedEconomicValidationError("charged settlement requires provider-reported evidence");
    }
  } else if (settlement.kind === "estimated") {
    validateManagedEconomicAmount(settlement.estimate);
    if (settlement.evidence.authority !== "calculated-estimate") {
      throw new ManagedEconomicValidationError("estimated settlement requires calculated evidence");
    }
  } else if (settlement.kind === "included") {
    requireIdentity(settlement.allowanceId, "included settlement allowance id");
  }
  return settlement;
}

const CANONICAL_ATOMS = /^(?:0|[1-9][0-9]*)$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA_256_DIGEST = /^sha256:[0-9a-f]{64}$/;
/** Bounds canonical exact arithmetic while retaining sub-atto unit precision. */
export const MAX_MANAGED_ECONOMIC_DECIMAL_SCALE = 18;

export class ManagedEconomicValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ManagedEconomicValidationError";
  }
}

export function validateManagedEconomicAmount(amount: ManagedEconomicAmount): void {
  if (!CANONICAL_ATOMS.test(amount.atoms)) {
    throw new ManagedEconomicValidationError("amount atoms must be canonical non-negative base-10");
  }
  if (
    !Number.isSafeInteger(amount.scale)
    || amount.scale < 0
    || amount.scale > MAX_MANAGED_ECONOMIC_DECIMAL_SCALE
  ) {
    throw new ManagedEconomicValidationError(
      `amount scale must be an integer from 0 to ${MAX_MANAGED_ECONOMIC_DECIMAL_SCALE}`,
    );
  }
  requireIdentity(amount.unit, "amount unit");
  validateScheme(amount.scheme);
}

export interface ManagedEconomicReservationUnitRate {
  readonly usageUnit: string;
  readonly price: ManagedEconomicAmount;
}

export interface ManagedEconomicReservationAuxiliaryCharge {
  readonly id: string;
  readonly amount: ManagedEconomicAmount;
}

export interface ManagedEconomicMinimumReservationInput {
  readonly unitRates: readonly ManagedEconomicReservationUnitRate[];
  readonly usageLimits: readonly ManagedEconomicAmount[];
  readonly auxiliaryCharges: readonly ManagedEconomicReservationAuxiliaryCharge[];
  readonly outputUnit: string;
  readonly targetScheme: Exclude<ManagedEconomicScheme, { readonly kind: "unit" }>;
}

/**
 * Derives the minimum comparable reservation implied by a rate schedule and
 * bounded usage. The caller may configure a larger conservative reservation.
 */
export function deriveManagedEconomicMinimumReservation(
  input: ManagedEconomicMinimumReservationInput,
): ManagedEconomicAmount {
  requireIdentity(input.outputUnit, "reservation output unit");
  const targetScheme = input.targetScheme as ManagedEconomicScheme;
  validateScheme(targetScheme);
  if (targetScheme.kind === "unit") {
    throw new ManagedEconomicValidationError("reservation target scheme must be currency or credit");
  }
  if (!Array.isArray(input.unitRates) || !Array.isArray(input.usageLimits) || !Array.isArray(input.auxiliaryCharges)) {
    throw new ManagedEconomicValidationError("reservation rates, limits, and auxiliary charges must be arrays");
  }

  const rates = new Map<string, ManagedEconomicReservationUnitRate>();
  for (const rate of input.unitRates) {
    requireIdentity(rate.usageUnit, "reservation rate usage unit");
    validateManagedEconomicAmount(rate.price);
    if (rate.price.unit !== rate.usageUnit) {
      throw new ManagedEconomicValidationError("reservation rate usageUnit must equal price.unit");
    }
    if (!sameScheme(rate.price.scheme, targetScheme)) {
      throw new ManagedEconomicValidationError("reservation rate scheme must match target scheme");
    }
    if (rates.has(rate.usageUnit)) {
      throw new ManagedEconomicValidationError("reservation rates must not duplicate a usage unit");
    }
    rates.set(rate.usageUnit, rate);
  }

  const limits = new Map<string, ManagedEconomicAmount>();
  for (const limit of input.usageLimits) {
    validateManagedEconomicAmount(limit);
    if (limit.scheme.kind !== "unit") {
      throw new ManagedEconomicValidationError("reservation usage limits must use the unit scheme");
    }
    if (limits.has(limit.unit)) {
      throw new ManagedEconomicValidationError("reservation limits must not duplicate a usage unit");
    }
    limits.set(limit.unit, limit);
  }
  if ([...rates.keys()].some((unit) => !limits.has(unit))) {
    throw new ManagedEconomicValidationError("every reservation rate must have exactly one matching usage limit");
  }

  const terms: Array<{ atoms: bigint; scale: number }> = [];
  for (const [usageUnit, rate] of rates) {
    const limit = limits.get(usageUnit)!;
    terms.push(normalizeReservationTerm(
      BigInt(rate.price.atoms) * BigInt(limit.atoms),
      rate.price.scale + limit.scale,
    ));
  }

  const auxiliaryIds = new Set<string>();
  for (const charge of input.auxiliaryCharges) {
    requireIdentity(charge.id, "reservation auxiliary charge id");
    if (auxiliaryIds.has(charge.id)) {
      throw new ManagedEconomicValidationError("reservation auxiliary charge ids must be unique");
    }
    auxiliaryIds.add(charge.id);
    validateManagedEconomicAmount(charge.amount);
    if (charge.amount.unit !== input.outputUnit) {
      throw new ManagedEconomicValidationError("reservation auxiliary charge unit must equal output unit");
    }
    if (!sameScheme(charge.amount.scheme, targetScheme)) {
      throw new ManagedEconomicValidationError("reservation auxiliary charge scheme must match target scheme");
    }
    terms.push(normalizeReservationTerm(BigInt(charge.amount.atoms), charge.amount.scale));
  }

  const scale = terms.reduce((maximum, term) => Math.max(maximum, term.scale), 0);
  const atoms = terms.reduce(
    (total, term) => total + term.atoms * powerOfTen(scale - term.scale),
    0n,
  );
  const normalized = normalizeReservationTerm(atoms, scale);
  return {
    atoms: normalized.atoms.toString(),
    scale: normalized.scale,
    unit: input.outputUnit,
    scheme: input.targetScheme,
  };
}

function normalizeReservationTerm(atoms: bigint, scale: number): { atoms: bigint; scale: number } {
  while (scale > 0 && atoms % 10n === 0n) {
    atoms /= 10n;
    scale -= 1;
  }
  if (scale > MAX_MANAGED_ECONOMIC_DECIMAL_SCALE) {
    throw new ManagedEconomicValidationError(
      `derived reservation scale exceeds ${MAX_MANAGED_ECONOMIC_DECIMAL_SCALE}`,
    );
  }
  return { atoms, scale };
}

export function compareManagedEconomicAmounts(
  left: ManagedEconomicAmount,
  right: ManagedEconomicAmount,
): number {
  validateManagedEconomicAmount(left);
  validateManagedEconomicAmount(right);
  if (left.unit !== right.unit || !sameScheme(left.scheme, right.scheme)) {
    throw new ManagedEconomicValidationError("amounts use incompatible units or schemes");
  }

  const scale = Math.max(left.scale, right.scale);
  const leftAtoms = BigInt(left.atoms) * powerOfTen(scale - left.scale);
  const rightAtoms = BigInt(right.atoms) * powerOfTen(scale - right.scale);
  return leftAtoms < rightAtoms ? -1 : leftAtoms > rightAtoms ? 1 : 0;
}

export function narrowManagedEconomicExecutionAlternatives(
  alternatives: readonly ManagedEconomicExecutionAlternative[],
  constraint: ManagedEconomicCallerConstraint,
): readonly ManagedEconomicExecutionAlternative[] {
  const routeIds = constraint.routeIds === undefined ? null : new Set(constraint.routeIds);
  const providerIds = constraint.providerIds === undefined ? null : new Set(constraint.providerIds);
  const modelIds = constraint.modelIds === undefined ? null : new Set(constraint.modelIds);
  return alternatives.filter(({ identity }) =>
    (routeIds === null || routeIds.has(identity.route.routeId))
    && (providerIds === null || providerIds.has(identity.route.providerId))
    && (modelIds === null || modelIds.has(identity.route.modelId)));
}

export function orderManagedEconomicExecutionAlternatives(
  alternatives: readonly ManagedEconomicExecutionAlternative[],
): readonly ManagedEconomicExecutionAlternative[] {
  const exactGroups = new Set<string>();
  const nonExactGroups = new Set<string>();
  for (const alternative of alternatives) {
    const key = comparisonGroupKey(alternative);
    (alternative.worstCaseReservation.kind === "exact" ? exactGroups : nonExactGroups).add(key);
  }
  const amountComparableGroups = new Set(
    [...exactGroups].filter((key) => !nonExactGroups.has(key)),
  );
  return [...alternatives].sort((left, right) =>
    compareAlternatives(left, right, amountComparableGroups));
}

function compareAlternatives(
  left: ManagedEconomicExecutionAlternative,
  right: ManagedEconomicExecutionAlternative,
  amountComparableGroups: ReadonlySet<string>,
): number {
  const domain = compareIntegerRank(left.comparisonDomain.rank, right.comparisonDomain.rank);
  if (domain !== 0) {
    return domain;
  }
  const priority = compareIntegerRank(left.priorityRank, right.priorityRank);
  if (priority !== 0) {
    return priority;
  }

  const groupKey = comparisonGroupKey(left);
  if (
    amountComparableGroups.has(groupKey)
    && left.worstCaseReservation.kind === "exact"
    && right.worstCaseReservation.kind === "exact"
  ) {
    const amountComparison = compareManagedEconomicAmounts(
      left.worstCaseReservation.amount,
      right.worstCaseReservation.amount,
    );
    if (amountComparison !== 0) {
      return amountComparison;
    }
  }

  const route = compareStableStrings(left.identity.route.routeId, right.identity.route.routeId);
  if (route !== 0) {
    return route;
  }
  return compareStableStrings(stableCapacityIdentity(left), stableCapacityIdentity(right));
}

function comparisonGroupKey(alternative: ManagedEconomicExecutionAlternative): string {
  return `${alternative.comparisonDomain.rank}\u0000${alternative.priorityRank}`;
}

export function selectManagedEconomicExecutionAlternative(
  request: ManagedEconomicSelectionRequest,
): ManagedEconomicSelectionDecision {
  requireTimestamp(request.decisionAt, "decisionAt");
  const rejected: ManagedEconomicCoreRejection[] = [];
  const eligible: ManagedEconomicExecutionAlternative[] = [];
  const incompatibleAlternatives = findSetLevelIncompatibilities(request.alternatives);

  for (const alternative of request.alternatives) {
    const reason = rejectionReason(
      alternative,
      request,
      incompatibleAlternatives.has(alternative),
    );
    if (reason === null) {
      eligible.push(alternative);
    } else {
      rejected.push({
        stage: "economic-selection",
        reason,
        alternativeIdentity: alternative.identity,
      });
    }
  }

  if (eligible.length === 0) {
    return { kind: "denied", rejected: rejected.sort(compareRejections) };
  }

  const ordered = orderManagedEconomicExecutionAlternatives(eligible);
  const selected = ordered[0]!;
  const selectedGroupUsesAmount = eligible
    .filter((candidate) =>
      candidate.comparisonDomain.rank === selected.comparisonDomain.rank
      && candidate.priorityRank === selected.priorityRank)
    .every((candidate) => candidate.worstCaseReservation.kind === "exact");
  const notSelected = ordered.slice(1).map((alternative) => ({
    alternativeIdentity: alternative.identity,
    reason: orderingReason(selected, alternative, selectedGroupUsesAmount),
  }));
  return {
    kind: "selected",
    selected,
    rejected: rejected.sort(compareRejections),
    notSelected,
    explanation: selectionExplanation(selected, ordered.slice(1)),
  };
}

function rejectionReason(
  alternative: ManagedEconomicExecutionAlternative,
  request: ManagedEconomicSelectionRequest,
  setLevelIncompatible: boolean,
): ManagedEconomicCoreRejectionReason | null {
  try {
    validateAlternativeIdentity(alternative);
  } catch (error) {
    if (error instanceof ManagedEconomicValidationError) {
      return "comparison-domain-incompatible";
    }
    throw error;
  }

  if (
    alternative.identity.account.kind === "account-bound"
    && request.evidenceRequirements.quota === "required-for-account-bound"
  ) {
    const quota = alternative.identity.account.quotaEvidence;
    if (quota === undefined || quota === null) {
      return "quota-evidence-missing";
    }
    if (quota.kind === "unknown") {
      return "quota-evidence-missing";
    }
    if (!isEvidenceCurrent(quota.evidence, request.decisionAt)) {
      return "quota-evidence-stale";
    }
  }

  const price = alternative.priceEvidence;
  if (price === undefined || price === null) {
    if (request.evidenceRequirements.price === "required") {
      return "price-evidence-missing";
    }
  } else if (!isEvidenceCurrent(price.identity.evidence, request.decisionAt)) {
    return "price-evidence-stale";
  } else if (price.kind === "unknown" && request.evidenceRequirements.price === "required") {
    return "price-evidence-missing";
  }

  if (alternative.executionEnvelope.kind === "unbounded") {
    return "execution-envelope-unbounded";
  }
  if (setLevelIncompatible) {
    return "comparison-domain-incompatible";
  }

  try {
    validateAlternativeRanks(alternative);
    validateDomainCompatibility(alternative);
  } catch (error) {
    if (error instanceof ManagedEconomicValidationError) {
      return "comparison-domain-incompatible";
    }
    throw error;
  }

  if (alternative.ceiling.kind === "finite") {
    if (alternative.worstCaseReservation.kind !== "exact") {
      return "execution-envelope-unbounded";
    }
    try {
      if (
        compareManagedEconomicAmounts(
          alternative.worstCaseReservation.amount,
          alternative.ceiling.amount,
        ) > 0
      ) {
        return "ceiling-exceeded";
      }
    } catch (error) {
      if (error instanceof ManagedEconomicValidationError) {
        return "comparison-domain-incompatible";
      }
      throw error;
    }
  }
  return null;
}

function validateAlternativeIdentity(alternative: ManagedEconomicExecutionAlternative): void {
  const { route, account } = alternative.identity;
  requireAllowed(account.kind, ["account-bound", "accountless"], "account identity kind");
  requireAllowed(
    alternative.accountSelectionReason,
    ["existing-affinity", "least-pressure", "affinity-rebind", "accountless"],
    "account selection reason",
  );
  requireAllowed(
    alternative.executionEnvelope.kind,
    ["bounded", "unbounded"],
    "execution envelope kind",
  );
  requireAllowed(
    alternative.worstCaseReservation.kind,
    ["exact", "not-comparable"],
    "reservation comparability kind",
  );
  requireAllowed(alternative.ceiling.kind, ["none", "finite"], "ceiling kind");
  for (const [value, label] of [
    [route.routeId, "route id"],
    [route.providerId, "provider id"],
    [route.modelId, "model id"],
    [route.adapterCapabilityId, "adapter capability id"],
    [route.adapterCapabilityVersion, "adapter capability version"],
    [route.authBillingChannel, "auth billing channel"],
    [route.executionMode, "execution mode"],
    [route.serviceTier, "service tier"],
    [route.rateCardId, "rate card id"],
    [route.rateCardRevision, "rate card revision"],
    [route.unit, "route unit"],
    [route.contextClass, "context class"],
    [route.cacheClass, "cache class"],
  ] as const) {
    requireIdentity(value, label);
  }
  validateScheme(route.scheme);
  requireDigest(route.priceEvidenceDigest, "route price evidence digest");
  requireDigest(route.auxiliaryScheduleDigest, "route auxiliary schedule digest");
  requireDigest(route.envelopeDigest, "route envelope digest");
  requireAllowed(route.fallbackPosture, ["disabled", "committed"], "fallback posture");
  requireAllowed(route.overagePosture, ["disabled", "committed"], "overage posture");

  if (account.kind === "account-bound") {
    requireIdentity(account.capacityIdentity, "account capacity identity");
    requireIdentity(account.accountRef, "account reference");
    requireIdentity(account.credentialRevision, "credential revision");
    requireAllowed(account.creditPosture, ["disabled", "committed"], "credit posture");
    requireAllowed(account.overagePosture, ["disabled", "committed"], "account overage posture");
    if (route.accountPolicyId === null) {
      throw new ManagedEconomicValidationError("account-bound route requires an account policy");
    }
    requireIdentity(route.accountPolicyId, "account policy id");
    if (account.quotaEvidence !== undefined && account.quotaEvidence !== null) {
      validateQuotaEvidence(account.quotaEvidence, account.capacityIdentity);
    }
    if (alternative.accountSelectionReason === "accountless") {
      throw new ManagedEconomicValidationError("account-bound alternative cannot be accountless");
    }
    if (alternative.observedAffinityRevision !== null) {
      requireIdentity(alternative.observedAffinityRevision, "observed affinity revision");
    }
  } else {
    if (route.accountPolicyId !== null) {
      throw new ManagedEconomicValidationError("accountless route cannot reference an account policy");
    }
    if (
      alternative.accountSelectionReason !== "accountless"
      || alternative.observedAffinityRevision !== null
    ) {
      throw new ManagedEconomicValidationError("accountless alternative has account-bound evidence");
    }
  }

  if (alternative.executionEnvelope.kind === "bounded") {
    requireDigest(alternative.executionEnvelope.digest, "execution envelope digest");
    if (alternative.executionEnvelope.digest !== route.envelopeDigest) {
      throw new ManagedEconomicValidationError("execution envelope digest does not match route identity");
    }
  }
  if (alternative.priceEvidence !== undefined && alternative.priceEvidence !== null) {
    validatePriceEvidence(alternative.priceEvidence);
  }
}

function validateQuotaEvidence(
  quota: ManagedEconomicQuotaEvidence,
  capacityIdentity: string,
): void {
  requireAllowed(quota.kind, ["known", "unlimited", "unknown"], "quota evidence kind");
  requireIdentity(quota.capacityIdentity, "quota capacity identity");
  if (quota.capacityIdentity !== capacityIdentity) {
    throw new ManagedEconomicValidationError("quota evidence belongs to another capacity identity");
  }
  validateQuotaObservation(quota);
  if (quota.kind === "unknown") {
    if (quota.subscriptionClass !== "unknown") {
      throw new ManagedEconomicValidationError("unknown quota requires unknown subscription class");
    }
    requireIdentity(quota.reason, "unknown quota reason");
    if (quota.evidence !== null) {
      requireEvidenceIdentity(quota.evidence);
    }
    return;
  }

  requireAllowed(
    quota.subscriptionClass,
    ["subscription", "included", "free", "metered", "unknown"],
    "subscription class",
  );
  requireIdentity(quota.quotaClassId, "quota class id");
  requireEvidenceIdentity(quota.evidence);
  if (quota.kind === "known") {
    if (quota.buckets.length === 0) {
      throw new ManagedEconomicValidationError("known quota requires at least one bucket");
    }
    const bucketIds = new Set<string>();
    for (const bucket of quota.buckets) {
      requireIdentity(bucket.bucketId, "quota bucket id");
      requireIdentity(bucket.dimension, "quota bucket dimension");
      if (bucketIds.has(bucket.bucketId)) {
        throw new ManagedEconomicValidationError("quota bucket ids must be unique");
      }
      bucketIds.add(bucket.bucketId);
      if (bucket.remaining !== null) {
        validateManagedEconomicAmount(bucket.remaining);
      }
      if (
        bucket.windowDurationMinutes !== undefined
        && bucket.windowDurationMinutes !== null
        && (!Number.isSafeInteger(bucket.windowDurationMinutes) || bucket.windowDurationMinutes <= 0)
      ) {
        throw new ManagedEconomicValidationError("quota bucket window duration must be a positive integer");
      }
      if (bucket.resetsAt !== null) {
        requireTimestamp(bucket.resetsAt, "quota reset time");
      }
    }
  }
}

function validateQuotaObservation(quota: ManagedEconomicQuotaObservation): void {
  if (quota.credits !== undefined && quota.credits !== null) {
    requireAllowed(
      quota.credits.status,
      ["available", "unavailable", "unlimited", "unknown"],
      "quota credit status",
    );
    if (quota.credits.balance !== null) validateManagedEconomicAmount(quota.credits.balance);
    if (quota.credits.status === "unavailable" && quota.credits.balance !== null) {
      throw new ManagedEconomicValidationError("unavailable quota credits cannot include a balance");
    }
  }
  if (quota.spendControl !== undefined && quota.spendControl !== null) {
    requireAllowed(
      quota.spendControl.status,
      ["available", "exhausted", "unknown"],
      "quota spend control status",
    );
    if (quota.spendControl.limit !== null) validateManagedEconomicAmount(quota.spendControl.limit);
    if (quota.spendControl.used !== null) validateManagedEconomicAmount(quota.spendControl.used);
    if (
      quota.spendControl.remainingPercent !== null
      && (!Number.isSafeInteger(quota.spendControl.remainingPercent)
        || quota.spendControl.remainingPercent < 0
        || quota.spendControl.remainingPercent > 100)
    ) {
      throw new ManagedEconomicValidationError("quota spend control remaining percent is invalid");
    }
    if (quota.spendControl.resetsAt !== null) {
      requireTimestamp(quota.spendControl.resetsAt, "quota spend control reset time");
    }
  }
  if (quota.exhaustionReason !== undefined && quota.exhaustionReason !== null) {
    requireAllowed(quota.exhaustionReason, [
      "rate-limit-reached",
      "workspace-owner-credits-depleted",
      "workspace-member-credits-depleted",
      "workspace-owner-usage-limit-reached",
      "workspace-member-usage-limit-reached",
      "spend-control-reached",
      "unknown",
    ], "quota exhaustion reason");
  }
}

function validatePriceEvidence(price: ManagedEconomicPriceEvidence): void {
  requireAllowed(
    price.kind,
    ["subscription", "included", "free", "metered", "unknown", "estimated"],
    "price evidence kind",
  );
  const identity = price.identity;
  for (const [value, label] of [
    [identity.providerId, "price provider id"],
    [identity.modelId, "price model id"],
    [identity.authBillingChannel, "price auth billing channel"],
    [identity.executionMode, "price execution mode"],
    [identity.serviceTier, "price service tier"],
    [identity.rateCardId, "price rate card id"],
    [identity.rateCardRevision, "price rate card revision"],
    [identity.unit, "price unit"],
    [identity.contextClass, "price context class"],
    [identity.cacheClass, "price cache class"],
  ] as const) {
    requireIdentity(value, label);
  }
  validateScheme(identity.scheme);
  requireDigest(identity.unitScheduleDigest, "price unit schedule digest");
  requireDigest(identity.auxiliaryScheduleDigest, "price auxiliary schedule digest");
  requireEvidenceIdentity(identity.evidence);
  if (price.kind === "included") {
    requireIdentity(price.allowanceId, "included allowance id");
  } else if (price.kind === "unknown") {
    requireIdentity(price.reason, "unknown price reason");
  } else if (price.kind === "estimated") {
    requireIdentity(price.estimationMethod, "price estimation method");
  }
}

function validateAlternativeRanks(alternative: ManagedEconomicExecutionAlternative): void {
  if (
    !Number.isSafeInteger(alternative.comparisonDomain.rank)
    || alternative.comparisonDomain.rank < 0
    || !Number.isSafeInteger(alternative.priorityRank)
    || alternative.priorityRank < 0
  ) {
    throw new ManagedEconomicValidationError("comparison and priority ranks must be non-negative integers");
  }
}

function validateDomainCompatibility(alternative: ManagedEconomicExecutionAlternative): void {
  const { basis } = alternative.comparisonDomain;
  requireIdentity(alternative.comparisonDomain.id, "comparison domain id");
  requireIdentity(basis.rateCardBasis, "comparison domain rate-card basis");
  requireIdentity(basis.envelopeSemantics, "comparison domain envelope semantics");
  if (
    basis.unit !== alternative.identity.route.unit
    || !sameScheme(basis.scheme, alternative.identity.route.scheme)
  ) {
    throw new ManagedEconomicValidationError("route and comparison domain use incompatible bases");
  }

  for (const limit of alternative.executionEnvelope.kind === "bounded"
    ? alternative.executionEnvelope.limits
    : []) {
    validateManagedEconomicAmount(limit);
  }

  const reservation = alternative.worstCaseReservation;
  if (reservation.kind === "exact") {
    validateManagedEconomicAmount(reservation.amount);
    if (
      reservation.amount.unit !== basis.unit
      || !sameScheme(reservation.amount.scheme, basis.scheme)
    ) {
      throw new ManagedEconomicValidationError("reservation and comparison domain are incompatible");
    }
  }
  if (alternative.ceiling.kind === "finite") {
    validateManagedEconomicAmount(alternative.ceiling.amount);
  }

  const priceKind = alternative.priceEvidence?.kind;
  if (
    alternative.priceEvidence !== undefined
    && alternative.priceEvidence !== null
    && (
      alternative.priceEvidence.identity.providerId !== alternative.identity.route.providerId
      || alternative.priceEvidence.identity.modelId !== alternative.identity.route.modelId
      || alternative.priceEvidence.identity.authBillingChannel
        !== alternative.identity.route.authBillingChannel
      || alternative.priceEvidence.identity.executionMode !== alternative.identity.route.executionMode
      || alternative.priceEvidence.identity.serviceTier !== alternative.identity.route.serviceTier
      || alternative.priceEvidence.identity.rateCardId !== alternative.identity.route.rateCardId
      || alternative.priceEvidence.identity.rateCardRevision
        !== alternative.identity.route.rateCardRevision
      || alternative.priceEvidence.identity.contextClass !== alternative.identity.route.contextClass
      || alternative.priceEvidence.identity.cacheClass !== alternative.identity.route.cacheClass
      || alternative.priceEvidence.identity.auxiliaryScheduleDigest
        !== alternative.identity.route.auxiliaryScheduleDigest
      || alternative.priceEvidence.identity.evidence.sourceDigest
        !== alternative.identity.route.priceEvidenceDigest
      || alternative.priceEvidence.identity.unit !== basis.unit
      || !sameScheme(alternative.priceEvidence.identity.scheme, basis.scheme)
    )
  ) {
    throw new ManagedEconomicValidationError("price evidence and comparison domain are incompatible");
  }
  if (
    reservation.kind === "exact"
    && priceKind !== "free"
    && priceKind !== "metered"
  ) {
    throw new ManagedEconomicValidationError("non-comparable price evidence cannot carry an exact reservation");
  }
  if (priceKind === "free" && reservation.kind === "exact" && BigInt(reservation.amount.atoms) !== 0n) {
    throw new ManagedEconomicValidationError("proven free evidence must reserve exact zero");
  }
}

function selectionExplanation(
  selected: ManagedEconomicExecutionAlternative,
  remaining: readonly ManagedEconomicExecutionAlternative[],
): ManagedEconomicSelectionExplanation {
  if (remaining.length === 0) {
    return { kind: "only-eligible-alternative", cheapestRouteClaim: false };
  }
  if (remaining.some((candidate) => candidate.comparisonDomain.rank !== selected.comparisonDomain.rank)) {
    return { kind: "configured-domain-order", cheapestRouteClaim: false };
  }
  if (remaining.some((candidate) => candidate.priorityRank !== selected.priorityRank)) {
    return { kind: "configured-priority-order", cheapestRouteClaim: false };
  }
  if (
    selected.worstCaseReservation.kind === "exact"
    && remaining.every((candidate) => candidate.worstCaseReservation.kind === "exact")
    && remaining.some((candidate) =>
      candidate.worstCaseReservation.kind === "exact"
      && compareManagedEconomicAmounts(
        selected.worstCaseReservation.kind === "exact"
          ? selected.worstCaseReservation.amount
          : candidate.worstCaseReservation.amount,
        candidate.worstCaseReservation.amount,
      ) !== 0)
  ) {
    return { kind: "lower-comparable-reservation", cheapestRouteClaim: true };
  }
  return { kind: "stable-identity-order", cheapestRouteClaim: false };
}

function orderingReason(
  selected: ManagedEconomicExecutionAlternative,
  alternative: ManagedEconomicExecutionAlternative,
  amountComparisonEnabled: boolean,
): ManagedEconomicOrderingReason {
  if (selected.comparisonDomain.rank !== alternative.comparisonDomain.rank) {
    return "higher-comparison-domain-rank";
  }
  if (selected.priorityRank !== alternative.priorityRank) {
    return "higher-priority-rank";
  }
  if (
    amountComparisonEnabled
    && selected.worstCaseReservation.kind === "exact"
    && alternative.worstCaseReservation.kind === "exact"
    && compareManagedEconomicAmounts(
      selected.worstCaseReservation.amount,
      alternative.worstCaseReservation.amount,
    ) !== 0
  ) {
    return "higher-worst-case-reservation";
  }
  if (selected.identity.route.routeId !== alternative.identity.route.routeId) {
    return "stable-route-id-order";
  }
  return "stable-capacity-identity-order";
}

function compareIntegerRank(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw new ManagedEconomicValidationError("ordering ranks must be non-negative safe integers");
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableCapacityIdentity(alternative: ManagedEconomicExecutionAlternative): string {
  return stableCapacityIdentityFromIdentity(alternative.identity);
}

function stableCapacityIdentityFromIdentity(identity: ManagedEconomicExecutionIdentity): string {
  return identity.account.kind === "accountless"
    ? "\uffffaccountless"
    : identity.account.capacityIdentity;
}

function isEvidenceCurrent(evidence: ManagedEconomicEvidenceIdentity, decisionAt: string): boolean {
  try {
    requireEvidenceIdentity(evidence);
    requireTimestamp(decisionAt, "decisionAt");
  } catch (error) {
    if (error instanceof ManagedEconomicValidationError) {
      return false;
    }
    throw error;
  }
  const observedAt = Date.parse(evidence.observedAt);
  const validUntil = Date.parse(evidence.validUntil);
  const decisionTime = Date.parse(decisionAt);
  return observedAt <= decisionTime && decisionTime < validUntil;
}

function findSetLevelIncompatibilities(
  alternatives: readonly ManagedEconomicExecutionAlternative[],
): ReadonlySet<ManagedEconomicExecutionAlternative> {
  const byExecutionIdentity = new Map<string, ManagedEconomicExecutionAlternative[]>();
  for (const alternative of alternatives) {
    const key = [
      alternative.identity.route.routeId,
      stableCapacityIdentity(alternative),
    ].join("\u0000");
    const duplicates = byExecutionIdentity.get(key) ?? [];
    duplicates.push(alternative);
    byExecutionIdentity.set(key, duplicates);
  }

  const byRank = new Map<number, ManagedEconomicExecutionAlternative[]>();
  for (const alternative of alternatives) {
    const group = byRank.get(alternative.comparisonDomain.rank) ?? [];
    group.push(alternative);
    byRank.set(alternative.comparisonDomain.rank, group);
  }

  const incompatible = new Set<ManagedEconomicExecutionAlternative>();
  for (const duplicates of byExecutionIdentity.values()) {
    if (duplicates.length > 1) {
      duplicates.forEach((alternative) => incompatible.add(alternative));
    }
  }
  for (const rankGroup of byRank.values()) {
    const domainFingerprints = new Set(rankGroup.map(domainFingerprint));
    if (domainFingerprints.size > 1) {
      rankGroup.forEach((alternative) => incompatible.add(alternative));
      continue;
    }

  }
  return incompatible;
}

function compareRejections(
  left: ManagedEconomicCoreRejection,
  right: ManagedEconomicCoreRejection,
): number {
  const route = compareStableStrings(
    left.alternativeIdentity.route.routeId,
    right.alternativeIdentity.route.routeId,
  );
  if (route !== 0) {
    return route;
  }
  const account = compareStableStrings(
    stableCapacityIdentityFromIdentity(left.alternativeIdentity),
    stableCapacityIdentityFromIdentity(right.alternativeIdentity),
  );
  if (account !== 0) {
    return account;
  }
  const reason = compareStableStrings(left.reason, right.reason);
  return reason !== 0
    ? reason
    : compareStableStrings(
      canonicalizeManagedEconomicValue(left.alternativeIdentity),
      canonicalizeManagedEconomicValue(right.alternativeIdentity),
    );
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeManagedEconomicValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => entry === undefined
      ? "null"
      : canonicalizeManagedEconomicValue(entry)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareStableStrings)
    .map((key) => `${JSON.stringify(key)}:${canonicalizeManagedEconomicValue(record[key])}`)
    .join(",")}}`;
}

export function digestManagedEconomicValue(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalizeManagedEconomicValue(value), "utf8")
    .digest("hex")}`;
}

/**
 * Returns the data-only authority evidence committed by an economic candidate.
 *
 * Filesystem paths, URI-like resource references, and secret-shaped values are
 * represented by digests rather than copied into candidate evidence. Tool
 * allow-lists are sorted and deduplicated because their order is not an
 * authority semantic. This projection intentionally enumerates the authority
 * contract instead of serializing a class or adapter object.
 */
export function projectManagedEconomicProfileAuthority(
  authority: ManagedAgentAuthorityProfile,
): Readonly<Record<string, unknown>> {
  return projectManagedEconomicAuthorityValue(authority, "authority") as Readonly<Record<string, unknown>>;
}

/** Computes the V9 per-candidate authority identity. */
export function digestManagedEconomicProfileAuthority(
  authority: ManagedAgentAuthorityProfile,
): string {
  return digestManagedEconomicValue(projectManagedEconomicProfileAuthority(authority));
}

function projectManagedEconomicAuthorityValue(value: unknown, key: string): unknown {
  if (typeof value === "string") {
    if (isManagedEconomicAuthorityToolListKey(key)) {
      return value.trim();
    }
    if (isManagedEconomicAuthoritySensitiveKey(key)) {
      return digestManagedEconomicValue({
        kind: "managed-profile-authority-sensitive-value",
        value: normalizeManagedEconomicAuthoritySensitiveValue(value),
      });
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    const projected = value.map((entry) => projectManagedEconomicAuthorityValue(entry, key));
    if (isManagedEconomicAuthorityToolListKey(key)) {
      return [...new Set(projected.filter((entry): entry is string => typeof entry === "string"))]
        .sort(compareStableStrings);
    }
    return projected;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const projected: Record<string, unknown> = {};
  for (const childKey of Object.keys(record).sort(compareStableStrings)) {
    const child = record[childKey];
    if (child === undefined) continue;
    const projectedChild = projectManagedEconomicAuthorityValue(child, childKey);
    if (projectedChild !== undefined) projected[childKey] = projectedChild;
  }
  return projected;
}

function isManagedEconomicAuthorityToolListKey(key: string): boolean {
  return key === "allowedToolNames" || key === "deniedToolNames";
}

function isManagedEconomicAuthoritySensitiveKey(key: string): boolean {
  return key === "path"
    || key === "allowedPaths"
    || key === "deniedPaths"
    || key === "resourceUris"
    || key === "evidenceUris"
    || /(?:secret|token|password|api[-_]?key)/iu.test(key);
}

function normalizeManagedEconomicAuthoritySensitiveValue(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/{2,}/gu, "/");
}

export function digestManagedEconomicCandidateSet(
  candidates: readonly ManagedEconomicAdmittedCandidateIdentity[],
): string {
  return digestManagedEconomicValue([...candidates]
    .sort((left, right) => compareStableStrings(
      canonicalizeManagedEconomicValue(left),
      canonicalizeManagedEconomicValue(right),
    )));
}

export function adoptManagedEconomicSnapshot(
  input: ManagedEconomicAdoptedSnapshotInput,
): ManagedEconomicAdoptedSnapshot {
  const canonicalInput = JSON.parse(
    canonicalizeManagedEconomicValue(input),
  ) as ManagedEconomicAdoptedSnapshotInput;
  const candidateSetDigest = digestManagedEconomicCandidateSet(
    canonicalInput.routes.map(({ admittedIdentity }) => admittedIdentity),
  );
  const snapshotWithoutDigest = { ...canonicalInput, candidateSetDigest };
  const snapshot: ManagedEconomicAdoptedSnapshot = {
    ...snapshotWithoutDigest,
    snapshotDigest: digestManagedEconomicValue(snapshotWithoutDigest),
  };
  validateManagedEconomicAdoptedSnapshot(snapshot);
  return deepFreezeManagedEconomicValue(snapshot);
}

export function validateManagedEconomicAdoptedSnapshot(
  snapshot: ManagedEconomicAdoptedSnapshot,
  expectation?: ManagedEconomicAdoptedSnapshotExpectation,
): ManagedEconomicAdoptedSnapshot {
  validateManagedEconomicPolicy(snapshot.policy);
  requireTimestamp(snapshot.adoptedAt, "snapshot adoptedAt");
  requireTimestamp(snapshot.adoptedDecisionAt, "snapshot adoptedDecisionAt");
  if (Date.parse(snapshot.adoptedAt) > Date.parse(snapshot.adoptedDecisionAt)) {
    throw new ManagedEconomicValidationError("snapshot adoptedAt must not follow adoptedDecisionAt");
  }
  validateManagedEconomicCallerConstraint(snapshot.callerConstraints, "snapshot caller constraints");
  if (!Array.isArray(snapshot.routes) || snapshot.routes.length === 0) {
    throw new ManagedEconomicValidationError("adopted snapshot requires at least one route");
  }

  const identities = new Set<string>();
  for (const route of snapshot.routes) {
    validateManagedEconomicAdoptedRoute(route, snapshot.policy);
    const identity = canonicalizeManagedEconomicValue(route.admittedIdentity);
    if (identities.has(identity)) {
      throw new ManagedEconomicValidationError("adopted candidate identities must be unique");
    }
    identities.add(identity);
    if (narrowManagedEconomicAdoptedRoutes([route], snapshot.callerConstraints).length === 0) {
      throw new ManagedEconomicValidationError("adopted route violates caller constraints");
    }
  }

  const candidateSetDigest = digestManagedEconomicCandidateSet(
    snapshot.routes.map(({ admittedIdentity }) => admittedIdentity),
  );
  requireDigest(snapshot.candidateSetDigest, "candidate-set digest");
  if (snapshot.candidateSetDigest !== candidateSetDigest) {
    throw new ManagedEconomicValidationError("candidate-set digest does not match adopted routes");
  }
  requireDigest(snapshot.snapshotDigest, "snapshot digest");
  const { snapshotDigest: _snapshotDigest, ...snapshotWithoutDigest } = snapshot;
  if (snapshot.snapshotDigest !== digestManagedEconomicValue(snapshotWithoutDigest)) {
    throw new ManagedEconomicValidationError("snapshot digest does not match canonical snapshot evidence");
  }

  if (expectation !== undefined) {
    validateManagedEconomicSnapshotExpectation(snapshot, expectation);
  }
  return snapshot;
}

function validateManagedEconomicSnapshotExpectation(
  snapshot: ManagedEconomicAdoptedSnapshot,
  expectation: ManagedEconomicAdoptedSnapshotExpectation,
): void {
  requireIdentity(expectation.policyId, "expected policy id");
  requireIdentity(expectation.policyRevision, "expected policy revision");
  requireDigest(expectation.candidateSetDigest, "expected candidate-set digest");
  validateManagedEconomicCallerConstraint(expectation.callerConstraints, "persisted caller constraints");
  const expectedCandidateSetDigest = digestManagedEconomicCandidateSet(expectation.admittedCandidates);
  if (
    expectation.candidateSetDigest !== expectedCandidateSetDigest
    || snapshot.policy.policyId !== expectation.policyId
    || snapshot.policy.policyRevision !== expectation.policyRevision
    || snapshot.candidateSetDigest !== expectation.candidateSetDigest
  ) {
    throw new ManagedEconomicValidationError("identity-revision-conflict: adopted economic identity changed");
  }
  if (!isManagedEconomicCallerConstraintNarrowing(
    expectation.callerConstraints,
    snapshot.callerConstraints,
  )) {
    throw new ManagedEconomicValidationError("caller constraints cannot widen persisted admission");
  }
}

export function isManagedEconomicCallerConstraintNarrowing(
  admitted: ManagedEconomicCallerConstraint,
  requested: ManagedEconomicCallerConstraint,
): boolean {
  return constraintDimensionNarrows(admitted.routeIds, requested.routeIds)
    && constraintDimensionNarrows(admitted.providerIds, requested.providerIds)
    && constraintDimensionNarrows(admitted.modelIds, requested.modelIds);
}

function constraintDimensionNarrows(
  admitted: readonly string[] | undefined,
  requested: readonly string[] | undefined,
): boolean {
  if (admitted === undefined) return true;
  if (requested === undefined) return false;
  const admittedValues = new Set(admitted);
  return requested.every((value) => admittedValues.has(value));
}

function narrowManagedEconomicAdoptedRoutes(
  routes: readonly ManagedEconomicAdoptedRoute[],
  constraint: ManagedEconomicCallerConstraint,
): readonly ManagedEconomicAdoptedRoute[] {
  const routeIds = constraint.routeIds === undefined ? null : new Set(constraint.routeIds);
  const providerIds = constraint.providerIds === undefined ? null : new Set(constraint.providerIds);
  const modelIds = constraint.modelIds === undefined ? null : new Set(constraint.modelIds);
  return routes.filter(({ admittedIdentity }) =>
    (routeIds === null || routeIds.has(admittedIdentity.routeId))
    && (providerIds === null || providerIds.has(admittedIdentity.providerId))
    && (modelIds === null || modelIds.has(admittedIdentity.modelId)));
}

function validateManagedEconomicPolicy(policy: ManagedEconomicPolicyIdentity): void {
  requireIdentity(policy.policyId, "policy id");
  requireIdentity(policy.policyRevision, "policy revision");
  requireDigest(policy.policyDigest, "policy digest");
  if (!Number.isSafeInteger(policy.schemaVersion) || policy.schemaVersion < 1) {
    throw new ManagedEconomicValidationError("policy schema version must be a positive integer");
  }
  if (policy.noRouteAction !== "deny") {
    throw new ManagedEconomicValidationError("policy no-route action must deny");
  }
  requireAllowed(policy.evidenceRequirements.quota, ["optional", "required-for-account-bound"], "quota requirement");
  requireAllowed(policy.evidenceRequirements.price, ["optional", "required"], "price requirement");
  if (policy.comparisonDomains.length === 0) {
    throw new ManagedEconomicValidationError("policy requires at least one comparison domain");
  }
  const domainIds = new Set<string>();
  for (const comparisonDomain of policy.comparisonDomains) {
    validateComparisonDomainIdentity(comparisonDomain);
    if (domainIds.has(comparisonDomain.id)) {
      throw new ManagedEconomicValidationError("policy comparison domain ids must be unique");
    }
    domainIds.add(comparisonDomain.id);
  }
}

function validateManagedEconomicAdoptedRoute(
  adopted: ManagedEconomicAdoptedRoute,
  policy: ManagedEconomicPolicyIdentity,
): void {
  const { admittedIdentity, route } = adopted;
  for (const [value, label] of [
    [admittedIdentity.routeId, "admitted route id"],
    [admittedIdentity.sourceIdentity, "admitted route source identity"],
    [admittedIdentity.providerId, "admitted provider id"],
    [admittedIdentity.modelId, "admitted model id"],
    [admittedIdentity.adapterCapabilityId, "admitted adapter capability id"],
    [admittedIdentity.adapterCapabilityVersion, "admitted adapter capability version"],
  ] as const) requireIdentity(value, label);
  requireDigest(admittedIdentity.profileAuthorityDigest, "admitted profile authority digest");
  requireAllowed(admittedIdentity.accountPolicy.kind, ["accountless", "account-bound"], "account policy applicability");
  if (admittedIdentity.accountPolicy.kind === "account-bound") {
    requireIdentity(admittedIdentity.accountPolicy.accountPolicyId, "admitted account policy id");
  }
  if (
    admittedIdentity.routeId !== route.routeId
    || admittedIdentity.providerId !== route.providerId
    || admittedIdentity.modelId !== route.modelId
    || admittedIdentity.adapterCapabilityId !== route.adapterCapabilityId
    || admittedIdentity.adapterCapabilityVersion !== route.adapterCapabilityVersion
  ) {
    throw new ManagedEconomicValidationError("admitted identity does not match adopted route identity");
  }
  const adoptedExecutionAccountPolicyId = admittedIdentity.accountPolicy.kind === "account-bound"
    ? admittedIdentity.accountPolicy.accountPolicyId
    : null;
  if (route.accountPolicyId !== adoptedExecutionAccountPolicyId) {
    throw new ManagedEconomicValidationError("admitted account policy does not match adopted route account policy");
  }

  const validationAlternative: ManagedEconomicExecutionAlternative = {
    identity: {
      route,
      account: route.accountPolicyId === null
        ? { kind: "accountless" }
        : {
            kind: "account-bound",
            capacityIdentity: "snapshot-validation-capacity",
            accountRef: "snapshot-validation-account",
            credentialRevision: "snapshot-validation-revision",
            creditPosture: "disabled",
            overagePosture: "disabled",
          },
    },
    comparisonDomain: adopted.comparisonDomain,
    priorityRank: adopted.priorityRank,
    priceEvidence: adopted.priceEvidence,
    executionEnvelope: adopted.executionEnvelope,
    worstCaseReservation: adopted.worstCaseReservation,
    ceiling: adopted.ceiling,
    accountSelectionReason: route.accountPolicyId === null ? "accountless" : "least-pressure",
    observedAffinityRevision: null,
  };
  validateAlternativeIdentity(validationAlternative);
  validateAlternativeRanks(validationAlternative);
  validateDomainCompatibility(validationAlternative);
  validateManagedEconomicAdoptedRateSchedule(adopted);
  if (adopted.executionEnvelope.limits.length === 0) {
    throw new ManagedEconomicValidationError("adopted execution envelope requires at least one limit");
  }
  if (!policy.comparisonDomains.some((domain) =>
    canonicalizeManagedEconomicValue(domain) === canonicalizeManagedEconomicValue(adopted.comparisonDomain))) {
    throw new ManagedEconomicValidationError("adopted route comparison domain is not in policy");
  }
}

function validateManagedEconomicAdoptedRateSchedule(adopted: ManagedEconomicAdoptedRoute): void {
  const usageUnits = new Set<string>();
  for (const rate of adopted.rateSchedule.unitRates) {
    requireIdentity(rate.usageUnit, "adopted rate usage unit");
    validateManagedEconomicAmount(rate.price);
    if (rate.price.unit !== rate.usageUnit) {
      throw new ManagedEconomicValidationError("adopted rate usage unit must equal price unit");
    }
    if (!sameScheme(rate.price.scheme, adopted.route.scheme)) {
      throw new ManagedEconomicValidationError("adopted rate scheme must match route scheme");
    }
    if (usageUnits.has(rate.usageUnit)) {
      throw new ManagedEconomicValidationError("adopted rate usage units must be unique");
    }
    usageUnits.add(rate.usageUnit);
  }
  const auxiliaryIds = new Set<string>();
  for (const charge of adopted.rateSchedule.auxiliaryCharges) {
    requireIdentity(charge.id, "adopted auxiliary charge id");
    validateManagedEconomicAmount(charge.amount);
    if (!sameScheme(charge.amount.scheme, adopted.route.scheme)) {
      throw new ManagedEconomicValidationError("adopted auxiliary charge scheme must match route scheme");
    }
    if (auxiliaryIds.has(charge.id)) {
      throw new ManagedEconomicValidationError("adopted auxiliary charge ids must be unique");
    }
    auxiliaryIds.add(charge.id);
  }
  if (
    adopted.priceEvidence.identity.unitScheduleDigest
      !== digestManagedEconomicValue(adopted.rateSchedule.unitRates)
  ) {
    throw new ManagedEconomicValidationError("adopted unit rates do not match price schedule digest");
  }
  const auxiliaryDigest = digestManagedEconomicValue(adopted.rateSchedule.auxiliaryCharges);
  if (
    adopted.priceEvidence.identity.auxiliaryScheduleDigest !== auxiliaryDigest
    || adopted.route.auxiliaryScheduleDigest !== auxiliaryDigest
  ) {
    throw new ManagedEconomicValidationError("adopted auxiliary charges do not match schedule digest");
  }
}

function validateComparisonDomainIdentity(domain: ManagedEconomicComparisonDomain): void {
  requireIdentity(domain.id, "comparison domain id");
  if (!Number.isSafeInteger(domain.rank) || domain.rank < 0) {
    throw new ManagedEconomicValidationError("comparison domain rank must be a non-negative integer");
  }
  requireIdentity(domain.basis.unit, "comparison domain unit");
  validateScheme(domain.basis.scheme);
  requireIdentity(domain.basis.rateCardBasis, "comparison domain rate-card basis");
  requireIdentity(domain.basis.envelopeSemantics, "comparison domain envelope semantics");
}

function validateManagedEconomicCallerConstraint(
  constraint: ManagedEconomicCallerConstraint,
  label: string,
): void {
  for (const [values, dimension] of [
    [constraint.routeIds, "route ids"],
    [constraint.providerIds, "provider ids"],
    [constraint.modelIds, "model ids"],
  ] as const) {
    if (values === undefined) continue;
    const unique = new Set<string>();
    for (const value of values) {
      requireIdentity(value, `${label} ${dimension}`);
      if (unique.has(value)) {
        throw new ManagedEconomicValidationError(`${label} ${dimension} must be unique`);
      }
      unique.add(value);
    }
  }
}

function deepFreezeManagedEconomicValue<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreezeManagedEconomicValue(nested);
    Object.freeze(value);
  }
  return value;
}

function domainFingerprint(alternative: ManagedEconomicExecutionAlternative): string {
  const { comparisonDomain } = alternative;
  return [
    comparisonDomain.id,
    comparisonDomain.basis.unit,
    schemeFingerprint(comparisonDomain.basis.scheme),
    comparisonDomain.basis.rateCardBasis,
    comparisonDomain.basis.envelopeSemantics,
  ].join("\u0000");
}

function schemeFingerprint(scheme: ManagedEconomicScheme): string {
  switch (scheme.kind) {
    case "currency":
      return `currency:${scheme.currency}`;
    case "credit":
      return `credit:${scheme.creditSchemeId}`;
    case "unit":
      return "unit";
  }
}

function requireEvidenceIdentity(evidence: ManagedEconomicEvidenceIdentity): void {
  requireIdentity(evidence.sourceIdentity, "evidence source identity");
  requireIdentity(evidence.sourceRevision, "evidence source revision");
  requireDigest(evidence.sourceDigest, "evidence source digest");
  requireTimestamp(evidence.observedAt, "evidence observedAt");
  requireTimestamp(evidence.validUntil, "evidence validUntil");
  if (Date.parse(evidence.observedAt) >= Date.parse(evidence.validUntil)) {
    throw new ManagedEconomicValidationError("evidence observedAt must precede validUntil");
  }
  requireAllowed(evidence.confidence, ["high", "medium", "low"], "evidence confidence");
  requireAllowed(
    evidence.authority,
    ["provider-reported", "configured", "calculated-estimate"],
    "evidence authority",
  );
}

function requireTimestamp(value: string, label: string): void {
  const parsed = Date.parse(value);
  if (
    !UTC_TIMESTAMP.test(value)
    || !Number.isFinite(parsed)
    || new Date(parsed).toISOString() !== value
  ) {
    throw new ManagedEconomicValidationError(`${label} must be a canonical UTC timestamp`);
  }
}

function requireIdentity(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new ManagedEconomicValidationError(`${label} must not be empty`);
  }
}

function requireDigest(value: string, label: string): void {
  if (!SHA_256_DIGEST.test(value)) {
    throw new ManagedEconomicValidationError(`${label} must be a canonical SHA-256 digest`);
  }
}

function requireAllowed<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ManagedEconomicValidationError(`${label} is invalid`);
  }
}

function validateScheme(scheme: ManagedEconomicScheme): void {
  requireAllowed(scheme.kind, ["currency", "credit", "unit"], "economic scheme kind");
  switch (scheme.kind) {
    case "currency":
      requireIdentity(scheme.currency, "currency");
      return;
    case "credit":
      requireIdentity(scheme.creditSchemeId, "credit scheme");
      return;
    case "unit":
      return;
  }
}

function sameScheme(left: ManagedEconomicScheme, right: ManagedEconomicScheme): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "currency":
      return right.kind === "currency" && left.currency === right.currency;
    case "credit":
      return right.kind === "credit" && left.creditSchemeId === right.creditSchemeId;
    case "unit":
      return right.kind === "unit";
  }
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
