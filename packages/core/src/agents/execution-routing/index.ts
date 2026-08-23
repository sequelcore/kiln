export type {
  ExecutionAccountEconomicsConfig,
  ExecutionPriceEvidenceConfig,
  ExecutionRouteEconomicsConfig,
  ExecutionUnitPriceConfig,
} from "./economics.js";
export {
  decideExecutionRouteDataPolicy,
  defineExecutionDataClassification,
  defineExecutionRouteDataPolicyEvidence,
  EXECUTION_DATA_CLASSIFICATIONS,
} from "./data-policy.js";
export type {
  ExecutionDataClassification,
  ExecutionRouteDataPolicyDecision,
  ExecutionRouteDataPolicyEvidence,
  ExecutionRouteDataPolicyReason,
} from "./data-policy.js";

export { validateModelTurn, validateModelTurnResult } from "./model-turn.js";
export type {
  CustomModelTool,
  CustomModelToolCall,
  FunctionModelTool,
  FunctionModelToolCall,
  ModelImagePart,
  ModelJsonObject,
  ModelJsonValue,
  ModelPart,
  ModelReasoningSummaryPart,
  ModelTextPart,
  ModelTool,
  ModelToolCall,
  ModelToolCallPart,
  ModelToolChoice,
  ModelToolResultContent,
  ModelToolResultPart,
  ModelTurn,
  ModelTurnMessage,
  ModelTurnResult,
  ModelTurnUsage,
} from "./model-turn.js";
export type { OneRoundModelDispatcher, OneRoundModelDispatchInput } from "./one-round-dispatcher.js";
export { createExecutionAccountPolicyId, createExecutionAccountRef } from "./account-identity.js";
export type { ExecutionAccountPolicyId, ExecutionAccountRef } from "./account-identity.js";
export type { ProviderModelRouteIdentity } from "../provider-model-evidence.js";
export { selectAdmittedExecutionAccount } from "./account-admission.js";
export type {
  ExecutionAccountAdmissionCandidate,
  ExecutionAccountAdmissionRejection,
  ExecutionAccountAdmissionRejectionReason,
  ExecutionAccountAdmissionSelection,
} from "./account-admission.js";
export {
  defineExecutionAccountCapacityRejection,
  defineExecutionAccountUsageEvidence,
  selectExecutionCapacityAccount,
} from "./account-capacity-selection.js";
export type {
  ExecutionAccountAffinity,
  ExecutionAccountAffinityEvidence,
  ExecutionAccountAffinityOutcome,
  ExecutionAccountCapacityCandidate,
  ExecutionAccountCapacityHealth,
  ExecutionAccountCapacityRejection,
  ExecutionAccountCapacityRejectionReason,
  ExecutionAccountCapacitySelection,
  ExecutionAccountCapacitySelectionResult,
  ExecutionAccountUsageEvidence,
  SelectExecutionCapacityAccountInput,
} from "./account-capacity-selection.js";
export { advanceExecutionAttempt, createExecutionAttempt } from "./execution-attempt.js";
export type { ExecutionAttempt, ExecutionAttemptPhase } from "./execution-attempt.js";
import type {
  ExecutionAccountEconomicsConfig,
  ExecutionRouteEconomicsConfig,
} from "./economics.js";
import {
  validateExecutionAccountEconomics,
  validateExecutionRouteEconomics,
} from "./economics.js";
import {
  defineExecutionRouteDataPolicyEvidence,
  defineExecutionDataClassification,
  type ExecutionRouteDataPolicyEvidence,
  type ExecutionDataClassification,
} from "./data-policy.js";

const CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export interface ExecutionAccount {
  readonly id: string;
  readonly providerId: string;
  /** Opaque reference owned by the credential subsystem; never credential material. */
  readonly credentialId: string;
  readonly maxConcurrency: number;
  readonly reservedAffinitySlots: number;
  readonly economics: ExecutionAccountEconomicsConfig;
}

export interface ExecutionAccountPolicy {
  readonly id: string;
  readonly accountIds: readonly string[];
  readonly strategy: "economic-least-pressure";
}

export type ExecutionRouteAccountSelection =
  | { readonly mode: "automatic"; readonly accountPolicyId: string }
  | { readonly mode: "exact"; readonly accountId: string };

export interface ExecutionRoute {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly accountSelection: ExecutionRouteAccountSelection;
  readonly dataClassification: ExecutionDataClassification;
  readonly dataPolicyEvidence: ExecutionRouteDataPolicyEvidence;
  readonly economics: ExecutionRouteEconomicsConfig;
}

