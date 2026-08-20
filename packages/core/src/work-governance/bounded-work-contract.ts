import {
  boundedWorkDigest,
  freezeBoundedWorkValue,
  requireBoundedWorkDigest,
} from "./bounded-work-content.js";
import {
  assessBoundedWorkScopePolicy,
  boundedWorkTripwireDiagnostics,
} from "./bounded-work-scope-policy.js";
import type {
  BoundedWorkChangeAuthority,
  BoundedWorkEffect,
  BoundedWorkScope,
  BoundedWorkScopeViolation,
  BoundedWorkTripwireDiagnostic,
  BoundedWorkTripwires,
} from "./bounded-work-scope-policy.js";

export const BOUNDED_WORK_CONTRACT_SCHEMA = "kiln.bounded-work-contract/v2" as const;

export type BoundedWorkHarnessCapability =
  | "authoritative"
  | "partially_enforced"
  | "advisory_only";

export interface BoundedWorkAcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
}

export interface BoundedWorkFormalVerificationObligation {
  readonly id: string;
  readonly symbol: string;
  readonly subjectPaths: readonly string[];
}

export interface BoundedWorkFormalVerificationMapping {
  readonly criterionId: string;
  readonly obligationIds: readonly string[];
}

export interface BoundedWorkFormalVerificationAssurance {
  readonly semantics: "allOf";
  readonly obligations: readonly BoundedWorkFormalVerificationObligation[];
  readonly mappings: readonly BoundedWorkFormalVerificationMapping[];
}

export interface BoundedWorkAssurance {
  readonly formalVerification: BoundedWorkFormalVerificationAssurance;
}

export interface BoundedWorkIntent {
  readonly objective: string;
  readonly acceptanceCriteria: readonly BoundedWorkAcceptanceCriterion[];
  readonly nonGoals: readonly string[];
}

export interface BoundedWorkLimits {
  readonly maxExecutionAttempts: number;
  readonly maxManagedInvocations: number;
  readonly maxConcurrentManagedInvocations: number;
  readonly maxChildDepth: number;
  readonly maxReviewRounds: number;
  readonly maxRemediationRounds: number;
  readonly maxToolCalls?: number;
  readonly maxActiveDurationMs?: number;
}

export interface BoundedWorkPolicy {
  readonly scopeExpansion: "deny" | "approval_required";
  readonly budgetExhaustion: "pause" | "stop";
  readonly minimumHarnessCapability: BoundedWorkHarnessCapability;
}

export interface BoundedWorkContract {
  readonly schema: typeof BOUNDED_WORK_CONTRACT_SCHEMA;
  readonly intent: BoundedWorkIntent;
  readonly assurance: BoundedWorkAssurance;
  readonly scope: BoundedWorkScope;
  readonly limits: BoundedWorkLimits;
  readonly tripwires: BoundedWorkTripwires;
  readonly policy: BoundedWorkPolicy;
}

export type BoundedWorkAdoptionAuthority =
  | {
      readonly kind: "operator";
      readonly actorId: string;
      readonly decisionId: string;
    }
  | {
      readonly kind: "approved_plan";
      readonly planId: string;
      readonly planDigest: string;
    };

export interface BoundedWorkContractRevision {
  readonly schema: "kiln.bounded-work-contract-revision/v1";
  readonly revision: number;
  readonly contractDigest: string;
  readonly revisionDigest: string;
  readonly accountingLineageId: string;
  readonly parentRevisionDigest?: string;
  readonly adoptedAt: string;
  readonly adoptedBy: BoundedWorkAdoptionAuthority;
  readonly contract: BoundedWorkContract;
}

export interface AdoptBoundedWorkContractRevisionInput {
  readonly contract: BoundedWorkContract;
  readonly adoptedAt: string;
  readonly adoptedBy: BoundedWorkAdoptionAuthority;
  readonly accountingLineageId: string;
}

