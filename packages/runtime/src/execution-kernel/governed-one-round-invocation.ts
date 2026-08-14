import { createHash } from "node:crypto";
import {
  advanceExecutionAttempt,
  createExecutionAttempt,
  dispatchOneModelRound,
  createExecutionAccountPolicyId,
  selectAdmittedExecutionAccount,
  validateModelTurn,
  type ExecutionAttemptPhase,
  type AdmittedExecutionRoute,
  type ExecutionAccountAdmissionCandidate,
  type ExecutionAccountCapacitySelectionResult,
  type ExecutionAccountAffinity,
  type OneRoundModelDispatcher,
  type ProviderModelRouteIdentity,
  type ModelTurn,
  type ModelTurnResult,
} from "@kilnai/core";
import type {
  AccountCapacityRecord,
  AccountCapacitySettlement,
  ExecutionAccountAffinityRequest,
  ExecutionAccountCandidateBinding,
  ExecutionAccountCapacityAuthority,
} from "./execution-account-capacity-authority.js";
import { ProviderDispatchTerminalError } from "./provider-dispatch-terminal-error.js";

export type GovernedOneRoundToolExecutionMode = "caller-owned" | "kiln-owned";
export interface GovernedOneRoundIdentity {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly sessionId: string;
  readonly turnId: string;
}
export interface GovernedOneRoundAuthorityEvidence {
  readonly status: "admitted" | "denied";
  readonly capabilityId: string;
  readonly scopes: readonly string[];
}
export interface GovernedOneRoundBudgetEvidence {
  readonly status: "admitted" | "denied";
  readonly evidenceId: string;
}
export type GovernedOneRoundAffinityPolicy =
  | { readonly continuity: "none" }
  | {
      readonly continuity: "prefer" | "require";
      readonly key: string;
      readonly allowRebind?: boolean;
    };
export interface GovernedOneRoundInvocationInput {
  readonly attemptId: string;
  readonly identity: GovernedOneRoundIdentity;
  readonly route: ProviderModelRouteIdentity & { readonly routeId: string };
  readonly authority: GovernedOneRoundAuthorityEvidence;
  readonly budget: GovernedOneRoundBudgetEvidence;
  readonly affinity: GovernedOneRoundAffinityPolicy;
  readonly toolExecutionMode: GovernedOneRoundToolExecutionMode;
  readonly turn: ModelTurn;
  readonly signal?: AbortSignal;
  readonly lifecycle?: {
    readonly afterCommittedBeforeDispatch: () => void | Promise<void>;
  };
}
export interface GovernedOneRoundCandidateCatalog {
  list(input: Pick<GovernedOneRoundInvocationInput, "identity" | "route" | "authority" | "budget">): Promise<{
    readonly admission: AdmittedExecutionRoute;
    readonly candidates: readonly GovernedOneRoundCandidate[];
  }>;
}
export interface GovernedOneRoundCandidate {
  readonly candidate: ExecutionAccountAdmissionCandidate;
  readonly lease: ExecutionAccountCandidateBinding;
}
export type GovernedOneRoundAttemptPhase = ExecutionAttemptPhase;
export interface GovernedOneRoundAttemptEvidence {
  readonly attemptId: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly route: ProviderModelRouteIdentity;
  readonly account: ExecutionAccountAffinity["account"];
  readonly phase: GovernedOneRoundAttemptPhase;
  readonly selectionReason: "existing-affinity" | "least-pressure" | "affinity-rebind";
  readonly authorityCapabilityId: string;
  readonly budgetEvidenceId: string;
  readonly settlement?: "settled" | "pending" | "failed";
}
export interface GovernedOneRoundAttemptEvidenceSink {
  record(evidence: GovernedOneRoundAttemptEvidence): Promise<void>;
}
export interface GovernedOneRoundDispatcherResolver {
  resolve(input: {
    readonly identity: GovernedOneRoundIdentity;
    readonly routeId: string;
    readonly accountId: string;
    readonly route: ProviderModelRouteIdentity;
    readonly lease: AccountCapacityRecord;
  }): Promise<OneRoundModelDispatcher>;
}
export interface GovernedOneRoundInvocationPorts {
  readonly candidateCatalog: GovernedOneRoundCandidateCatalog;
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  readonly attemptEvidence: GovernedOneRoundAttemptEvidenceSink;
  readonly dispatcherResolver: GovernedOneRoundDispatcherResolver;
}
export type GovernedOneRoundCloseoutDiagnosticCode = "terminal-evidence-failed" | "capacity-settlement-failed";
export interface GovernedOneRoundCloseoutDiagnostic {
  readonly code: GovernedOneRoundCloseoutDiagnosticCode;
  readonly phase: GovernedOneRoundAttemptPhase;
}
export interface GovernedOneRoundCloseout {
  readonly status: "complete" | "incomplete";
  readonly diagnostics: readonly GovernedOneRoundCloseoutDiagnostic[];
}
export interface GovernedOneRoundInvocationResult {
  readonly result: ModelTurnResult;
  readonly route: ProviderModelRouteIdentity;
  readonly account: ExecutionAccountAffinity["account"];
  readonly selection: ExecutionAccountCapacitySelectionResult;
  readonly affinity?: ExecutionAccountAffinity;
  readonly attempt: {
    readonly attemptId: string;
    readonly leaseId: string;
    readonly phases: readonly GovernedOneRoundAttemptPhase[];
  };
  readonly closeout: GovernedOneRoundCloseout;
}
export type GovernedOneRoundInvocationErrorCode =
  | "tool-execution-mode"
  | "authority-denied"
  | "budget-denied"
  | "invalid-input"
  | "affinity-required"
  | "no-eligible-account"
  | "lease-conflict"
  | "aborted";