export interface ExecutionCatalogInput {
  readonly accounts: readonly ExecutionAccount[];
  readonly accountPolicies: readonly ExecutionAccountPolicy[];
  readonly routes: readonly ExecutionRoute[];
}

export interface ExecutionCatalog extends ExecutionCatalogInput {}

export interface OperatorExecutionIntent {
  readonly routeId: string;
  /** A session-scoped override. It never mutates the durable route. */
  readonly accountOverrideId?: string;
}

export type AdmittedExecutionRoute = {
  readonly routeId: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly accountSelection:
    | { readonly mode: "automatic"; readonly accountPolicyId: string; readonly eligibleAccountIds: readonly string[] }
    | { readonly mode: "exact"; readonly accountId: string; readonly source: "route" | "operator-override" };
};

export class ExecutionRoutingValidationError extends Error {
  override name = "ExecutionRoutingValidationError";
}

/**
 * Validates and snapshots the sole durable execution-routing vocabulary.
 * Credentials are always opaque references; no credential material enters this model.
 */
export function defineExecutionCatalog(input: ExecutionCatalogInput): ExecutionCatalog {
  const accounts = input.accounts.map((account, index) => freeze({
    id: canonicalId(account.id, `accounts[${index}].id`),
    providerId: canonicalId(account.providerId, `accounts[${index}].providerId`),
    credentialId: canonicalId(account.credentialId, `accounts[${index}].credentialId`),
    maxConcurrency: positiveInteger(account.maxConcurrency, `accounts[${index}].maxConcurrency`),
    reservedAffinitySlots: reservedAffinitySlots(
      account.reservedAffinitySlots,
      account.maxConcurrency,
      `accounts[${index}].reservedAffinitySlots`,
    ),
    economics: validatedEconomics(
      validateExecutionAccountEconomics,
      account.economics,
      `accounts[${index}].economics`,
    ),
  }));
  uniqueIds(accounts, "accounts");
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  const accountPolicies = input.accountPolicies.map((policy, index) => {
    const accountIds = policy.accountIds.map((accountId, accountIndex) =>
      canonicalId(accountId, `accountPolicies[${index}].accountIds[${accountIndex}]`));
    if (accountIds.length === 0) throw invalid(`accountPolicies[${index}] must contain at least one account`);
    uniqueValues(accountIds, `accountPolicies[${index}].accountIds`);
    const policyAccounts = accountIds.map((accountId) => {
      const account = accountsById.get(accountId);
      if (!account) throw invalid(`accountPolicies[${index}] references unknown account ${accountId}`);
      return account;
    });
    if (new Set(policyAccounts.map((account) => account.providerId)).size !== 1) {
      throw invalid(`accountPolicies[${index}] accounts must belong to the same provider`);
    }
    if (policy.strategy !== "economic-least-pressure") {
      throw invalid(`accountPolicies[${index}].strategy must be economic-least-pressure`);
    }
    return freeze({
      id: canonicalId(policy.id, `accountPolicies[${index}].id`),
      accountIds: freeze(accountIds),
      strategy: policy.strategy,
    });
  });
  uniqueIds(accountPolicies, "accountPolicies");
  const policiesById = new Map(accountPolicies.map((policy) => [policy.id, policy]));

  const routes = input.routes.map((route, index) => {
    const providerId = canonicalId(route.providerId, `routes[${index}].providerId`);
    const accountSelection = normalizeRouteSelection(route.accountSelection, index, accountsById, policiesById, providerId);
    return freeze({
      id: canonicalId(route.id, `routes[${index}].id`),
      label: requiredText(route.label, `routes[${index}].label`),
      providerId,
      providerModelId: requiredText(route.providerModelId, `routes[${index}].providerModelId`),
      accountSelection,
      dataClassification: defineExecutionDataClassification(route.dataClassification),
      dataPolicyEvidence: validatedDataPolicyEvidence(route.dataPolicyEvidence, `routes[${index}].dataPolicyEvidence`),
      economics: validatedEconomics(
        validateExecutionRouteEconomics,
        route.economics,
        `routes[${index}].economics`,
      ),
    });
  });
  uniqueIds(routes, "routes");

  return freeze({ accounts: freeze(accounts), accountPolicies: freeze(accountPolicies), routes: freeze(routes) });
}

