import type { CanonicalSessionEvent, SessionExecutionScope } from "@kilnai/core/events";
import {
  isFormalVerificationObservation,
  parseFormalVerificationObservation,
  type FormalVerificationObservation,
} from "@kilnai/core/verification";

interface RuntimeFormalVerificationWorkItemScope {
  readonly kind: "work_item";
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly managedInvocationId?: string;
}

const RUNTIME_FORMAL_VERIFICATION_OBSERVATION_BRAND: unique symbol = Symbol(
  "kiln.runtime-formal-verification-observation",
);

type RuntimeOwnedFormalVerificationObservation = RuntimeFormalVerificationObservation & {
  readonly [RUNTIME_FORMAL_VERIFICATION_OBSERVATION_BRAND]: true;
};

/**
 * A verifier observation with provenance owned by Runtime rather than by the
 * tool input or result payload. The parsed Core metadata is facts-only and
 * still establishes no acceptance criterion.
 */
export interface RuntimeFormalVerificationObservation {
  readonly metadata: FormalVerificationObservation;
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
  readonly executionScope: RuntimeFormalVerificationWorkItemScope;
}

/**
 * Structural summary shape Runtime records for one completed tool call. This
 * shape alone is not provenance; only the Runtime-owned executor may admit a
 * summary into the context flow.
 */
/** @internal Runtime-owned collector input; intentionally absent from package barrels. */
export interface RuntimeFormalVerificationObservationExecution {
  readonly toolCallScopeId: string;
  readonly toolCallId?: string;
  readonly toolName: string;
  readonly success: boolean;
  readonly metadata?: unknown;
  readonly executionScope?: SessionExecutionScope;
}

/** @internal Runtime-owned collector input; intentionally absent from package barrels. */
export interface CollectRuntimeFormalVerificationObservationsInput {
  readonly currentScope?: SessionExecutionScope;
  readonly sessionEvents?: readonly CanonicalSessionEvent[];
  readonly currentTurnToolExecutions?: readonly RuntimeFormalVerificationObservationExecution[];
  readonly currentTurnObservations?: readonly RuntimeFormalVerificationObservation[];
}

/** @internal Guard for the attached Runtime/Core authority boundary; not a public barrel export. */
export function isRuntimeOwnedFormalVerificationObservation(
  value: unknown,
): value is RuntimeFormalVerificationObservation {
  return typeof value === "object"
    && value !== null
    && Object.prototype.hasOwnProperty.call(value, RUNTIME_FORMAL_VERIFICATION_OBSERVATION_BRAND)
    && (value as { readonly [RUNTIME_FORMAL_VERIFICATION_OBSERVATION_BRAND]?: unknown })[
      RUNTIME_FORMAL_VERIFICATION_OBSERVATION_BRAND
    ] === true;
}

/**
 * Reconstruct the formal-verification facts visible to one exact work-item
 * execution scope. Canonical completed events are replayed before Runtime's
 * normalized current-turn observations and summaries. Equal normalized
 * duplicates are deduplicated in that deterministic order; conflicting
 * identities are omitted fail-closed. This internal pure helper does not
 * itself establish provenance for arbitrary callers.
 */
export function collectRuntimeFormalVerificationObservations(
  input: CollectRuntimeFormalVerificationObservationsInput,
): readonly RuntimeFormalVerificationObservation[] {
  const currentScope = normalizeWorkItemScope(input.currentScope);
  if (!currentScope) return [];

  const observations: RuntimeFormalVerificationObservation[] = [];
  const observationsByIdentity = new Map<string, RuntimeFormalVerificationObservation | null>();
  const appendObservation = (observation: RuntimeFormalVerificationObservation | undefined): void => {
    if (!observation || !isRuntimeOwnedFormalVerificationObservation(observation) || !sameExecutionScope(observation.executionScope, currentScope)) return;
    const identity = observationIdentity(observation.toolCallScopeId, observation.toolCallId);
    if (!identity) return;
    if (!observationsByIdentity.has(identity)) {
      observationsByIdentity.set(identity, observation);
      observations.push(observation);
      return;
    }

    const previous = observationsByIdentity.get(identity) ?? null;
    if (previous && sameObservation(previous, observation)) return;
    observationsByIdentity.set(identity, null);
    const index = observations.findIndex((entry) => observationIdentity(entry.toolCallScopeId, entry.toolCallId) === identity);
    if (index >= 0) observations.splice(index, 1);
  };
  const append = (source: RuntimeFormalVerificationObservationExecution): void => {
    const identity = observationIdentity(source.toolCallScopeId, source.toolCallId);
    if (!identity) return;
    const observation = parseObservation(source, currentScope);
    if (!observationsByIdentity.has(identity)) {
      observationsByIdentity.set(identity, observation ?? null);
      if (observation) observations.push(observation);
      return;
    }

    const previous = observationsByIdentity.get(identity) ?? null;
    if (previous && observation && sameObservation(previous, observation)) return;

    // A malformed, failed, out-of-scope, or structurally different duplicate
    // must not let source ordering select authority for one canonical tool call.
    observationsByIdentity.set(identity, null);
    const index = observations.findIndex((entry) => observationIdentity(entry.toolCallScopeId, entry.toolCallId) === identity);
    if (index >= 0) observations.splice(index, 1);
  };

  for (const event of input.sessionEvents ?? []) {
    if (event.kind !== "tool_call_completed") continue;
    append({
      toolCallId: event.toolCallId,
      toolCallScopeId: event.toolCallScopeId,
      toolName: event.toolName,
      success: event.status.state === "succeeded",
      metadata: event.metadata,
      executionScope: event.executionScope,
    });
  }

  for (const execution of input.currentTurnToolExecutions ?? []) {
    append(execution);
  }
  for (const observation of input.currentTurnObservations ?? []) {
    appendObservation(observation);
  }

  return Object.freeze(observations);
}