export class GovernedOneRoundInvocationError extends Error {
  constructor(
    readonly code: GovernedOneRoundInvocationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GovernedOneRoundInvocationError";
  }
}
export class GovernedOneRoundCommittedError extends Error {
  readonly retryable = false;
  constructor(
    readonly cause: unknown,
    readonly diagnostics: readonly GovernedOneRoundCloseoutDiagnostic[],
    readonly attempt: {
      readonly attemptId: string;
      readonly leaseId: string;
      readonly phases: readonly GovernedOneRoundAttemptPhase[];
    },
  ) {
    super(cause instanceof Error ? cause.message : "Committed one-round invocation failed.", { cause });
    this.name = "GovernedOneRoundCommittedError";
  }
}

/** Provider material is resolved only after an authority-held capacity record exists. */
export async function invokeGovernedOneRound(
  input: GovernedOneRoundInvocationInput,
  ports: GovernedOneRoundInvocationPorts,
): Promise<GovernedOneRoundInvocationResult> {
  validateAdmission(input);
  const catalog = await ports.candidateCatalog.list({
    identity: input.identity,
    route: input.route,
    authority: input.authority,
    budget: input.budget,
  });
  const affinityRequest: ExecutionAccountAffinityRequest =
    input.affinity.continuity === "none"
      ? { continuity: "none" }
      : {
          continuity: input.affinity.continuity,
          scope: "session",
          key: affinityKey(input) as never,
          ...(input.affinity.allowRebind ? { allowRebind: true } : {}),
        };
  const runtimeInvocationId = input.attemptId;
  const candidateSelection = selectAdmittedExecutionAccount(
    catalog.admission,
    catalog.candidates.map(({ candidate }) => candidate),
  );
  if (candidateSelection.kind !== "selected")
    throw new GovernedOneRoundInvocationError(
      input.affinity.continuity === "require" ? "affinity-required" : "no-eligible-account",
      "No eligible account capacity is admitted for this one-round invocation.",
    );
  const selectedCandidate = catalog.candidates.find(({ candidate }) => candidate.accountId === candidateSelection.accountId);
  if (!selectedCandidate) throw new GovernedOneRoundInvocationError("no-eligible-account", "The selected execution account has no lease binding.");
  if (
    selectedCandidate.lease.candidate.route.providerId !== catalog.admission.providerId
    || selectedCandidate.lease.candidate.route.providerModelId !== catalog.admission.providerModelId
    || selectedCandidate.lease.candidate.route.scope !== input.route.scope
  ) throw new GovernedOneRoundInvocationError("invalid-input", "The selected execution account lease does not match the admitted route.");
  const acquired = ports.accountCapacityAuthority.acquireAccountCapacity({
    runtimeInvocationId,
    intentFingerprint: intentFingerprint(input, catalog.admission),
    accountPolicyId: executionAccountPolicyId(catalog.admission),
    route: input.route,
    // Core has selected exactly one eligible account. Passing only that
    // binding prevents capacity races from silently changing the route choice.
    candidates: [selectedCandidate.lease],
    affinityRequest,
  });
  if (acquired.status === "conflict")
    throw new GovernedOneRoundInvocationError(
      "lease-conflict",
      "The invocation capacity identity conflicts with a prior request.",
    );
  if (acquired.status === "unavailable")
    throw new GovernedOneRoundInvocationError(
      input.affinity.continuity === "require" ? "affinity-required" : "no-eligible-account",
      "No eligible account capacity is admitted for this one-round invocation.",
    );
  if (acquired.replay)
    throw new GovernedOneRoundInvocationError(
      "lease-conflict",
      "The invocation capacity record already exists and cannot be dispatched again.",
    );
  const capacity = acquired.record;
  const selected = {
    account: capacity.accountRef,
    route: capacity.route,
    reason: capacity.selectionReason,
  } as NonNullable<ExecutionAccountCapacitySelectionResult["selected"]>;
  const selection: ExecutionAccountCapacitySelectionResult = {
    selected,
    rejections: capacity.candidateRejections,
  };
  if (input.signal?.aborted) {
    ports.accountCapacityAuthority.releaseAccountCapacityPreFence(runtimeInvocationId);
    throw new GovernedOneRoundInvocationError("aborted", "The one-round invocation was aborted before dispatch.");
  }
  let attempt = createExecutionAttempt({
    attemptId: input.attemptId,
    account: capacity.accountRef,
  });
  const phases: GovernedOneRoundAttemptPhase[] = [];
  const diagnostics: GovernedOneRoundCloseoutDiagnostic[] = [];
  const record = async (terminal = false) => {
    phases.push(attempt.phase);
    try {
      await ports.attemptEvidence.record({
        attemptId: attempt.attemptId,
        tenantId: input.identity.tenantId,
        applicationId: input.identity.applicationId,
        callerId: input.identity.callerId,
        sessionId: input.identity.sessionId,
        turnId: input.identity.turnId,
        route: input.route,
        account: capacity.accountRef,
        phase: attempt.phase,
        selectionReason: capacity.selectionReason,
        authorityCapabilityId: input.authority.capabilityId,
        budgetEvidenceId: input.budget.evidenceId,
      });
    } catch (error) {
      if (terminal)
        diagnostics.push({
          code: "terminal-evidence-failed",
          phase: attempt.phase,
        });
      else throw error;
    }
  };
  try {
    await record();
    attempt = advanceExecutionAttempt(attempt, "leased");
    await record();
  } catch (error) {
    ports.accountCapacityAuthority.releaseAccountCapacityPreFence(runtimeInvocationId);
    throw error;
  }
  if (input.signal?.aborted) {
    attempt = advanceExecutionAttempt(attempt, "cancelled");
    await record(true);
    ports.accountCapacityAuthority.releaseAccountCapacityPreFence(runtimeInvocationId);
    throw new GovernedOneRoundInvocationError("aborted", "The one-round invocation was aborted before dispatch.");
  }
  attempt = advanceExecutionAttempt(attempt, "dispatching");
  try {
    await record();
  } catch (error) {
    ports.accountCapacityAuthority.releaseAccountCapacityPreFence(runtimeInvocationId);
    throw error;
  }
  const dispatchFenceId = `${input.attemptId}:dispatch`;
  attempt = advanceExecutionAttempt(attempt, "committed");
  // Committed evidence is observational; the lifecycle hook still has a pre-fence rollback path.
  await record(true);
  try {
    await input.lifecycle?.afterCommittedBeforeDispatch();
  } catch (error) {
    ports.accountCapacityAuthority.releaseAccountCapacityPreFence(runtimeInvocationId);
    throw new GovernedOneRoundCommittedError(error, Object.freeze(diagnostics), {
      attemptId: attempt.attemptId,
      leaseId: capacity.leaseId,
      phases: Object.freeze(phases),
    });
  }
  const dispatchLease = ports.accountCapacityAuthority.fenceAccountCapacityDispatch(runtimeInvocationId, dispatchFenceId);
  let result: ModelTurnResult | undefined;
  let failure: unknown;
  try {
    const dispatcher = await ports.dispatcherResolver.resolve({
      identity: input.identity,
      routeId: catalog.admission.routeId,
      accountId: candidateSelection.accountId,
      route: input.route,
      lease: dispatchLease,
    });
    result = await dispatchOneModelRound(dispatcher, {
      account: capacity.accountRef,
      route: input.route,
      sessionId: input.identity.sessionId,
      turn: input.turn,
      signal: input.signal,
    });
  } catch (error) {
    failure = error;
  }
  attempt = advanceExecutionAttempt(
    attempt,
    result === undefined ? (input.signal?.aborted ? "cancelled" : "failed") : "succeeded",
  );
  await record(true);
  let settlement: AccountCapacitySettlement;
  try {
    settlement =
      result === undefined
        ? failure instanceof ProviderDispatchTerminalError
          ? {
              kind: "completed",
              outcome: "provider-error",
              observedAt: failure.evidence.observedAt,
            }
          : // A transport exception after the durable fence is not evidence that no effect escaped.
            {
              kind: "unknown",
              reason: input.signal?.aborted
                ? "gateway-cancelled-after-dispatch-fence"
                : "gateway-provider-failure-after-dispatch-fence",
              observedAt: new Date().toISOString(),
            }
        : {
            kind: "completed",
            outcome: "success",
            observedAt: new Date().toISOString(),
          };
    ports.accountCapacityAuthority.settleAccountCapacity(runtimeInvocationId, dispatchFenceId, settlement);
  } catch {
    diagnostics.push({
      code: "capacity-settlement-failed",
      phase: attempt.phase,
    });
    try {
      await ports.attemptEvidence.record({
        attemptId: attempt.attemptId,
        tenantId: input.identity.tenantId,
        applicationId: input.identity.applicationId,
        callerId: input.identity.callerId,
        sessionId: input.identity.sessionId,
        turnId: input.identity.turnId,
        route: input.route,
        account: capacity.accountRef,
        phase: attempt.phase,
        selectionReason: capacity.selectionReason,
        authorityCapabilityId: input.authority.capabilityId,
        budgetEvidenceId: input.budget.evidenceId,
        settlement: "failed",
      });
    } catch {
      // A failed evidence sink cannot alter conservative capacity state.
    }
  }
  const attemptResult = {
    attemptId: attempt.attemptId,
    leaseId: capacity.leaseId,
    phases: Object.freeze(phases),
  };
  if (result === undefined)
    throw new GovernedOneRoundCommittedError(failure, Object.freeze(diagnostics), attemptResult);
  const affinity =
    input.affinity.continuity === "none" ? undefined : { account: capacity.accountRef, route: input.route };
  return {
    result,
    route: input.route,
    account: capacity.accountRef,
    selection,
    ...(affinity ? { affinity } : {}),
    attempt: attemptResult,
    closeout: {
      status: diagnostics.length ? "incomplete" : "complete",
      diagnostics: Object.freeze(diagnostics),
    },
  };
}

