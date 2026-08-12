import {
  ManagedEconomicValidationError,
  validateManagedEconomicAmount,
  type ManagedEconomicAmount,
  type ManagedEconomicEvidenceIdentity,
} from "../../cost/managed-route-economics.js";

export interface ExecutionAccountEconomicsConfig {
  readonly capacityIdentity: string;
  readonly subscriptionClass: "subscription" | "included" | "free" | "metered" | "unknown";
  readonly quotaClassId: string;
  readonly creditPosture: "disabled" | "committed";
  readonly overagePosture: "disabled" | "committed";
}

export interface ExecutionUnitPriceConfig {
  readonly usageUnit: string;
  readonly price: ManagedEconomicAmount;
}

export type ExecutionPriceEvidenceConfig =
  | {
      readonly kind: "subscription";
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "included";
      readonly allowanceId: string;
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "free";
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "metered";
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly unitPrices: readonly ExecutionUnitPriceConfig[];
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "unknown";
      readonly reason: string;
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "estimated";
      readonly estimationMethod: string;
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly unitPrices: readonly ExecutionUnitPriceConfig[];
      readonly evidence: ManagedEconomicEvidenceIdentity;
    };

export interface ExecutionRouteEconomicsConfig {
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  readonly authBillingChannel: string;
  readonly executionMode: string;
  readonly serviceTier: string;
  readonly rateCardBasis: string;
  readonly envelopeSemantics: string;
  readonly fallbackPosture: "disabled" | "committed";
  readonly overagePosture: "disabled" | "committed";
  readonly contextClass: string;
  readonly cacheClass: string;
  readonly priceEvidence: ExecutionPriceEvidenceConfig;
  readonly auxiliaryCharges: readonly {
    readonly id: string;
    readonly amount: ManagedEconomicAmount;
  }[];
  readonly executionEnvelope: {
    readonly limits: readonly ManagedEconomicAmount[];
  };
}

const CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const ECONOMIC_CLASSES = ["subscription", "included", "free", "metered", "unknown"] as const;
const POSTURES = ["disabled", "committed"] as const;
const PRICE_KINDS = ["subscription", "included", "free", "metered", "unknown", "estimated"] as const;
const EVIDENCE_CONFIDENCES = ["high", "medium", "low"] as const;
const EVIDENCE_AUTHORITIES = ["provider-reported", "configured", "calculated-estimate"] as const;

/** Validates the account economics persisted with an execution catalog. */
export function validateExecutionAccountEconomics(value: unknown, field: string): void {
  const economics = record(value, field);
  identifier(economics.capacityIdentity, `${field}.capacityIdentity`);
  oneOf(economics.subscriptionClass, ECONOMIC_CLASSES, `${field}.subscriptionClass`);
  identifier(economics.quotaClassId, `${field}.quotaClassId`);
  oneOf(economics.creditPosture, POSTURES, `${field}.creditPosture`);
  oneOf(economics.overagePosture, POSTURES, `${field}.overagePosture`);
}

/** Validates the route economics persisted with an execution catalog. */
export function validateExecutionRouteEconomics(value: unknown, field: string): void {
  const economics = record(value, field);
  for (const key of [
    "adapterCapabilityId",
    "adapterCapabilityVersion",
    "authBillingChannel",
    "executionMode",
    "serviceTier",
    "rateCardBasis",
    "envelopeSemantics",
    "contextClass",
    "cacheClass",
  ]) {
    identifier(economics[key], `${field}.${key}`);
  }
  oneOf(economics.fallbackPosture, POSTURES, `${field}.fallbackPosture`);
  oneOf(economics.overagePosture, POSTURES, `${field}.overagePosture`);
  validatePriceEvidence(economics.priceEvidence, `${field}.priceEvidence`);

  const auxiliaryCharges = array(economics.auxiliaryCharges, `${field}.auxiliaryCharges`);
  const auxiliaryIds = new Set<string>();
  for (const [index, value] of auxiliaryCharges.entries()) {
    const chargeField = `${field}.auxiliaryCharges[${index}]`;
    const charge = record(value, chargeField);
    const id = identifier(charge.id, `${chargeField}.id`);
    if (!auxiliaryIds.add(id)) {
      fail(`${chargeField}.id must be unique`);
    }
    amount(charge.amount, `${chargeField}.amount`);
  }

  const envelope = record(economics.executionEnvelope, `${field}.executionEnvelope`);
  const limits = array(envelope.limits, `${field}.executionEnvelope.limits`);
  for (const [index, value] of limits.entries()) {
    amount(value, `${field}.executionEnvelope.limits[${index}]`);
  }
}

function validatePriceEvidence(value: unknown, field: string): void {
  const evidence = record(value, field);
  const kind = oneOf(evidence.kind, PRICE_KINDS, `${field}.kind`);
  identifier(evidence.rateCardId, `${field}.rateCardId`);
  identifier(evidence.rateCardRevision, `${field}.rateCardRevision`);
  validateEconomicEvidence(evidence.evidence, `${field}.evidence`);

  if (kind === "included") {
    identifier(evidence.allowanceId, `${field}.allowanceId`);
  } else if (kind === "unknown") {
    text(evidence.reason, `${field}.reason`);
  } else if (kind === "estimated") {
    identifier(evidence.estimationMethod, `${field}.estimationMethod`);
  }

  if (kind !== "metered" && kind !== "estimated") return;
  const unitPrices = array(evidence.unitPrices, `${field}.unitPrices`);
  if (unitPrices.length === 0) {
    fail(`${field}.unitPrices must be non-empty`);
  }
  const usageUnits = new Set<string>();
  for (const [index, value] of unitPrices.entries()) {
    const unitPriceField = `${field}.unitPrices[${index}]`;
    const unitPrice = record(value, unitPriceField);
    const usageUnit = identifier(unitPrice.usageUnit, `${unitPriceField}.usageUnit`);
    if (!usageUnits.add(usageUnit)) {
      fail(`${unitPriceField}.usageUnit must be unique`);
    }
    amount(unitPrice.price, `${unitPriceField}.price`);
    const price = unitPrice.price as ManagedEconomicAmount;
    if (price.unit !== usageUnit) {
      fail(`${unitPriceField}.usageUnit must equal price.unit`);
    }
  }
}

function validateEconomicEvidence(value: unknown, field: string): void {
  const evidence = record(value, field) as Partial<ManagedEconomicEvidenceIdentity>;
  text(evidence.sourceIdentity, `${field}.sourceIdentity`);
  text(evidence.sourceRevision, `${field}.sourceRevision`);
  text(evidence.sourceDigest, `${field}.sourceDigest`);
  const observedAt = timestamp(evidence.observedAt, `${field}.observedAt`);
  const validUntil = timestamp(evidence.validUntil, `${field}.validUntil`);
  if (observedAt >= validUntil) {
    fail(`${field}.validUntil must be after observedAt`);
  }
  oneOf(evidence.confidence, EVIDENCE_CONFIDENCES, `${field}.confidence`);
  oneOf(evidence.authority, EVIDENCE_AUTHORITIES, `${field}.authority`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !CANONICAL_ID.test(value)) {
    fail(`${field} must be a canonical id`);
  }
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be non-empty`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(`${field} is invalid`);
  }
  return value as T;
}

function timestamp(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    fail(`${field} must be an ISO timestamp`);
  }
  return parsed;
}

function amount(value: unknown, field: string): void {
  try {
    validateManagedEconomicAmount(value as ManagedEconomicAmount);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ManagedEconomicValidationError(`${field} is invalid: ${message}`);
  }
}

function fail(message: string): never {
  throw new ManagedEconomicValidationError(message);
}
