/**
 * Bounded-work scope policy: the vocabulary of scope authority and the pure
 * admission decision over it.
 *
 * Owns which work item, effect, surface, path, and requested outcome a scope
 * permits. Every input is already normalized, so nothing here validates,
 * throws, or reads external state.
 *
 * Separated from `bounded-work-contract.ts` so the authority rules form a
 * self-contained, deterministically verifiable surface. Contract composition,
 * input normalization, and revision lifecycle remain that module's concern.
 */

/** A semantic effect a bounded-work scope may permit. */
export type BoundedWorkEffect =
  | "inspect"
  | "modify_source"
  | "modify_tests"
  | "modify_documentation"
  | "modify_configuration"
  | "run_verification"
  | "invoke_managed_agent"
  | "external_write";

/** How far a scope may take a class of change on its own authority. */
export type BoundedWorkChangeAuthority = "none" | "scoped" | "unrestricted";

/** The authority a contract revision grants for one bounded unit of work. */
export interface BoundedWorkScope {
  readonly allowedWorkItemIds: readonly string[];
  readonly permittedEffects: readonly BoundedWorkEffect[];
  readonly permittedSurfaces: readonly string[];
  readonly allowedRoots: readonly string[];
  readonly deniedRoots: readonly string[];
  readonly refactorAuthority: BoundedWorkChangeAuthority;
  readonly migrationAuthority: BoundedWorkChangeAuthority;
  readonly dependencyAuthority: BoundedWorkChangeAuthority;
}

/** Consumption thresholds that raise a diagnostic without denying admission. */
export interface BoundedWorkTripwires {
  readonly changedFiles?: number;
  readonly changedLines?: number;
  readonly activeDurationMs?: number;
  readonly toolCalls?: number;
}

/** Why a requested action fell outside its scope. */
export type BoundedWorkScopeViolationKind =
  | "work_item_not_permitted"
  | "effect_not_permitted"
  | "surface_not_permitted"
  | "path_not_permitted"
  | "path_denied"
  | "non_goal_requested";

export interface BoundedWorkScopeViolation {
  readonly kind: BoundedWorkScopeViolationKind;
  readonly value: string;
}

/** Consumption metric a tripwire threshold is measured against. */
export type BoundedWorkTripwireMetric =
  | "changed_files"
  | "changed_lines"
  | "active_duration_ms"
  | "tool_calls";

export interface BoundedWorkTripwireDiagnostic {
  readonly kind: "tripwire_exceeded";
  readonly metric: BoundedWorkTripwireMetric;
  readonly actual: number;
  readonly threshold: number;
}

/** Normalized admission question asked of a contract revision's scope. */
export interface BoundedWorkScopePolicyQuery {
  readonly scope: BoundedWorkScope;
  readonly nonGoals: readonly string[];
  readonly workItemId: string;
  readonly effect: BoundedWorkEffect;
  readonly surface: string;
  readonly paths: readonly string[];
  readonly requestedOutcomes: readonly string[];
}

/** Observed consumption compared against a revision's tripwire thresholds. */
export interface BoundedWorkMeasuredUsage {
  readonly changedFiles?: number;
  readonly changedLines?: number;
  readonly activeDurationMs?: number;
  readonly toolCalls?: number;
}

/**
 * Whether a normalized repository-relative path falls under a scope root.
 * `.` denotes the repository root and therefore contains every path.
 */
export function pathWithinRoot(path: string, root: string): boolean {
  return root === "." || path === root || path.startsWith(`${root}/`);
}

/**
 * Scope violations for one normalized admission query, in declaration order:
 * work item, effect, surface, paths, then requested outcomes.
 *
 * A denied root always takes precedence over an allowed root: a path matching
 * any denied root is rejected without consulting the allowed roots at all.
 */
export function assessBoundedWorkScopePolicy(
  query: BoundedWorkScopePolicyQuery,
): readonly BoundedWorkScopeViolation[] {
  const violations: BoundedWorkScopeViolation[] = [];
  if (!query.scope.allowedWorkItemIds.includes(query.workItemId)) {
    violations.push({ kind: "work_item_not_permitted", value: query.workItemId });
  }
  if (!query.scope.permittedEffects.includes(query.effect)) {
    violations.push({ kind: "effect_not_permitted", value: query.effect });
  }
  if (!query.scope.permittedSurfaces.includes(query.surface)) {
    violations.push({ kind: "surface_not_permitted", value: query.surface });
  }
  for (const path of query.paths) {
    if (query.scope.deniedRoots.some((root) => pathWithinRoot(path, root))) {
      violations.push({ kind: "path_denied", value: path });
    } else if (!query.scope.allowedRoots.some((root) => pathWithinRoot(path, root))) {
      violations.push({ kind: "path_not_permitted", value: path });
    }
  }
  for (const requestedOutcome of query.requestedOutcomes) {
    if (query.nonGoals.includes(requestedOutcome)) {
      violations.push({ kind: "non_goal_requested", value: requestedOutcome });
    }
  }
  return violations;
}

/** Tripwire diagnostics for observed usage that exceeded a configured threshold. */
export function boundedWorkTripwireDiagnostics(
  tripwires: BoundedWorkTripwires,
  measured: BoundedWorkMeasuredUsage,
): readonly BoundedWorkTripwireDiagnostic[] {
  const diagnostics: BoundedWorkTripwireDiagnostic[] = [];
  for (const exceeded of [
    tripwireExceeded("changed_files", measured.changedFiles, tripwires.changedFiles),
    tripwireExceeded("changed_lines", measured.changedLines, tripwires.changedLines),
    tripwireExceeded("active_duration_ms", measured.activeDurationMs, tripwires.activeDurationMs),
    tripwireExceeded("tool_calls", measured.toolCalls, tripwires.toolCalls),
  ]) {
    if (exceeded !== undefined) diagnostics.push(exceeded);
  }
  return diagnostics;
}

function tripwireExceeded(
  metric: BoundedWorkTripwireMetric,
  actual: number | undefined,
  threshold: number | undefined,
): BoundedWorkTripwireDiagnostic | undefined {
  if (actual === undefined || threshold === undefined || actual <= threshold) return undefined;
  return { kind: "tripwire_exceeded", metric, actual, threshold };
}