export interface SupersedeBoundedWorkContractRevisionInput {
  readonly current: BoundedWorkContractRevision;
  readonly contract: BoundedWorkContract;
  readonly expectedRevisionDigest: string;
  readonly adoptedAt: string;
  readonly adoptedBy: BoundedWorkAdoptionAuthority;
  readonly accountingLineageId: string;
}

export type BoundedWorkScopeAssessment =
  | {
      readonly status: "within_scope";
      readonly diagnostics: readonly BoundedWorkTripwireDiagnostic[];
    }
  | {
      readonly status: "scope_revision_required";
      readonly violations: readonly BoundedWorkScopeViolation[];
      readonly diagnostics: readonly BoundedWorkTripwireDiagnostic[];
    };

export interface AssessBoundedWorkScopeInput {
  readonly revision: BoundedWorkContractRevision;
  readonly workItemId: string;
  readonly effect: BoundedWorkEffect;
  readonly surface: string;
  readonly paths: readonly string[];
  readonly requestedOutcomes?: readonly string[];
  readonly changedFiles?: number;
  readonly changedLines?: number;
  readonly activeDurationMs?: number;
  readonly toolCalls?: number;
}

export function adoptBoundedWorkContractRevision(
  input: AdoptBoundedWorkContractRevisionInput,
): BoundedWorkContractRevision {
  const contract = normalizeBoundedWorkContract(input.contract);
  const adoptedAt = requireCanonicalTimestamp(input.adoptedAt, "adoptedAt");
  const adoptedBy = normalizeAdoptionAuthority(input.adoptedBy);
  const contractDigest = boundedWorkDigest(contract);
  const accountingLineageId = requireText(input.accountingLineageId, "accountingLineageId");
  const revisionIdentity = {
    schema: "kiln.bounded-work-contract-revision/v1" as const,
    revision: 1,
    contractDigest,
    accountingLineageId,
    adoptedAt,
    adoptedBy,
  };
  return deepFreeze({
    ...revisionIdentity,
    revisionDigest: boundedWorkDigest(revisionIdentity),
    contract,
  });
}

export function supersedeBoundedWorkContractRevision(
  input: SupersedeBoundedWorkContractRevisionInput,
): BoundedWorkContractRevision {
  if (input.expectedRevisionDigest !== input.current.revisionDigest) {
    throw new Error(
      `bounded-work revision conflict: expected ${input.expectedRevisionDigest}, current ${input.current.revisionDigest}`,
    );
  }
  const accountingLineageId = requireText(input.accountingLineageId, "accountingLineageId");
  if (accountingLineageId !== input.current.accountingLineageId) {
    throw new Error("bounded-work accounting lineage cannot change during supersession");
  }
  const contract = normalizeBoundedWorkContract(input.contract);
  const adoptedAt = requireCanonicalTimestamp(input.adoptedAt, "adoptedAt");
  const adoptedBy = normalizeAdoptionAuthority(input.adoptedBy);
  const contractDigest = boundedWorkDigest(contract);
  const revisionIdentity = {
    schema: "kiln.bounded-work-contract-revision/v1" as const,
    revision: input.current.revision + 1,
    contractDigest,
    accountingLineageId,
    parentRevisionDigest: input.current.revisionDigest,
    adoptedAt,
    adoptedBy,
  };
  return deepFreeze({
    ...revisionIdentity,
    revisionDigest: boundedWorkDigest(revisionIdentity),
    contract,
  });
}

