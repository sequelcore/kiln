import {
  compareManagedEconomicAmounts,
  validateManagedEconomicAmount,
  type ManagedEconomicAmount,
} from "../../cost/managed-route-economics.js";
import type { AdmittedExecutionRoute } from "./index.js";

/** Snapshot of an account before the atomic capacity transaction. */
export interface ExecutionAccountAdmissionCandidate {
  readonly accountId: string;
  readonly safety: "eligible" | "ineligible";
  readonly health: "healthy" | "unhealthy";
  readonly quota: "available" | "exhausted" | "unknown";
  readonly capacity: "available" | "exhausted";
  readonly economicCost: ManagedEconomicAmount;
  readonly pressure: number;
}

export type ExecutionAccountAdmissionRejectionReason =
  | "safety-ineligible"
  | "health-unhealthy"
  | "quota-exhausted"
  | "quota-unknown"
  | "capacity-exhausted";

export interface ExecutionAccountAdmissionRejection {
  readonly accountId: string;
  readonly reason: ExecutionAccountAdmissionRejectionReason;
}

export type ExecutionAccountAdmissionSelection =
  | {
      readonly kind: "selected";
      readonly accountId: string;
      readonly rejected: readonly ExecutionAccountAdmissionRejection[];
    }
  | {
      readonly kind: "rejected";
      readonly rejected: readonly ExecutionAccountAdmissionRejection[];
    };

/**
 * Selects an account from the route's pre-admitted policy snapshot.
 * This stage does not reserve or mutate current SQLite capacity.
 */
export function selectAdmittedExecutionAccount(
  admission: AdmittedExecutionRoute,
  candidates: readonly ExecutionAccountAdmissionCandidate[],
): ExecutionAccountAdmissionSelection {
  if (!Array.isArray(candidates)) throw invalid("candidates must be an array");
  const allowedAccountIds = admission.accountSelection.mode === "exact"
    ? new Set([admission.accountSelection.accountId])
    : new Set(admission.accountSelection.eligibleAccountIds);
  const rejected: ExecutionAccountAdmissionRejection[] = [];
  const eligible: ExecutionAccountAdmissionCandidate[] = [];
  for (const candidate of candidates) {
    validateCandidate(candidate);
    if (!allowedAccountIds.has(candidate.accountId)) continue;
    const reason = rejectionReason(candidate);
    if (reason) rejected.push(freeze({ accountId: candidate.accountId, reason }));
    else eligible.push(candidate);
  }
  if (eligible.length === 0) return freeze({ kind: "rejected", rejected: freeze(rejected) });

  const selected = [...eligible].sort(compareCandidates)[0]!;
  return freeze({ kind: "selected", accountId: selected.accountId, rejected: freeze(rejected) });
}

function rejectionReason(candidate: ExecutionAccountAdmissionCandidate): ExecutionAccountAdmissionRejectionReason | undefined {
  if (candidate.safety === "ineligible") return "safety-ineligible";
  if (candidate.health === "unhealthy") return "health-unhealthy";
  if (candidate.quota === "exhausted") return "quota-exhausted";
  if (candidate.quota === "unknown") return "quota-unknown";
  if (candidate.capacity === "exhausted") return "capacity-exhausted";
  return undefined;
}

function compareCandidates(left: ExecutionAccountAdmissionCandidate, right: ExecutionAccountAdmissionCandidate): number {
  const economic = compareManagedEconomicAmounts(left.economicCost, right.economicCost);
  if (economic !== 0) return economic;
  if (left.pressure !== right.pressure) return left.pressure - right.pressure;
  return left.accountId.localeCompare(right.accountId);
}

function validateCandidate(candidate: ExecutionAccountAdmissionCandidate): void {
  canonicalId(candidate.accountId, "candidate.accountId");
  if (candidate.safety !== "eligible" && candidate.safety !== "ineligible") throw invalid("candidate.safety is invalid");
  if (candidate.health !== "healthy" && candidate.health !== "unhealthy") throw invalid("candidate.health is invalid");
  if (candidate.quota !== "available" && candidate.quota !== "exhausted" && candidate.quota !== "unknown") throw invalid("candidate.quota is invalid");
  if (candidate.capacity !== "available" && candidate.capacity !== "exhausted") throw invalid("candidate.capacity is invalid");
  if (!Number.isFinite(candidate.pressure) || candidate.pressure < 0) throw invalid("candidate.pressure must be a finite non-negative number");
  try {
    validateManagedEconomicAmount(candidate.economicCost);
  } catch (error) {
    throw invalid(`candidate.economicCost is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function canonicalId(value: string, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) throw invalid(`${field} must be a canonical id`);
  return value;
}

function invalid(message: string): Error {
  return new Error(message);
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}