function validatedDataPolicyEvidence(
  value: ExecutionRouteDataPolicyEvidence,
  field: string,
): ExecutionRouteDataPolicyEvidence {
  try {
    return defineExecutionRouteDataPolicyEvidence(value);
  } catch (error) {
    throw invalid(`${field} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Admits a user selection without exposing a credential reference or allowing unsafe fallback. */
export function admitOperatorExecutionIntent(
  catalog: ExecutionCatalog,
  intent: OperatorExecutionIntent,
): AdmittedExecutionRoute {
  const routeId = canonicalId(intent.routeId, "intent.routeId");
  const route = catalog.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw invalid(`intent references unknown route ${routeId}`);
  const overrideId = intent.accountOverrideId === undefined
    ? undefined
    : canonicalId(intent.accountOverrideId, "intent.accountOverrideId");

  if (overrideId !== undefined) {
    if (route.accountSelection.mode !== "automatic") {
      throw invalid("account overrides are only allowed for automatic routes");
    }
    const accountPolicyId = route.accountSelection.accountPolicyId;
    const policy = catalog.accountPolicies.find((candidate) => candidate.id === accountPolicyId)!;
    if (!policy.accountIds.includes(overrideId)) {
      throw invalid(`account override ${overrideId} is not eligible for route ${route.id}`);
    }
    return freeze({
      routeId: route.id,
      providerId: route.providerId,
      providerModelId: route.providerModelId,
      accountSelection: freeze({ mode: "exact", accountId: overrideId, source: "operator-override" }),
    });
  }

  if (route.accountSelection.mode === "automatic") {
    const accountPolicyId = route.accountSelection.accountPolicyId;
    const policy = catalog.accountPolicies.find((candidate) => candidate.id === accountPolicyId)!;
    return freeze({
      routeId: route.id,
      providerId: route.providerId,
      providerModelId: route.providerModelId,
      accountSelection: freeze({
        mode: "automatic",
        accountPolicyId,
        eligibleAccountIds: freeze([...policy.accountIds]),
      }),
    });
  }
  return freeze({
    routeId: route.id,
    providerId: route.providerId,
    providerModelId: route.providerModelId,
    accountSelection: freeze({ mode: "exact", accountId: route.accountSelection.accountId, source: "route" }),
  });
}

function normalizeRouteSelection(
  selection: ExecutionRouteAccountSelection,
  routeIndex: number,
  accountsById: ReadonlyMap<string, ExecutionAccount>,
  policiesById: ReadonlyMap<string, ExecutionAccountPolicy>,
  providerId: string,
): ExecutionRouteAccountSelection {
  if (selection.mode === "automatic") {
    const accountPolicyId = canonicalId(selection.accountPolicyId, `routes[${routeIndex}].accountSelection.accountPolicyId`);
    const policy = policiesById.get(accountPolicyId);
    if (!policy) throw invalid(`routes[${routeIndex}] references unknown account policy ${accountPolicyId}`);
    const policyProvider = accountsById.get(policy.accountIds[0]!)!.providerId;
    if (policyProvider !== providerId) throw invalid(`routes[${routeIndex}] provider must match its account policy provider`);
    return freeze({ mode: "automatic", accountPolicyId });
  }
  if (selection.mode === "exact") {
    const accountId = canonicalId(selection.accountId, `routes[${routeIndex}].accountSelection.accountId`);
    const account = accountsById.get(accountId);
    if (!account) throw invalid(`routes[${routeIndex}] references unknown account ${accountId}`);
    if (account.providerId !== providerId) throw invalid(`routes[${routeIndex}] provider must match its exact account provider`);
    return freeze({ mode: "exact", accountId });
  }
  throw invalid(`routes[${routeIndex}].accountSelection must be automatic or exact`);
}

function validatedEconomics<T>(
  validator: (value: unknown, field: string) => void,
  value: T,
  field: string,
): T {
  try {
    validator(value, field);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  return deepSnapshot(value);
}

function canonicalId(value: string, field: string): string {
  if (typeof value !== "string" || !CANONICAL_ID.test(value)) throw invalid(`${field} must be a canonical id`);
  return value;
}

function requiredText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw invalid(`${field} is required`);
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(`${field} must be a positive integer`);
  return value;
}

function reservedAffinitySlots(value: number, maxConcurrency: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maxConcurrency) {
    throw invalid(`${field} must be a non-negative integer no greater than maxConcurrency`);
  }
  return value;
}

function uniqueIds(values: readonly { readonly id: string }[], field: string): void {
  uniqueValues(values.map((value) => value.id), field, "unique canonical id");
}

function uniqueValues(values: readonly string[], field: string, message = "unique values"): void {
  if (new Set(values).size !== values.length) throw invalid(`${field} must contain ${message}`);
}

function invalid(message: string): ExecutionRoutingValidationError {
  return new ExecutionRoutingValidationError(message);
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function deepSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => deepSnapshot(entry))) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) copy[key] = deepSnapshot(entry);
  return Object.freeze(copy) as T;
}