export function normalizeBoundedWorkContractRevision(
  input: BoundedWorkContractRevision,
): BoundedWorkContractRevision {
  if (input.schema !== "kiln.bounded-work-contract-revision/v1") {
    throw new Error("bounded-work revision schema is invalid");
  }
  const revision = positiveInteger(input.revision, "revision");
  const contract = normalizeBoundedWorkContract(input.contract);
  const contractDigest = boundedWorkDigest(contract);
  if (requireBoundedWorkDigest(input.contractDigest, "contractDigest") !== contractDigest) {
    throw new Error("bounded-work contract digest does not match content");
  }
  const accountingLineageId = requireText(input.accountingLineageId, "accountingLineageId");
  const adoptedAt = requireCanonicalTimestamp(input.adoptedAt, "adoptedAt");
  const adoptedBy = normalizeAdoptionAuthority(input.adoptedBy);
  const parentRevisionDigest = input.parentRevisionDigest === undefined
    ? undefined
    : requireBoundedWorkDigest(input.parentRevisionDigest, "parentRevisionDigest");
  if ((revision === 1) !== (parentRevisionDigest === undefined)) {
    throw new Error("bounded-work parent revision relation is invalid");
  }
  const revisionIdentity = {
    schema: "kiln.bounded-work-contract-revision/v1" as const,
    revision,
    contractDigest,
    accountingLineageId,
    ...(parentRevisionDigest === undefined ? {} : { parentRevisionDigest }),
    adoptedAt,
    adoptedBy,
  };
  const revisionDigest = boundedWorkDigest(revisionIdentity);
  if (requireBoundedWorkDigest(input.revisionDigest, "revisionDigest") !== revisionDigest) {
    throw new Error("bounded-work revision digest does not match identity");
  }
  return deepFreeze({ ...revisionIdentity, revisionDigest, contract });
}

export function assessBoundedWorkScope(input: AssessBoundedWorkScopeInput): BoundedWorkScopeAssessment {
  const contract = input.revision.contract;
  const violations = assessBoundedWorkScopePolicy({
    scope: contract.scope,
    nonGoals: contract.intent.nonGoals,
    workItemId: requireText(input.workItemId, "workItemId"),
    effect: input.effect,
    surface: requireText(input.surface, "surface"),
    paths: input.paths.map((path) => normalizeRelativePath(path, "paths")),
    requestedOutcomes: (input.requestedOutcomes ?? []).map((outcome) =>
      requireText(outcome, "requestedOutcomes"),
    ),
  });
  const diagnostics = boundedWorkTripwireDiagnostics(contract.tripwires, input);
  return violations.length === 0
    ? { status: "within_scope", diagnostics }
    : { status: "scope_revision_required", violations, diagnostics };
}

export function normalizeBoundedWorkContract(input: BoundedWorkContract): BoundedWorkContract {
  if (input.schema !== BOUNDED_WORK_CONTRACT_SCHEMA) {
    throw new Error(`bounded-work contract schema must be ${BOUNDED_WORK_CONTRACT_SCHEMA}`);
  }
  const limits: BoundedWorkLimits = {
    maxExecutionAttempts: positiveInteger(input.limits.maxExecutionAttempts, "maxExecutionAttempts"),
    maxManagedInvocations: nonNegativeInteger(input.limits.maxManagedInvocations, "maxManagedInvocations"),
    maxConcurrentManagedInvocations: nonNegativeInteger(
      input.limits.maxConcurrentManagedInvocations,
      "maxConcurrentManagedInvocations",
    ),
    maxChildDepth: nonNegativeInteger(input.limits.maxChildDepth, "maxChildDepth"),
    maxReviewRounds: nonNegativeInteger(input.limits.maxReviewRounds, "maxReviewRounds"),
    maxRemediationRounds: nonNegativeInteger(input.limits.maxRemediationRounds, "maxRemediationRounds"),
    ...(input.limits.maxToolCalls === undefined
      ? {}
      : { maxToolCalls: positiveInteger(input.limits.maxToolCalls, "maxToolCalls") }),
    ...(input.limits.maxActiveDurationMs === undefined
      ? {}
      : { maxActiveDurationMs: positiveInteger(input.limits.maxActiveDurationMs, "maxActiveDurationMs") }),
  };
  if (limits.maxConcurrentManagedInvocations > limits.maxManagedInvocations) {
    throw new Error("maxConcurrentManagedInvocations cannot exceed maxManagedInvocations");
  }
  const policy = normalizePolicy(input.policy);
  const acceptanceCriteria = normalizeAcceptanceCriteria(input.intent.acceptanceCriteria);
  return deepFreeze({
    schema: BOUNDED_WORK_CONTRACT_SCHEMA,
    intent: {
      objective: requireText(input.intent.objective, "intent.objective"),
      acceptanceCriteria,
      nonGoals: [...uniqueOptional(input.intent.nonGoals, "intent.nonGoals")].sort(),
    },
    assurance: normalizeAssurance(input.assurance, acceptanceCriteria),
    scope: {
      allowedWorkItemIds: [...uniqueRequired(input.scope.allowedWorkItemIds, "scope.allowedWorkItemIds")].sort(),
      permittedEffects: uniqueEffects(input.scope.permittedEffects),
      permittedSurfaces: [...uniqueRequired(input.scope.permittedSurfaces, "scope.permittedSurfaces")].sort(),
      allowedRoots: uniquePaths(input.scope.allowedRoots, "scope.allowedRoots", true),
      deniedRoots: uniquePaths(input.scope.deniedRoots, "scope.deniedRoots", false),
      refactorAuthority: changeAuthority(input.scope.refactorAuthority, "scope.refactorAuthority"),
      migrationAuthority: changeAuthority(input.scope.migrationAuthority, "scope.migrationAuthority"),
      dependencyAuthority: changeAuthority(input.scope.dependencyAuthority, "scope.dependencyAuthority"),
    },
    limits,
    tripwires: normalizeTripwires(input.tripwires),
    policy,
  });
}