function parseObservation(
  source: RuntimeFormalVerificationObservationExecution,
  currentScope: RuntimeFormalVerificationWorkItemScope,
): RuntimeFormalVerificationObservation | undefined {
  if (
    typeof source.toolCallScopeId !== "string"
    || source.toolCallScopeId.trim().length === 0
    ||
    source.success !== true
    || source.toolName !== "formal_verify"
    || typeof source.toolCallId !== "string"
    || source.toolCallId.trim().length === 0
  ) {
    return undefined;
  }

  const sourceScope = normalizeWorkItemScope(source.executionScope);
  if (!sourceScope || !sameExecutionScope(sourceScope, currentScope)) return undefined;
  if (!isFormalVerificationObservation(source.metadata)) return undefined;

  // The discriminator is intentionally followed by Core's parser so Runtime
  // stores the immutable normalized value, never the untrusted raw object.
  const parsedMetadata = parseFormalVerificationObservation(source.metadata);
  const observation = {
    metadata: parsedMetadata,
    toolCallScopeId: source.toolCallScopeId,
    toolCallId: source.toolCallId,
    executionScope: sourceScope,
  };
  Object.defineProperty(observation, RUNTIME_FORMAL_VERIFICATION_OBSERVATION_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return Object.freeze(observation) as RuntimeOwnedFormalVerificationObservation;
}

function normalizeWorkItemScope(
  value: SessionExecutionScope | undefined,
): RuntimeFormalVerificationWorkItemScope | undefined {
  if (!value || value.kind !== "work_item") return undefined;
  if (!isNonEmptyString(value.goalRunId) || !isNonEmptyString(value.workItemId)) return undefined;
  if (!isNonEmptyString(value.attemptId)) return undefined;
  if (hasOwn(value, "managedInvocationId") && !isNonEmptyString(value.managedInvocationId)) return undefined;

  return Object.freeze({
    kind: "work_item",
    goalRunId: value.goalRunId,
    workItemId: value.workItemId,
    attemptId: value.attemptId,
    ...(hasOwn(value, "managedInvocationId") ? { managedInvocationId: value.managedInvocationId } : {}),
  });
}

function sameObservation(
  left: RuntimeFormalVerificationObservation,
  right: RuntimeFormalVerificationObservation,
): boolean {
  return left.toolCallScopeId === right.toolCallScopeId
    && left.toolCallId === right.toolCallId
    && sameExecutionScope(left.executionScope, right.executionScope)
    && JSON.stringify(left.metadata) === JSON.stringify(right.metadata);
}

function observationIdentity(toolCallScopeId: unknown, toolCallId: unknown): string | undefined {
  if (typeof toolCallScopeId !== "string" || toolCallScopeId.trim().length === 0) return undefined;
  if (typeof toolCallId !== "string" || toolCallId.trim().length === 0) return undefined;
  return JSON.stringify([toolCallScopeId, toolCallId]);
}

function sameExecutionScope(
  left: RuntimeFormalVerificationWorkItemScope,
  right: RuntimeFormalVerificationWorkItemScope,
): boolean {
  return left.goalRunId === right.goalRunId
    && left.workItemId === right.workItemId
    && sameOptionalScopeField(left, right, "attemptId")
    && sameOptionalScopeField(left, right, "managedInvocationId");
}

function sameOptionalScopeField(
  left: RuntimeFormalVerificationWorkItemScope,
  right: RuntimeFormalVerificationWorkItemScope,
  field: "attemptId" | "managedInvocationId",
): boolean {
  const leftHas = hasOwn(left, field);
  const rightHas = hasOwn(right, field);
  return leftHas === rightHas && (!leftHas || left[field] === right[field]);
}

function hasOwn(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
