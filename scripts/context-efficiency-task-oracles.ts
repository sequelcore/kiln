import { hasPassedBoundedImplementationVerification } from "../packages/core/src/eval/bounded-implementation.js";
export type ContextEfficiencyTaskOracleReasonCode =
  | "unsupported_oracle"
  | "answer_mismatch"
  | "tool_evidence_missing"
  | "tool_budget_exceeded"
  | "minimum_tool_calls_missing"
  | "minimum_tool_calls_not_met"
  | "required_term_missing"
  | "required_citation_missing"
  | "workspace_changed"
  | "required_read_targets_missing"
  | "required_read_target_missing"
  | "answer_unverified"
  | "fixture_verification_failed"
  | "fixture_diff_out_of_scope"
  | "managed_child_count_mismatch"
  | "managed_child_access_mismatch"
  | "managed_child_unsettled"
  | "managed_child_not_completed"
  | "managed_child_route_missing"
  | "managed_child_authority_missing"
  | "managed_child_handoff_missing";

export interface ContextEfficiencyReadToolEvidence {
  readonly toolName: string;
  readonly authorizedRootIndex: number;
  readonly relativePath: string;
  readonly succeeded: boolean;
  readonly complete: boolean;
}

export interface ContextEfficiencyTaskOracleEvidence {
  readonly toolCallCount?: number;
  readonly workspaceUnchanged?: boolean;
  /** Derived by a fixture-owned verifier; never persisted in the report. */
  readonly answerVerified?: boolean;
  readonly readToolEvidence?: readonly ContextEfficiencyReadToolEvidence[];
  readonly managedInvocations?: readonly unknown[];
  readonly workspaceChanges?: unknown;
  readonly observedVerification?: unknown;
}

export interface ContextEfficiencyTaskOracleInput {
  readonly answer: string;
  readonly oracle: Readonly<Record<string, unknown>>;
  readonly evidence: ContextEfficiencyTaskOracleEvidence;
}

export interface ContextEfficiencyTaskOracleResult {
  readonly passed: boolean;
  readonly reasonCodes: readonly ContextEfficiencyTaskOracleReasonCode[];
}

interface RequiredReadTarget {
  readonly authorizedRootIndex: number;
  readonly relativePath: string;
}

const PHYSICALLY_SETTLED_MANAGED_CHILD_LIFECYCLE_STATES = new Set([
  "completed",
  "failed",
]);

/**
 * Returns true unless each child both has a lifecycle state that can represent
 * physical settlement and has complete canonical transport evidence. Timeout,
 * cancellation, stale recovery, and persisted recovery can publish a terminal
 * record while external execution is still unresolved.
 */
export function hasUnsettledManagedChildInvocation(managedInvocations: readonly unknown[] | undefined): boolean {
  return (managedInvocations ?? []).some((invocation) =>
    !isRecord(invocation) || !hasLifecycleCandidateForPhysicalSettlement(invocation.lifecycleState)
      || !hasCompleteManagedChildTransportEvidence(invocation)
  );
}

function hasLifecycleCandidateForPhysicalSettlement(value: unknown): boolean {
  return typeof value === "string" && PHYSICALLY_SETTLED_MANAGED_CHILD_LIFECYCLE_STATES.has(value);
}

/**
 * Scores a task from ephemeral canonical evidence. Callers retain only the
 * boolean and bounded reason codes, never the answer, tool arguments, output,
 * or managed-invocation records used here.
 */
export function evaluateContextEfficiencyTaskOracle(
  input: ContextEfficiencyTaskOracleInput,
): ContextEfficiencyTaskOracleResult {
  const kind = input.oracle.kind;
  if (typeof kind !== "string") return failed(["unsupported_oracle"]);

  switch (kind) {
    case "exact_text":
      return evaluateExactText(input);
    case "required_terms_and_no_diff":
      return evaluateRepositoryReadOnly(input);
    case "fixture_checksum_and_tool_trajectory":
      return evaluateFixtureChecksum(input);
    case "fixture_test_and_allowed_diff":
      return evaluateBoundedImplementation(input);
    case "managed_child_settlement":
      return evaluateManagedChildSettlement(input);
    default:
      return failed(["unsupported_oracle"]);
  }
}

