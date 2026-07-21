import {
  isSameProviderModelRoute,
  type ProviderModelRouteIdentity,
} from "../provider-model-evidence.js";

export {
  dispatchModelGatewayOneRound,
  validateModelTurn,
  validateModelTurnResult,
} from "./one-round-dispatcher.js";
export type {
  CustomModelTool,
  CustomModelToolCall,
  FunctionModelTool,
  FunctionModelToolCall,
  ModelJsonObject,
  ModelJsonValue,
  ModelGatewayOneRoundDispatcher,
  ModelGatewayOneRoundDispatchInput,
  ModelImagePart,
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
} from "./one-round-dispatcher.js";
export {
  abandonModelGatewayReplayClaim,
  commitModelGatewayReplayClaim,
  completeModelGatewayReplayClaim,
  createModelGatewayReplayClaim,
  settleModelGatewayReplayClaimUnknown,
} from "./replay-guard.js";
export type {
  ModelGatewayReplayClaim,
  ModelGatewayReplayFence,
  ModelGatewayReplayKey,
} from "./replay-guard.js";

declare const ACCOUNT_REF: unique symbol;

/** Opaque account identifier. It intentionally carries no credential material. */
export type AccountRef = string & { readonly [ACCOUNT_REF]: "AccountRef" };

/** The provider/model route shape shared with provider-model evidence. */
export type ModelGatewayRoute = ProviderModelRouteIdentity;

export interface ModelGatewayAffinity {
  readonly account: AccountRef;
  readonly route: ModelGatewayRoute;
}

export type ModelGatewayAccountHealth = "healthy" | "unhealthy";

export interface ModelGatewayAccountCandidate {
  readonly account: AccountRef;
  readonly route: ModelGatewayRoute;
  readonly health: ModelGatewayAccountHealth;
  /** Lower pressure is preferred. */
  readonly pressure: number;
  /** Reserved capacity cannot be claimed by unrelated new work. */
  readonly reservedForNewWork: boolean;
}

export interface SelectModelGatewayAccountInput {
  readonly route: ModelGatewayRoute;
  readonly work: "new" | "existing";
  readonly affinity?: ModelGatewayAffinity;
  /** Explicitly permits a new account only when an existing affinity cannot be honored. */
  readonly allowAffinityRebind?: boolean;
  readonly candidates: readonly ModelGatewayAccountCandidate[];
}

export type ModelGatewayAccountRejectionReason = "unhealthy" | "incompatible-route" | "reserved-for-new-work";

export interface ModelGatewayAccountRejection {
  readonly account: AccountRef;
  readonly reason: ModelGatewayAccountRejectionReason;
}

export interface ModelGatewayAccountSelection {
  readonly account: AccountRef;
  readonly route: ModelGatewayRoute;
  readonly reason: "existing-affinity" | "least-pressure" | "affinity-rebind";
}

export type ModelGatewayAffinityOutcome = "honored" | "missing" | "rejected" | "rebound";

export interface ModelGatewayAffinityEvidence {
  readonly requested: ModelGatewayAffinity;
  readonly outcome: ModelGatewayAffinityOutcome;
  readonly reason?: "missing-affinity-account" | ModelGatewayAccountRejectionReason;
  readonly reboundTo?: AccountRef;
}

export interface ModelGatewayAccountSelectionResult {
  readonly selected?: ModelGatewayAccountSelection;
  readonly rejections: readonly ModelGatewayAccountRejection[];
  readonly affinity?: ModelGatewayAffinityEvidence;
}

export interface NewWorkAccountReservation {
  readonly account: AccountRef;
  readonly route: ModelGatewayRoute;
}

export function createAccountRef(value: string): AccountRef {
  const canonical = value.trim();
  if (canonical.length === 0) {
    throw new TypeError("AccountRef must not be empty.");
  }
  return canonical as AccountRef;
}

/**
 * Selects only from the supplied snapshot. It does not mutate capacity or
 * attempt provider work; callers persist any resulting reservation themselves.
 */
