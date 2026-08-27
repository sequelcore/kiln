export type {
  ExecutionAccountEconomicsConfig,
  ExecutionPriceEvidenceConfig,
  ExecutionTargetEconomicsConfig,
  ExecutionUnitPriceConfig,
} from "./economics.js";
export {
  decideExecutionTargetDataPolicy,
  defineExecutionDataClassification,
  defineExecutionTargetDataPolicyEvidence,
  EXECUTION_DATA_CLASSIFICATIONS,
} from "./data-policy.js";
export type {
  ExecutionDataClassification,
  ExecutionTargetDataPolicyDecision,
  ExecutionTargetDataPolicyEvidence,
  ExecutionTargetDataPolicyReason,
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
  ExecutionTargetEconomicsConfig,
} from "./economics.js";
import {
  validateExecutionAccountEconomics,
  validateExecutionTargetEconomics,
} from "./economics.js";
import {
  defineExecutionTargetDataPolicyEvidence,
  defineExecutionDataClassification,
  type ExecutionTargetDataPolicyEvidence,
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

export interface DirectExecutionTarget {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly accountPolicyId: string;
  readonly dataClassification: ExecutionDataClassification;
  readonly dataPolicyEvidence: ExecutionTargetDataPolicyEvidence;
  readonly economics: ExecutionTargetEconomicsConfig;
}

export interface ExecutionTargetCatalogInput {
  readonly accounts: readonly ExecutionAccount[];
  readonly accountPolicies: readonly ExecutionAccountPolicy[];
  readonly targets: readonly DirectExecutionTarget[];
}

export interface ExecutionTargetCatalog extends ExecutionTargetCatalogInput {}

export interface OperatorExecutionIntent {
  readonly targetId: string;
  /** A session-scoped override. It never mutates the durable target. */
  readonly accountOverrideId?: string;
}

export type AdmittedExecutionAccount =
  | {
      readonly kind: "policy";
      readonly accountPolicyId: string;
      readonly eligibleAccountIds: readonly string[];
    }
  | {
      readonly kind: "operator-override";
      readonly accountPolicyId: string;
      readonly accountId: string;
    };

export type AdmittedExecutionTarget = {
  readonly targetId: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly accountSelection: AdmittedExecutionAccount;
};

export class ExecutionRoutingValidationError extends Error {
  override name = "ExecutionRoutingValidationError";
}

/**
 * Validates and snapshots the sole durable execution-routing vocabulary.
 * Credentials are always opaque references; no credential material enters this model.
 */
export function defineExecutionTargetCatalog(input: ExecutionTargetCatalogInput): ExecutionTargetCatalog {
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

  const targets = input.targets.map((target, index) => {
    const providerId = canonicalId(target.providerId, `targets[${index}].providerId`);
    const accountPolicyId = normalizeTargetAccountPolicy(target.accountPolicyId, index, accountsById, policiesById, providerId);
    return freeze({
      id: canonicalId(target.id, `targets[${index}].id`),
      label: requiredText(target.label, `targets[${index}].label`),
      providerId,
      providerModelId: requiredText(target.providerModelId, `targets[${index}].providerModelId`),
      accountPolicyId,
      dataClassification: defineExecutionDataClassification(target.dataClassification),
      dataPolicyEvidence: validatedDataPolicyEvidence(target.dataPolicyEvidence, `targets[${index}].dataPolicyEvidence`),
      economics: validatedEconomics(
        validateExecutionTargetEconomics,
        target.economics,
        `targets[${index}].economics`,
      ),
    });
  });
  uniqueIds(targets, "targets");

  return freeze({ accounts: freeze(accounts), accountPolicies: freeze(accountPolicies), targets: freeze(targets) });
}

function validatedDataPolicyEvidence(
  value: ExecutionTargetDataPolicyEvidence,
  field: string,
): ExecutionTargetDataPolicyEvidence {
  try {
    return defineExecutionTargetDataPolicyEvidence(value);
  } catch (error) {
    throw invalid(`${field} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Admits a user selection without exposing a credential reference or allowing unsafe fallback. */
export function admitOperatorExecutionIntent(
  catalog: ExecutionTargetCatalog,
  intent: OperatorExecutionIntent,
): AdmittedExecutionTarget {
  const targetId = canonicalId(intent.targetId, "intent.targetId");
  const target = catalog.targets.find((candidate) => candidate.id === targetId);
  if (!target) throw invalid(`intent references unknown target ${targetId}`);
  const accountPolicy = catalog.accountPolicies.find((candidate) => candidate.id === target.accountPolicyId);
  if (!accountPolicy) throw invalid(`target ${target.id} references unknown account policy ${target.accountPolicyId}`);
  const overrideId = intent.accountOverrideId === undefined
    ? undefined
    : canonicalId(intent.accountOverrideId, "intent.accountOverrideId");

  if (overrideId !== undefined) {
    if (!accountPolicy.accountIds.includes(overrideId)) {
      throw invalid(`account override ${overrideId} is not eligible for target ${target.id}`);
    }
    return freeze({
      targetId: target.id,
      providerId: target.providerId,
      providerModelId: target.providerModelId,
      accountSelection: freeze({
        kind: "operator-override",
        accountPolicyId: target.accountPolicyId,
        accountId: overrideId,
      }),
    });
  }

  return freeze({
    targetId: target.id,
    providerId: target.providerId,
    providerModelId: target.providerModelId,
    accountSelection: freeze({
      kind: "policy",
      accountPolicyId: target.accountPolicyId,
      eligibleAccountIds: freeze([...accountPolicy.accountIds]),
    }),
  });
}

function normalizeTargetAccountPolicy(
  accountPolicyId: string,
  targetIndex: number,
  accountsById: ReadonlyMap<string, ExecutionAccount>,
  policiesById: ReadonlyMap<string, ExecutionAccountPolicy>,
  providerId: string,
): string {
  const normalizedPolicyId = canonicalId(accountPolicyId, `targets[${targetIndex}].accountPolicyId`);
  const policy = policiesById.get(normalizedPolicyId);
  if (!policy) throw invalid(`targets[${targetIndex}] references unknown account policy ${normalizedPolicyId}`);
  const policyProvider = accountsById.get(policy.accountIds[0]!)!.providerId;
  if (policyProvider !== providerId) throw invalid(`targets[${targetIndex}] provider must match its account policy provider`);
  return normalizedPolicyId;
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