function evaluateExactText(input: ContextEfficiencyTaskOracleInput): ContextEfficiencyTaskOracleResult {
  const reasons: ContextEfficiencyTaskOracleReasonCode[] = [];
  const value = input.oracle.value;
  if (typeof value !== "string" || input.answer.trim() !== value) reasons.push("answer_mismatch");
  const maximumToolCalls = nonNegativeInteger(input.oracle.maximumToolCalls);
  if (maximumToolCalls !== undefined) {
    const toolCallCount = input.evidence.toolCallCount;
    if (toolCallCount === undefined) reasons.push("tool_evidence_missing");
    else if (toolCallCount > maximumToolCalls) reasons.push("tool_budget_exceeded");
  }
  return complete(reasons);
}

function evaluateRepositoryReadOnly(input: ContextEfficiencyTaskOracleInput): ContextEfficiencyTaskOracleResult {
  const reasons: ContextEfficiencyTaskOracleReasonCode[] = [];
  const answer = input.answer.toLocaleLowerCase("en");
  const requiredTerms = requiredStringArray(input.oracle.requiredTerms);
  if (!requiredTerms || requiredTerms.some((term) => !answer.includes(term.toLocaleLowerCase("en")))) {
    reasons.push("required_term_missing");
  }
  const requiredCitations = requiredStringArray(input.oracle.requiredCitations);
  if (!requiredCitations || requiredCitations.some((citation) => !answer.includes(normalizePath(citation).toLocaleLowerCase("en")))) {
    reasons.push("required_citation_missing");
  }
  if (input.evidence.workspaceUnchanged !== true) reasons.push("workspace_changed");
  const targets = requiredReadTargets(input.oracle);
  if (!targets) reasons.push("required_read_targets_missing");
  else appendReadCoverageReasons(reasons, targets, input.evidence.readToolEvidence, undefined, false);
  return complete(reasons);
}

function evaluateFixtureChecksum(input: ContextEfficiencyTaskOracleInput): ContextEfficiencyTaskOracleResult {
  const reasons: ContextEfficiencyTaskOracleReasonCode[] = [];
  if (input.evidence.answerVerified !== true) reasons.push("answer_unverified");
  const minimumToolCalls = positiveInteger(input.oracle.minimumToolCalls);
  if (minimumToolCalls === undefined) reasons.push("minimum_tool_calls_missing");
  else if (input.evidence.toolCallCount === undefined || input.evidence.toolCallCount < minimumToolCalls) {
    reasons.push("minimum_tool_calls_not_met");
  }
  const targets = requiredReadTargets(input.oracle);
  if (!targets) reasons.push("required_read_targets_missing");
  else appendReadCoverageReasons(reasons, targets, input.evidence.readToolEvidence, "read", true);
  return complete(reasons);
}

function evaluateBoundedImplementation(input: ContextEfficiencyTaskOracleInput): ContextEfficiencyTaskOracleResult {
  const reasons: ContextEfficiencyTaskOracleReasonCode[] = [];
  if (!hasPassedBoundedImplementationVerification(input.evidence.observedVerification)) {
    reasons.push("fixture_verification_failed");
  }
  const allowedPaths = requiredStringArray(input.oracle.allowedPaths);
  if (!allowedPaths || !hasOnlyAllowedChangedPaths(input.evidence.workspaceChanges, allowedPaths)) {
    reasons.push("fixture_diff_out_of_scope");
  }
  return complete(reasons);
}