function intentFingerprint(input: GovernedOneRoundInvocationInput, admission: AdmittedExecutionRoute): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        attemptId: input.attemptId,
        identity: input.identity,
        route: input.route,
        admission,
        turn: input.turn,
      }),
    )
    .digest("hex")}`;
}
function affinityKey(input: GovernedOneRoundInvocationInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        identity: input.identity,
        route: input.route,
        key: input.affinity.continuity === "none" ? "" : input.affinity.key,
      }),
    )
    .digest("hex");
}
function validateAdmission(input: GovernedOneRoundInvocationInput): void {
  if (input.toolExecutionMode !== "caller-owned")
    throw new GovernedOneRoundInvocationError("tool-execution-mode", "This boundary admits caller-owned tools only.");
  if (input.authority.status !== "admitted")
    throw new GovernedOneRoundInvocationError("authority-denied", "The invocation authority was not admitted.");
  if (input.budget.status !== "admitted")
    throw new GovernedOneRoundInvocationError("budget-denied", "The invocation budget was not admitted.");
  for (const [name, value] of Object.entries({
    attemptId: input.attemptId,
    ...input.identity,
    capabilityId: input.authority.capabilityId,
    budgetEvidenceId: input.budget.evidenceId,
    providerId: input.route.providerId,
    providerModelId: input.route.providerModelId,
    routeScope: input.route.scope,
    ...(input.affinity.continuity === "none" ? {} : { affinityKey: input.affinity.key }),
  }))
    if (typeof value !== "string" || !value.trim() || value !== value.trim())
      throw new GovernedOneRoundInvocationError("invalid-input", `${name} must be a non-empty canonical string.`);
  try {
    validateModelTurn(input.turn);
  } catch (error) {
    throw new GovernedOneRoundInvocationError(
      "invalid-input",
      error instanceof Error ? error.message : "Model turn is invalid.",
    );
  }
}

function executionAccountPolicyId(admission: AdmittedExecutionRoute) {
  return createExecutionAccountPolicyId(
    admission.accountSelection.mode === "automatic"
      ? admission.accountSelection.accountPolicyId
      : `execution-route:${admission.routeId}`,
  );
}