export function selectModelGatewayAccount(input: SelectModelGatewayAccountInput): ModelGatewayAccountSelectionResult {
  validateSelectionInput(input);
  const candidates = [...input.candidates].sort((left, right) => left.account.localeCompare(right.account));
  if (input.work === "existing") {
    return selectExistingAffinityAccount(input, input.affinity!, candidates);
  }

  return selectLeastPressureAccount(input, candidates);
}

function selectExistingAffinityAccount(
  input: SelectModelGatewayAccountInput,
  affinity: ModelGatewayAffinity,
  candidates: readonly ModelGatewayAccountCandidate[],
): ModelGatewayAccountSelectionResult {
  const affinityCandidate = candidates.find((candidate) => candidate.account === affinity.account);
  if (affinityCandidate !== undefined && isEligible(affinityCandidate, input)) {
    return Object.freeze({
      selected: Object.freeze({
        account: affinityCandidate.account,
        route: affinityCandidate.route,
        reason: "existing-affinity",
      }),
      rejections: Object.freeze([]),
      affinity: Object.freeze({ requested: affinity, outcome: "honored" }),
    });
  }

  const reason = affinityCandidate === undefined ? "missing-affinity-account" as const : rejectionReason(affinityCandidate, input);
  const affinityRejections = affinityCandidate === undefined
    ? Object.freeze([] as ModelGatewayAccountRejection[])
    : Object.freeze([Object.freeze({ account: affinityCandidate.account, reason: rejectionReason(affinityCandidate, input) })]);
  if (!input.allowAffinityRebind) {
    return Object.freeze({
      rejections: affinityRejections,
      affinity: Object.freeze({
        requested: affinity,
        outcome: affinityCandidate === undefined ? "missing" : "rejected",
        reason,
      }),
    });
  }

  const rebound = selectLeastPressureAccount(input, candidates, affinityRejections);
  if (rebound.selected === undefined) {
    return Object.freeze({
      ...rebound,
      affinity: Object.freeze({
        requested: affinity,
        outcome: affinityCandidate === undefined ? "missing" : "rejected",
        reason,
      }),
    });
  }
  return Object.freeze({
    selected: Object.freeze({ ...rebound.selected, reason: "affinity-rebind" }),
    rejections: rebound.rejections,
    affinity: Object.freeze({ requested: affinity, outcome: "rebound", reason, reboundTo: rebound.selected.account }),
  });
}

function selectLeastPressureAccount(
  input: SelectModelGatewayAccountInput,
  candidates: readonly ModelGatewayAccountCandidate[],
  retainedRejections: readonly ModelGatewayAccountRejection[] = [],
): ModelGatewayAccountSelectionResult {
  const eligible = candidates.filter((candidate) => isEligible(candidate, input));
  if (eligible.length > 0) {
    const selected = [...eligible].sort((left, right) => left.pressure - right.pressure || left.account.localeCompare(right.account))[0]!;
    return Object.freeze({
      selected: Object.freeze({ account: selected.account, route: selected.route, reason: "least-pressure" }),
      rejections: Object.freeze(retainedRejections),
    });
  }

  return Object.freeze({
    rejections: Object.freeze([...retainedRejections, ...candidates
      .filter((candidate) => !retainedRejections.some((rejection) => rejection.account === candidate.account))
      .map((candidate) => Object.freeze({
      account: candidate.account,
      reason: rejectionReason(candidate, input),
    }))]),
  });
}

/** Returns the portable reservation evidence for a successful new-work selection. */
export function reserveAccountForNewWork(input: SelectModelGatewayAccountInput): NewWorkAccountReservation | undefined {
  if (input.work !== "new") {
    throw new TypeError("New-work reservations require work: new.");
  }
  const selection = selectModelGatewayAccount(input).selected;
  return selection === undefined
    ? undefined
    : Object.freeze({ account: selection.account, route: selection.route });
}

export type AttemptCommitPhase = "planned" | "leased" | "dispatching" | "committed" | "succeeded" | "failed" | "cancelled";