function evaluateManagedChildSettlement(input: ContextEfficiencyTaskOracleInput): ContextEfficiencyTaskOracleResult {
  const reasons: ContextEfficiencyTaskOracleReasonCode[] = [];
  const managedInvocations = input.evidence.managedInvocations ?? [];
  const children = managedInvocations.filter(isRecord);
  const requiredChildCount = positiveInteger(input.oracle.requiredChildCount) ?? 1;
  if (children.length !== requiredChildCount) reasons.push("managed_child_count_mismatch");
  if (hasUnsettledManagedChildInvocation(managedInvocations)) reasons.push("managed_child_unsettled");
  const requiredAccess = typeof input.oracle.requiredAccess === "string" ? input.oracle.requiredAccess : "read-only";
  for (const child of children) {
    if (child.access !== requiredAccess) reasons.push("managed_child_access_mismatch");
    if (hasLifecycleCandidateForPhysicalSettlement(child.lifecycleState) && child.lifecycleState !== "completed") {
      reasons.push("managed_child_not_completed");
    }
    if (!hasRouteEvidence(child)) reasons.push("managed_child_route_missing");
    if (!hasReadOnlyAuthorityEvidence(child)) {
      reasons.push("managed_child_authority_missing");
    }
    if (!hasHandoffEvidence(child, requiredStringArray(input.oracle.requiredHandoffTerms))) {
      reasons.push("managed_child_handoff_missing");
    }
  }
  return complete(uniqueReasons(reasons));
}

function appendReadCoverageReasons(
  reasons: ContextEfficiencyTaskOracleReasonCode[],
  requiredTargets: readonly RequiredReadTarget[],
  observed: readonly ContextEfficiencyReadToolEvidence[] | undefined,
  requiredToolName?: string,
  requireComplete = true,
): void {
  if (requiredTargets.length === 0) return;
  if (!observed) {
    reasons.push("required_read_target_missing");
    return;
  }
  const observedTargets = new Set(
    observed
      .filter((entry) => entry.succeeded === true
        && (!requireComplete || entry.complete === true)
        && (requiredToolName === undefined || entry.toolName === requiredToolName))
      .map((entry) => readTargetKey(entry.authorizedRootIndex, entry.relativePath)),
  );
  if (requiredTargets.some((target) => !observedTargets.has(readTargetKey(target.authorizedRootIndex, target.relativePath)))) {
    reasons.push("required_read_target_missing");
  }
}

function hasOnlyAllowedChangedPaths(value: unknown, allowedPaths: readonly string[]): boolean {
  if (allowedPaths.length === 0 || !isRecord(value)) return false;
  if (!Array.isArray(value.changed) || !Array.isArray(value.added) || !Array.isArray(value.deleted)) return false;
  const changed = value.changed;
  const added = value.added;
  const deleted = value.deleted;
  return changed.length === 1
    && added.length === 0
    && deleted.length === 0
    && isRecord(changed[0])
    && typeof changed[0].path === "string"
    && allowedPaths.includes(changed[0].path);
}

function hasRouteEvidence(child: Readonly<Record<string, unknown>>): boolean {
  const providerRoute = isRecord(child.providerRoute) ? child.providerRoute : undefined;
  const capabilitySnapshot = isRecord(child.capabilitySnapshot) ? child.capabilitySnapshot : undefined;
  return typeof providerRoute?.providerId === "string"
    && providerRoute.providerId.length > 0
    && typeof capabilitySnapshot?.routeId === "string"
    && capabilitySnapshot.routeId.length > 0;
}

function hasReadOnlyAuthorityEvidence(child: Readonly<Record<string, unknown>>): boolean {
  const authority = isRecord(child.authoritySnapshot) ? child.authoritySnapshot : undefined;
  const toolAuthority = isRecord(authority?.toolAuthority) ? authority.toolAuthority : undefined;
  const workingDirectory = isRecord(authority?.workingDirectory) ? authority.workingDirectory : undefined;
  return child.requestedAuthority === "read_only"
    && typeof child.authorityProfileId === "string"
    && child.authorityProfileId.length > 0
    && toolAuthority?.writeAllowed === false
    && workingDirectory?.mode === "read-only";
}

