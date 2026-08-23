import {
  validateManagedEconomicAmount,
  type ExecutionCatalog,
  type ManagedEconomicAmount,
} from "@kilnai/core";
import { KilnYamlError } from "../../../kiln-yaml.js";
import {
  projectExecutionCatalogFromIntent,
  readExecutionTargetEvidenceSnapshot,
  type ExecutionTargetEvidenceRevision,
  type ExecutionTargetEvidenceSnapshot,
} from "../../execution-target-evidence-store.js";
import type { KilnGlobalConfig } from "../../global-config-schema.js";
import { resolveGlobalConfigPath } from "../path.js";
import { validateManagedTargetReferences } from "./authority.js";
import {
  isRecord,
  rejectUnknownFields,
  validateCanonicalId,
  validateOptionalStringArray,
  validateRequiredHttpsUrlString,
  validateRequiredNonEmptyString,
} from "./shared.js";

export function validateTargetCatalog(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("targetCatalog must be an object");
  rejectUnknownFields(value, ["evidenceRevision", "accounts", "accountPolicies", "targets"], "targetCatalog");
  if (typeof value.evidenceRevision !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.evidenceRevision)) {
    throw new KilnYamlError("targetCatalog.evidenceRevision must be a sha256 digest");
  }
  if (!Array.isArray(value.accounts) || !Array.isArray(value.accountPolicies) || !Array.isArray(value.targets)) {
    throw new KilnYamlError("targetCatalog.accounts, targetCatalog.accountPolicies, and targetCatalog.targets must be arrays");
  }

  const accounts = new Map<string, Record<string, unknown>>();
  value.accounts.forEach((account, index) => {
    const path = `targetCatalog.accounts[${index}]`;
    if (!isRecord(account)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(account, ["id", "providerId", "credentialId", "maxConcurrency", "reservedAffinitySlots", "economics"], path);
    validateCanonicalId(account.id, `${path}.id`);
    validateCanonicalId(account.providerId, `${path}.providerId`);
    validateCanonicalId(account.credentialId, `${path}.credentialId`);
    if (accounts.has(account.id)) throw new KilnYamlError(`${path}.id must be unique`);
    if (typeof account.maxConcurrency !== "number" || !Number.isSafeInteger(account.maxConcurrency) || account.maxConcurrency < 1) {
      throw new KilnYamlError(`${path}.maxConcurrency must be a positive integer`);
    }
    if (!Number.isSafeInteger(account.reservedAffinitySlots) || Number(account.reservedAffinitySlots) < 0 || Number(account.reservedAffinitySlots) > account.maxConcurrency) {
      throw new KilnYamlError(`${path}.reservedAffinitySlots must be a non-negative integer no greater than maxConcurrency`);
    }
    validateExecutionAccountIntentEconomics(account.economics, `${path}.economics`);
    accounts.set(account.id, account);
  });

  const policies = new Map<string, Record<string, unknown>>();
  value.accountPolicies.forEach((policy, index) => {
    const path = `targetCatalog.accountPolicies[${index}]`;
    if (!isRecord(policy)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(policy, ["id", "accountIds", "strategy"], path);
    validateCanonicalId(policy.id, `${path}.id`);
    if (policies.has(policy.id)) throw new KilnYamlError(`${path}.id must be unique`);
    if (!Array.isArray(policy.accountIds) || policy.accountIds.length === 0) throw new KilnYamlError(`${path}.accountIds must be a non-empty array`);
    if (policy.strategy !== "economic-least-pressure") throw new KilnYamlError(`${path}.strategy must be "economic-least-pressure"`);
    const policyAccountIds = new Set<string>();
    let providerId: string | undefined;
    policy.accountIds.forEach((accountId, accountIndex) => {
      validateCanonicalId(accountId, `${path}.accountIds[${accountIndex}]`);
      if (!accounts.has(accountId)) throw new KilnYamlError(`${path}.accountIds[${accountIndex}] references an unknown account`);
      if (policyAccountIds.has(accountId)) throw new KilnYamlError(`${path}.accountIds[${accountIndex}] must be unique`);
      policyAccountIds.add(accountId);
      const accountProviderId = accounts.get(accountId)!.providerId as string;
      if (providerId !== undefined && providerId !== accountProviderId) throw new KilnYamlError(`${path}.accountIds must all reference accounts from one provider`);
      providerId = accountProviderId;
    });
    policies.set(policy.id, policy);
  });

  const targetIds = new Set<string>();
  value.targets.forEach((target, index) => {
    const path = `targetCatalog.targets[${index}]`;
    if (!isRecord(target)) throw new KilnYamlError(`${path} must be an object`);
    const common = ["id", "kind", "label", "providerId", "providerModelId"];
    rejectUnknownFields(target, target.kind === "direct"
      ? [...common, "accountSelection", "dataClassification", "economics"]
      : [...common, "dataClassification", "remoteHarness", "externalRuntimeAttachment"], path);
    validateCanonicalId(target.id, `${path}.id`);
    if (targetIds.has(target.id)) throw new KilnYamlError(`${path}.id must be unique`);
    targetIds.add(target.id);
    validateRequiredNonEmptyString(target, "label", `${path}.label`);
    validateCanonicalId(target.providerId, `${path}.providerId`);
    validateRequiredNonEmptyString(target, "providerModelId", `${path}.providerModelId`);
    if (!["public", "internal", "confidential", "restricted"].includes(String(target.dataClassification))) {
      throw new KilnYamlError(`${path}.dataClassification is invalid`);
    }
    if (target.kind === "harness") {
      validateManagedAgentRemoteHarness(target.remoteHarness, "harness", `${path}.remoteHarness`);
      if (isRecord(target.remoteHarness) && target.remoteHarness.limitations !== undefined) {
        throw new KilnYamlError(`${path}.remoteHarness.limitations is managed evidence and cannot be declared as intent`);
      }
      validateExternalRuntimeAttachment(target.externalRuntimeAttachment, `${path}.externalRuntimeAttachment`);
      return;
    }
    if (target.kind !== "direct") throw new KilnYamlError(`${path}.kind must be "direct" or "harness"`);
    validateRouteAccountSelection(target.accountSelection, path, target.providerId, accounts, policies);
    validateExecutionRouteIntentEconomics(target.economics, `${path}.economics`);
  });
}

/** Projects direct targets into Core's account-backed execution boundary. */
export function projectDirectExecutionCatalog(
  config: KilnGlobalConfig | null | undefined,
  evidence: ExecutionTargetEvidenceSnapshot | undefined,
  evidenceRevision: ExecutionTargetEvidenceRevision | undefined,
): ExecutionCatalog | undefined {
  const catalog = config?.targetCatalog;
  if (!catalog) return undefined;
  if (!evidence || !evidenceRevision) {
    throw new KilnYamlError(`Execution target catalog requires managed evidence revision ${catalog.evidenceRevision}.`);
  }
  try {
    const executionCatalog = projectExecutionCatalogFromIntent(catalog, evidence, evidenceRevision);
    validateManagedTargetReferences(
      config?.managedAgents,
      catalog,
      config?.authorityProfiles,
    );
    return executionCatalog;
  } catch (error) {
    throw new KilnYamlError(`Invalid execution target catalog: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Reads the exact managed-evidence revision referenced by operator intent and resolves Core runtime authority. */
export function readGlobalExecutionTargetAuthority(
  config: KilnGlobalConfig | null | undefined,
  options: { readonly globalConfigPath?: string } = {},
): {
  readonly evidence: ExecutionTargetEvidenceSnapshot;
  readonly executionCatalog: ExecutionCatalog;
} | undefined {
  const intent = config?.targetCatalog;
  if (!intent) return undefined;
  const evidence = readExecutionTargetEvidenceSnapshot({
    globalConfigPath: options.globalConfigPath ?? resolveGlobalConfigPath(),
    revision: intent.evidenceRevision,
  });
  const executionCatalog = projectDirectExecutionCatalog(config, evidence, intent.evidenceRevision);
  if (!executionCatalog) return undefined;
  return { evidence, executionCatalog };
}

export function readGlobalExecutionCatalog(
  config: KilnGlobalConfig | null | undefined,
  options: { readonly globalConfigPath?: string } = {},
): ExecutionCatalog | undefined {
  return readGlobalExecutionTargetAuthority(config, options)?.executionCatalog;
}

/** Atomically reads validated global configuration and its optimistic-write revision. */

function validateExecutionAccountIntentEconomics(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["creditPosture", "overagePosture"], path);
  if (value.creditPosture !== "disabled" && value.creditPosture !== "committed") throw new KilnYamlError(`${path}.creditPosture is invalid`);
  if (value.overagePosture !== "disabled" && value.overagePosture !== "committed") throw new KilnYamlError(`${path}.overagePosture is invalid`);
}

function validateExecutionRouteIntentEconomics(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["authBillingChannel", "executionMode", "serviceTier", "fallbackPosture", "overagePosture", "executionEnvelope"], path);
  for (const field of ["authBillingChannel", "executionMode", "serviceTier"]) {
    validateRequiredNonEmptyString(value, field, `${path}.${field}`);
  }
  if (value.fallbackPosture !== "disabled" && value.fallbackPosture !== "committed") throw new KilnYamlError(`${path}.fallbackPosture is invalid`);
  if (value.overagePosture !== "disabled" && value.overagePosture !== "committed") throw new KilnYamlError(`${path}.overagePosture is invalid`);
  if (!isRecord(value.executionEnvelope)) throw new KilnYamlError(`${path}.executionEnvelope must be an object`);
  rejectUnknownFields(value.executionEnvelope, ["limits"], `${path}.executionEnvelope`);
  if (!Array.isArray(value.executionEnvelope.limits)) throw new KilnYamlError(`${path}.executionEnvelope.limits must be an array`);
  value.executionEnvelope.limits.forEach((limit, index) => validateEconomicAmount(limit, `${path}.executionEnvelope.limits[${index}]`));
}

function validateEconomicAmount(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["atoms", "scale", "unit", "scheme"], path);
  validateEconomicScheme(value.scheme, `${path}.scheme`);
  try {
    validateManagedEconomicAmount(value as unknown as ManagedEconomicAmount);
  } catch (error) {
    throw new KilnYamlError(`${path} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateEconomicScheme(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  if (value.kind === "currency") {
    rejectUnknownFields(value, ["kind", "currency"], path);
    validateCanonicalId(value.currency, `${path}.currency`);
    return;
  }
  if (value.kind === "credit") {
    rejectUnknownFields(value, ["kind", "creditSchemeId"], path);
    validateCanonicalId(value.creditSchemeId, `${path}.creditSchemeId`);
    return;
  }
  if (value.kind !== "unit") throw new KilnYamlError(`${path}.kind is invalid`);
  rejectUnknownFields(value, ["kind"], path);
}

function validateRouteAccountSelection(
  value: unknown,
  routePath: string,
  providerId: unknown,
  accounts: ReadonlyMap<string, Record<string, unknown>>,
  policies: ReadonlyMap<string, Record<string, unknown>>,
): void {
  const path = `${routePath}.accountSelection`;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["mode", "accountPolicyId", "accountId"], path);
  if (value.mode === "automatic") {
    validateCanonicalId(value.accountPolicyId, `${path}.accountPolicyId`);
    if (value.accountId !== undefined) throw new KilnYamlError(`${path}.automatic mode cannot set accountId`);
    const policy = policies.get(value.accountPolicyId);
    if (!policy) throw new KilnYamlError(`${path}.accountPolicyId references an unknown account policy`);
    const policyProviderId = accounts.get((policy.accountIds as readonly string[])[0]!)!.providerId;
    if (policyProviderId !== providerId) throw new KilnYamlError(`${path}.accountPolicyId provider must match route providerId`);
    return;
  }
  if (value.mode === "exact") {
    validateCanonicalId(value.accountId, `${path}.accountId`);
    if (value.accountPolicyId !== undefined) throw new KilnYamlError(`${path}.exact mode cannot set accountPolicyId`);
    const account = accounts.get(value.accountId);
    if (!account) throw new KilnYamlError(`${path}.accountId references an unknown account`);
    if (account.providerId !== providerId) throw new KilnYamlError(`${path}.accountId provider must match route providerId`);
    return;
  }
  throw new KilnYamlError(`${path}.mode must be "automatic" or "exact"`);
}

export function validateTargetRouting(value: unknown, targetCatalog: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("targetRouting must be an object");
  rejectUnknownFields(value, ["defaultTargetId"], "targetRouting");
  validateCanonicalId(value.defaultTargetId, "targetRouting.defaultTargetId");
  if (!isRecord(targetCatalog) || !Array.isArray(targetCatalog.targets)) throw new KilnYamlError("targetRouting requires targetCatalog.targets");
  const target = targetCatalog.targets.find((candidate) => isRecord(candidate) && candidate.id === value.defaultTargetId);
  if (!isRecord(target)) throw new KilnYamlError("targetRouting.defaultTargetId references an unknown target");
  if (target.kind !== "direct") throw new KilnYamlError("targetRouting.defaultTargetId must reference a direct target");
}

function validateExternalRuntimeAttachment(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["runtimeId", "attachmentId"], path);
  validateCanonicalId(value.runtimeId, `${path}.runtimeId`);
  validateCanonicalId(value.attachmentId, `${path}.attachmentId`);
}

function validateManagedAgentRemoteHarness(value: unknown, routeKind: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (routeKind !== "harness") {
    throw new KilnYamlError(`${path} requires kind "harness"`);
  }
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!["invokeUrl", "cancelUrl", "authTokenEnv", "limitations"].includes(key)) {
      throw new KilnYamlError(`Unknown ${path} field: ${key}`);
    }
  }
  validateRequiredHttpsUrlString(value, "invokeUrl", `${path}.invokeUrl`);
  validateRequiredHttpsUrlString(value, "cancelUrl", `${path}.cancelUrl`);
  if (value.authTokenEnv !== undefined) {
    if (typeof value.authTokenEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.authTokenEnv)) {
      throw new KilnYamlError(`${path}.authTokenEnv must be a portable environment variable name`);
    }
  }
  validateOptionalStringArray(value.limitations, `${path}.limitations`);
}