function normalizeAdoptionAuthority(input: BoundedWorkAdoptionAuthority): BoundedWorkAdoptionAuthority {
  if (input.kind === "operator") {
    return {
      kind: "operator",
      actorId: requireText(input.actorId, "adoptedBy.actorId"),
      decisionId: requireText(input.decisionId, "adoptedBy.decisionId"),
    };
  }
  if (input.kind === "approved_plan") {
    const planDigest = requireBoundedWorkDigest(input.planDigest, "adoptedBy.planDigest");
    return {
      kind: "approved_plan",
      planId: requireText(input.planId, "adoptedBy.planId"),
      planDigest,
    };
  }
  throw new Error("adoptedBy.kind must be operator or approved_plan");
}

function normalizeAcceptanceCriteria(
  values: readonly BoundedWorkAcceptanceCriterion[],
): readonly BoundedWorkAcceptanceCriterion[] {
  const field = "intent.acceptanceCriteria";
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${field} must contain at least one value`);
  }
  const normalized = values.map((criterion, index) => {
    if (!isRecord(criterion)) {
      throw new Error(`${field}[${index}] must be an object`);
    }
    assertExactKeys(criterion, ["id", "statement"], `${field}[${index}]`);
    return {
      id: requireText(criterion.id, `${field}[${index}].id`),
      statement: requireText(criterion.statement, `${field}[${index}].statement`),
    };
  });
  unique(normalized.map(({ id }) => id), `${field} ids`);
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeAssurance(
  input: BoundedWorkAssurance,
  criteria: readonly BoundedWorkAcceptanceCriterion[],
): BoundedWorkAssurance {
  if (!isRecord(input) || !isRecord(input.formalVerification)) {
    throw new Error("assurance.formalVerification is required");
  }
  assertExactKeys(input, ["formalVerification"], "assurance");
  const formalVerification = input.formalVerification;
  assertExactKeys(
    formalVerification,
    ["semantics", "obligations", "mappings"],
    "assurance.formalVerification",
  );
  if (formalVerification.semantics !== "allOf") {
    throw new Error("assurance.formalVerification.semantics must be allOf");
  }

  const obligations = normalizeFormalVerificationObligations(formalVerification.obligations);
  const obligationIds = new Set(obligations.map(({ id }) => id));
  const mappings = normalizeFormalVerificationMappings(formalVerification.mappings);
  const criterionIds = new Set(criteria.map(({ id }) => id));
  const mappedCriterionIds = new Set<string>();
  const referencedObligationIds = new Set<string>();

  for (const mapping of mappings) {
    if (!criterionIds.has(mapping.criterionId)) {
      throw new Error(
        `assurance.formalVerification.mappings contains unknown criterionId ${mapping.criterionId}`,
      );
    }
    if (mappedCriterionIds.has(mapping.criterionId)) {
      throw new Error(
        `assurance.formalVerification.mappings must contain exactly one mapping for criterion ${mapping.criterionId}`,
      );
    }
    mappedCriterionIds.add(mapping.criterionId);
    for (const obligationId of mapping.obligationIds) {
      if (!obligationIds.has(obligationId)) {
        throw new Error(
          `assurance.formalVerification.mappings contains unknown obligationId ${obligationId}`,
        );
      }
      referencedObligationIds.add(obligationId);
    }
  }

  for (const criterion of criteria) {
    if (!mappedCriterionIds.has(criterion.id)) {
      throw new Error(
        `assurance.formalVerification.mappings must contain exactly one mapping for criterion ${criterion.id}`,
      );
    }
  }
  for (const obligation of obligations) {
    if (!referencedObligationIds.has(obligation.id)) {
      throw new Error(
        `assurance.formalVerification.obligations contains unmapped obligation ${obligation.id}`,
      );
    }
  }

  return {
    formalVerification: {
      semantics: "allOf",
      obligations,
      mappings,
    },
  };
}

function normalizeFormalVerificationObligations(
  values: readonly BoundedWorkFormalVerificationObligation[],
): readonly BoundedWorkFormalVerificationObligation[] {
  const field = "assurance.formalVerification.obligations";
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${field} must contain at least one value`);
  }
  const normalized = values.map((obligation, index) => {
    if (!isRecord(obligation)) {
      throw new Error(`${field}[${index}] must be an object`);
    }
    assertExactKeys(obligation, ["id", "symbol", "subjectPaths"], `${field}[${index}]`);
    const id = requireText(obligation.id, `${field}[${index}].id`);
    const symbol = requireText(obligation.symbol, `${field}[${index}].symbol`);
    const subjectPathField = `${field}[${id}].subjectPaths`;
    if (!Array.isArray(obligation.subjectPaths) || obligation.subjectPaths.length === 0) {
      throw new Error(`${subjectPathField} must contain at least one path`);
    }
    const subjectPaths = obligation.subjectPaths.map((path) =>
      normalizeCandidateSubjectPath(path, subjectPathField),
    );
    unique(subjectPaths, subjectPathField);
    return {
      id,
      symbol,
      subjectPaths: [...subjectPaths].sort(),
    };
  });
  unique(normalized.map(({ id }) => id), `${field} ids`);
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeFormalVerificationMappings(
  values: readonly BoundedWorkFormalVerificationMapping[],
): readonly BoundedWorkFormalVerificationMapping[] {
  const field = "assurance.formalVerification.mappings";
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${field} must contain at least one value`);
  }
  const normalized = values.map((mapping, index) => {
    if (!isRecord(mapping)) {
      throw new Error(`${field}[${index}] must be an object`);
    }
    assertExactKeys(mapping, ["criterionId", "obligationIds"], `${field}[${index}]`);
    const criterionId = requireText(mapping.criterionId, `${field}[${index}].criterionId`);
    if (!Array.isArray(mapping.obligationIds) || mapping.obligationIds.length === 0) {
      throw new Error(`${field}[${criterionId}].obligationIds must contain at least one value`);
    }
    const obligationIds = mapping.obligationIds.map((obligationId, obligationIndex) =>
      requireText(obligationId, `${field}[${criterionId}].obligationIds[${obligationIndex}]`),
    );
    unique(obligationIds, `${field}[${criterionId}].obligationIds`);
    return {
      criterionId,
      obligationIds: [...obligationIds].sort(),
    };
  });
  unique(normalized.map(({ criterionId }) => criterionId), `${field} criterionIds`);
  return normalized.sort((left, right) => left.criterionId.localeCompare(right.criterionId));
}

function normalizePolicy(input: BoundedWorkPolicy): BoundedWorkPolicy {
  if (input.scopeExpansion !== "deny" && input.scopeExpansion !== "approval_required") {
    throw new Error("policy.scopeExpansion must be deny or approval_required");
  }
  if (input.budgetExhaustion !== "pause" && input.budgetExhaustion !== "stop") {
    throw new Error("policy.budgetExhaustion must be pause or stop");
  }
  if (
    input.minimumHarnessCapability !== "authoritative"
    && input.minimumHarnessCapability !== "partially_enforced"
    && input.minimumHarnessCapability !== "advisory_only"
  ) {
    throw new Error("policy.minimumHarnessCapability is invalid");
  }
  return { ...input };
}

function normalizeTripwires(input: BoundedWorkTripwires): BoundedWorkTripwires {
  return {
    ...(input.changedFiles === undefined ? {} : { changedFiles: positiveInteger(input.changedFiles, "tripwires.changedFiles") }),
    ...(input.changedLines === undefined ? {} : { changedLines: positiveInteger(input.changedLines, "tripwires.changedLines") }),
    ...(input.activeDurationMs === undefined
      ? {}
      : { activeDurationMs: positiveInteger(input.activeDurationMs, "tripwires.activeDurationMs") }),
    ...(input.toolCalls === undefined ? {} : { toolCalls: positiveInteger(input.toolCalls, "tripwires.toolCalls") }),
  };
}

function uniqueEffects(values: readonly BoundedWorkEffect[]): readonly BoundedWorkEffect[] {
  const allowed: readonly BoundedWorkEffect[] = [
    "inspect",
    "modify_source",
    "modify_tests",
    "modify_documentation",
    "modify_configuration",
    "run_verification",
    "invoke_managed_agent",
    "external_write",
  ];
  const normalized = values.map((value) => {
    if (!allowed.includes(value)) throw new Error(`scope.permittedEffects contains invalid effect ${String(value)}`);
    return value;
  });
  if (normalized.length === 0) throw new Error("scope.permittedEffects must contain at least one value");
  return [...unique(normalized, "scope.permittedEffects")].sort();
}

function uniquePaths(values: readonly string[], field: string, required: boolean): readonly string[] {
  const normalized = values.map((value) => normalizeRelativePath(value, field));
  if (required && normalized.length === 0) throw new Error(`${field} must contain at least one value`);
  return [...unique(normalized, field)].sort();
}

function normalizeRelativePath(value: string, field: string): string {
  const normalized = requireText(value, field).replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || /^[A-Za-z]:\//u.test(normalized)
    || normalized.split("/").some((segment) => segment === ".." || segment.length === 0)
  ) {
    throw new Error(`${field} must contain normalized repository-relative paths`);
  }
  return normalized;
}

function normalizeCandidateSubjectPath(value: unknown, field: string): string {
  const path = requireText(value, field);
  if (typeof value !== "string" || value !== path) {
    throw new Error(`${field} must use normalized candidate-relative POSIX paths`);
  }
  if (
    path.includes("\\")
    || path.startsWith("/")
    || /^[A-Za-z]:/u.test(path)
    || path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`${field} must use normalized candidate-relative POSIX paths`);
  }
  return path;
}

function uniqueRequired(values: readonly string[], field: string): readonly string[] {
  if (values.length === 0) throw new Error(`${field} must contain at least one value`);
  return unique(values.map((value) => requireText(value, field)), field);
}

function uniqueOptional(values: readonly string[], field: string): readonly string[] {
  return unique(values.map((value) => requireText(value, field)), field);
}

function unique<T extends string>(values: readonly T[], field: string): readonly T[] {
  const result = [...new Set(values)];
  if (result.length !== values.length) throw new Error(`${field} must not contain duplicates`);
  return result;
}

function changeAuthority(value: BoundedWorkChangeAuthority, field: string): BoundedWorkChangeAuthority {
  if (value !== "none" && value !== "scoped" && value !== "unrestricted") {
    throw new Error(`${field} must be none, scoped, or unrestricted`);
  }
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function requireCanonicalTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const expected = new Set(keys);
  if (
    Object.keys(value).some((key) => !expected.has(key))
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new Error(`${field} has an invalid shape or extra field`);
  }
}

function deepFreeze<T>(value: T): T {
  return freezeBoundedWorkValue(value);
}