function hasCompleteManagedChildTransportEvidence(child: Readonly<Record<string, unknown>>): boolean {
  const observations = child.providerRequestObservations;
  return Array.isArray(observations)
    && observations.length > 0
    && observations.every((observation) => isCompleteProviderTransportObservation(observation));
}

function isCompleteProviderTransportObservation(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.dispatch) || !isRecord(value.usage)) return false;
  const attempt = value.dispatch.attempt;
  const outcome = value.dispatch.outcome;
  const input = value.usage.input;
  const output = value.usage.output;
  return isRecord(attempt)
    && attempt.state === "observed"
    && typeof attempt.value === "number"
    && Number.isSafeInteger(attempt.value)
    && attempt.value >= 0
    && (outcome === "completed" || outcome === "failed" || outcome === "response_received")
    && isProviderReportedTokenQuantity(input)
    && isProviderReportedTokenQuantity(output);
}

function isProviderReportedTokenQuantity(value: unknown): boolean {
  return isRecord(value)
    && value.measurement === "provider_reported"
    && typeof value.tokens === "number"
    && Number.isSafeInteger(value.tokens)
    && value.tokens >= 0;
}

function hasHandoffEvidence(
  child: Readonly<Record<string, unknown>>,
  requiredTerms: readonly string[] | undefined,
): boolean {
  const handoff = isRecord(child.resultHandoff) ? child.resultHandoff : undefined;
  const summary = typeof handoff?.summary === "string" ? handoff.summary : undefined;
  const resourceUris = handoff?.resourceUris;
  return summary !== undefined
    && summary.trim().length > 0
    && Array.isArray(resourceUris)
    && resourceUris.some((uri) => typeof uri === "string" && uri.length > 0)
    && requiredTerms !== undefined
    && requiredTerms.length > 0
    && requiredTerms.every((term) => summary.toLocaleLowerCase("en").includes(term.toLocaleLowerCase("en")));
}

function requiredReadTargets(oracle: Readonly<Record<string, unknown>>): readonly RequiredReadTarget[] | undefined {
  if (!Array.isArray(oracle.requiredReadTargets) || oracle.requiredReadTargets.length === 0) return undefined;
  const targets = oracle.requiredReadTargets.map((entry) => {
    if (!isRecord(entry)
      || !Number.isSafeInteger(entry.authorizedRootIndex)
      || (entry.authorizedRootIndex as number) < 0
      || typeof entry.relativePath !== "string"
      || !isSafeRelativePath(entry.relativePath)) {
      return undefined;
    }
    return {
      authorizedRootIndex: entry.authorizedRootIndex as number,
      relativePath: normalizePath(entry.relativePath),
    };
  });
  return targets.some((target) => target === undefined)
    ? undefined
    : targets as readonly RequiredReadTarget[];
}

function requiredStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    return undefined;
  }
  return value as readonly string[];
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function isSafeRelativePath(value: string): boolean {
  const normalized = normalizePath(value.trim());
  return normalized.length > 0
    && !normalized.startsWith("/")
    && !/^[a-zA-Z]:\//u.test(normalized)
    && normalized !== ".."
    && !normalized.startsWith("../");
}

function readTargetKey(authorizedRootIndex: number, relativePath: string): string {
  return `${authorizedRootIndex}:${normalizePath(relativePath)}`;
}

function complete(reasons: readonly ContextEfficiencyTaskOracleReasonCode[]): ContextEfficiencyTaskOracleResult {
  const reasonCodes = uniqueReasons(reasons);
  return { passed: reasonCodes.length === 0, reasonCodes };
}

function failed(reasonCodes: readonly ContextEfficiencyTaskOracleReasonCode[]): ContextEfficiencyTaskOracleResult {
  return { passed: false, reasonCodes };
}

function uniqueReasons(
  reasons: readonly ContextEfficiencyTaskOracleReasonCode[],
): readonly ContextEfficiencyTaskOracleReasonCode[] {
  return [...new Set(reasons)];
}