export interface AttemptCommit {
  readonly attemptId: string;
  readonly account: AccountRef;
  readonly phase: AttemptCommitPhase;
}

export function createAttemptCommit(input: { readonly attemptId: string; readonly account: AccountRef }): AttemptCommit {
  if (input.attemptId.trim().length === 0) throw new TypeError("attemptId must not be empty.");
  return Object.freeze({ ...input, phase: "planned" });
}

/** Advances only the durable attempt lifecycle; terminal phases are irreversible. */
export function advanceAttemptCommit(attempt: AttemptCommit, phase: AttemptCommitPhase): AttemptCommit {
  if (!isNextPhase(attempt.phase, phase)) {
    throw new Error(`Invalid AttemptCommit transition: ${attempt.phase} -> ${phase}.`);
  }
  return Object.freeze({ ...attempt, phase });
}

/**
 * An account may change while no dispatch has started. Once dispatching begins,
 * provider effects may exist and a fresh attempt is required instead of failover.
 */
export function reassignAttemptAccount(attempt: AttemptCommit, account: AccountRef): AttemptCommit {
  if (attempt.phase !== "planned" && attempt.phase !== "leased") {
    throw new Error(`AttemptCommit cannot change accounts after ${attempt.phase}.`);
  }
  return Object.freeze({ ...attempt, account });
}

function isEligible(candidate: ModelGatewayAccountCandidate, input: SelectModelGatewayAccountInput): boolean {
  return candidate.health === "healthy"
    && isSameProviderModelRoute(candidate.route, input.route)
    && !(input.work === "new" && candidate.reservedForNewWork);
}

function rejectionReason(candidate: ModelGatewayAccountCandidate, input: SelectModelGatewayAccountInput): ModelGatewayAccountRejectionReason {
  if (candidate.health !== "healthy") return "unhealthy";
  if (!isSameProviderModelRoute(candidate.route, input.route)) return "incompatible-route";
  return "reserved-for-new-work";
}

function validateSelectionInput(input: SelectModelGatewayAccountInput): void {
  requireRoute(input.route, "route");
  if (input.work === "existing" && input.affinity === undefined) {
    throw new TypeError("Existing work requires an affinity.");
  }
  const accounts = new Set<AccountRef>();
  for (const [index, candidate] of input.candidates.entries()) {
    requireCanonicalAccountRef(candidate.account, `candidates[${index}].account`);
    if (accounts.has(candidate.account)) {
      throw new TypeError("candidates must not contain duplicate accounts.");
    }
    accounts.add(candidate.account);
    requireRoute(candidate.route, `candidates[${index}].route`);
    if (!Number.isFinite(candidate.pressure) || candidate.pressure < 0) {
      throw new TypeError(`candidates[${index}].pressure must be a non-negative finite number.`);
    }
  }
  if (input.affinity !== undefined) {
    requireCanonicalAccountRef(input.affinity.account, "affinity.account");
    requireRoute(input.affinity.route, "affinity.route");
    if (!isSameProviderModelRoute(input.affinity.route, input.route)) {
      throw new TypeError("affinity.route must match route.");
    }
  }
}

function requireRoute(route: ModelGatewayRoute, field: string): void {
  for (const [name, value] of Object.entries({
    providerId: route.providerId,
    providerModelId: route.providerModelId,
    scope: route.scope,
  })) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`${field}.${name} must not be empty.`);
    }
  }
}

function requireCanonicalAccountRef(value: AccountRef, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${field} must be canonical.`);
  }
}

function isNextPhase(current: AttemptCommitPhase, next: AttemptCommitPhase): boolean {
  const isPreCommitTerminal = (next === "failed" || next === "cancelled")
    && (current === "planned" || current === "leased" || current === "dispatching");
  return isPreCommitTerminal
    || (current === "planned" && next === "leased")
    || (current === "leased" && next === "dispatching")
    || (current === "dispatching" && next === "committed")
    || (current === "committed" && (next === "succeeded" || next === "failed" || next === "cancelled"));
}
