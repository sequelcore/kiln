import { createHash } from "node:crypto";
import {
  advanceExecutionAttempt,
  createExecutionAttempt,
  createExecutionAccountPolicyId,
  selectAdmittedExecutionAccount,
  validateModelTurn,
  validateModelTurnResult,
  type ExecutionAttemptPhase,
  type AdmittedExecutionTarget,
  type ExecutionAccountAdmissionCandidate,
  type ExecutionAccountCapacitySelectionResult,
  type ExecutionAccountAffinity,
  type OneRoundModelDispatcher,
  type ProviderModelRouteIdentity,
  type ModelTurn,
  type ModelTurnResult,
  type ExecutionSessionBindingEvidence,
  type SessionTurnBudgetDecision,
} from "@kilnai/core";
import type { GovernedOneRoundDispatchPermit } from "./dispatch-permit.js";
import type {
  AccountCapacityRecord,
  AccountCapacitySettlement,
  ExecutionAccountAffinityRequest,
  ExecutionAccountCandidateBinding,
  ExecutionAccountCapacityAuthority,
} from "./execution-account-capacity-authority.js";
import { ProviderDispatchTerminalError } from "./provider-dispatch-terminal-error.js";
import type {
  EffectiveAuthorityAdmissionBundle,
  TurnBudgetAdmission,
} from "../session/effective-authority-admission-bundle.js";
import { assertPersistableAuthorityAdmissionBundle } from "../session/authority-admission-evidence.js";

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
}
export interface GovernedOneRoundCandidateCatalog {
  list(input: Pick<GovernedOneRoundInvocationInput, "identity" | "route" | "authority"> & {
    readonly budget: TurnBudgetAdmission;
  }): Promise<{
    readonly admission: AdmittedExecutionTarget;
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
    /** Core-admitted selection target resolved before binding. */
    readonly targetId: string;
    /** Concrete provider-route identity retained for the post-admission binding. */
    readonly routeId: string;
    readonly accountId: string;
    readonly route: ProviderModelRouteIdentity;
    readonly lease: AccountCapacityRecord;
  }): Promise<GovernedOneRoundResolvedDispatch>;
}
export interface GovernedOneRoundResolvedDispatch {
  /** Provider adapter prepared from the exact credential binding before the action claim. */
  readonly dispatcher: OneRoundModelDispatcher;
  /** Exact secret-free identity observed by the resolver. */
  readonly binding: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
}
export interface GovernedOneRoundBudgetAdmissionPort {
  /** Reads live session usage before any candidate or capacity decision. */
  admit(input: {
    readonly identity: GovernedOneRoundIdentity;
    readonly route: ProviderModelRouteIdentity & { readonly routeId: string };
  }): Promise<TurnBudgetAdmission | Extract<SessionTurnBudgetDecision, { readonly status: "denied" }>>;
}
export interface GovernedOneRoundAuthorityAdmissionPort {
  /** Composes the one immutable, secret-free bundle from owner decisions. */
  compose(input: {
    readonly invocation: GovernedOneRoundInvocationInput;
    readonly admission: AdmittedExecutionTarget;
    readonly budget: TurnBudgetAdmission;
    readonly binding: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
    readonly lease: AccountCapacityRecord;
  }): Promise<EffectiveAuthorityAdmissionBundle>;
}
export interface GovernedOneRoundInvocationPorts {
  readonly candidateCatalog: GovernedOneRoundCandidateCatalog;
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  readonly attemptEvidence: GovernedOneRoundAttemptEvidenceSink;
  readonly dispatcherResolver: GovernedOneRoundDispatcherResolver;
  readonly budgetAdmission: GovernedOneRoundBudgetAdmissionPort;
  readonly authorityAdmission: GovernedOneRoundAuthorityAdmissionPort;
  readonly admissionEvidence: GovernedOneRoundAdmissionEvidencePort;
  readonly dispatchClaim: GovernedOneRoundDispatchClaimPort;
}
export interface GovernedOneRoundAdmissionReceipt {
  readonly attemptId: string;
  readonly admissionId: `sha256:${string}`;
  readonly bundle: EffectiveAuthorityAdmissionBundle;
}
export interface GovernedOneRoundAdmissionEvidencePort {
  persistAndReadback(bundle: EffectiveAuthorityAdmissionBundle): GovernedOneRoundAdmissionReceipt | Promise<GovernedOneRoundAdmissionReceipt>;
}
export interface GovernedOneRoundDispatchClaimPort {
  claim(input: { readonly admissionId: `sha256:${string}`; readonly effectIdentity: string }): GovernedOneRoundDispatchPermit;
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

/** Runtime model-execution sequencing for one named, exactly-once provider effect. */
export async function invokeGovernedOneRound(
  input: GovernedOneRoundInvocationInput,
  ports: GovernedOneRoundInvocationPorts,
): Promise<GovernedOneRoundInvocationResult> {
  validateAdmission(input);
  const budget = await ports.budgetAdmission.admit({
    identity: input.identity,
    route: input.route,
  });
  if (budget.status !== "admitted") {
    throw new GovernedOneRoundInvocationError(
      "budget-denied",
      "The live session turn budget did not admit this invocation.",
    );
  }
  const catalog = await ports.candidateCatalog.list({
    identity: input.identity,
    route: input.route,
    authority: input.authority,
    budget,
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
  ) throw new GovernedOneRoundInvocationError("invalid-input", "The selected execution account lease does not match the admitted target.");
  const acquired = ports.accountCapacityAuthority.acquireAccountCapacity({
    runtimeInvocationId,
    intentFingerprint: intentFingerprint(input, catalog.admission),
    accountPolicyId: executionAccountPolicyId(catalog.admission),
    route: input.route,
    // Core has selected exactly one eligible account. Passing only that
    // binding prevents capacity races from silently changing the target choice.
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
  const dispatchFenceId = `${input.attemptId}:capacity`;
  let dispatchLease: AccountCapacityRecord | undefined;
  let resolved: GovernedOneRoundResolvedDispatch;
  let bundle: EffectiveAuthorityAdmissionBundle;
  let admission: GovernedOneRoundAdmissionReceipt;
  let dispatchPermit: GovernedOneRoundDispatchPermit;
  let dispatchInput: Parameters<NonNullable<GovernedOneRoundResolvedDispatch["dispatcher"]["dispatchOneRound"]>>[0];
  try {
    if (input.signal?.aborted) throw new GovernedOneRoundInvocationError("aborted", "The one-round invocation was aborted before dispatch.");
    resolved = await ports.dispatcherResolver.resolve({
      identity: input.identity,
      targetId: catalog.admission.targetId,
      // routeId is retained here because the resolver creates the concrete
      // post-admission session binding; targetId remains on the Core admission.
      routeId: input.route.routeId,
      accountId: candidateSelection.accountId,
      route: input.route,
      lease: capacity,
    });
    if (resolved.binding.status !== "bound"
      || resolved.binding.routeId !== input.route.routeId
      || resolved.binding.accountId !== candidateSelection.accountId
      || resolved.binding.credentialRevision !== capacity.credentialRevisionId) {
      throw new GovernedOneRoundInvocationError("invalid-input", "The credential binding does not match the admitted capacity lease.");
    }
    bundle = await ports.authorityAdmission.compose({
      invocation: input,
      admission: catalog.admission,
      budget,
      binding: resolved.binding,
      lease: capacity,
    });
    const composedBundle = assertPersistableAuthorityAdmissionBundle(bundle);
    admission = await ports.admissionEvidence.persistAndReadback(composedBundle);
    const readbackBundle = assertPersistableAuthorityAdmissionBundle(admission.bundle);
    if (admission.attemptId !== input.attemptId || admission.admissionId !== composedBundle.admissionId || readbackBundle.admissionId !== composedBundle.admissionId) {
      throw new GovernedOneRoundInvocationError("invalid-input", "Persisted authority admission readback does not match the workload attempt.");
    }
    dispatchInput = {
      account: capacity.accountRef,
      route: input.route,
      sessionId: input.identity.sessionId,
      turn: input.turn,
      signal: input.signal,
    };
    // Shared-capacity fencing is a recoverable resource transition, not the
    // protected action fence. Complete it first so the action claim remains the
    // final fallible authority transition before the provider call.
    if (input.signal?.aborted) throw new GovernedOneRoundInvocationError("aborted", "The one-round invocation was aborted before the capacity fence.");
    dispatchLease = ports.accountCapacityAuthority.fenceAccountCapacityDispatch(runtimeInvocationId, dispatchFenceId);
    if (input.signal?.aborted) throw new GovernedOneRoundInvocationError("aborted", "The one-round invocation was aborted before the action claim.");
    const effectIdentity = modelEffectIdentity(input, capacity, admission.admissionId);
    dispatchPermit = ports.dispatchClaim.claim({ admissionId: admission.admissionId, effectIdentity });
  } catch (error) {
    attempt = advanceExecutionAttempt(attempt, error instanceof GovernedOneRoundInvocationError && error.code === "aborted" ? "cancelled" : "failed");
    await record(true);
    if (dispatchLease !== undefined) {
      try {
        ports.accountCapacityAuthority.settleAccountCapacity(runtimeInvocationId, dispatchFenceId, {
          kind: "completed",
          outcome: "cancelled",
          observedAt: new Date().toISOString(),
        });
      } catch {
        diagnostics.push({ code: "capacity-settlement-failed", phase: attempt.phase });
      }
    } else {
      ports.accountCapacityAuthority.releaseAccountCapacityPreFence(runtimeInvocationId);
    }
    throw error;
  }
  attempt = advanceExecutionAttempt(attempt, "committed");
  let result: ModelTurnResult | undefined;
  let failure: unknown;
  try {
    // The permit is opaque and consumed exactly once. Keep this synchronous
    // handoff adjacent to the sole adapter call: no evidence, authority hook,
    // fallback, or second cancellation gate can run between the fence and it.
    dispatchPermit.consume();
    result = await resolved.dispatcher.dispatchOneRound(dispatchInput);
    validateModelTurnResult(result);
  } catch (error) {
    failure = error;
  }
  // Committed evidence is observational; the authority bundle and action claim
  // were durably committed before this point. It must not delay the adapter.
  await record(true);
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

function intentFingerprint(input: GovernedOneRoundInvocationInput, admission: AdmittedExecutionTarget): `sha256:${string}` {
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

function modelEffectIdentity(
  input: GovernedOneRoundInvocationInput,
  lease: AccountCapacityRecord,
  admissionId: `sha256:${string}`,
): string {
  return `model-round:sha256:${createHash("sha256")
    .update(JSON.stringify({
      attemptId: input.attemptId,
      admissionId,
      route: input.route,
      accountId: lease.accountRef,
      credentialRevision: lease.credentialRevisionId,
    }))
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

function executionAccountPolicyId(admission: AdmittedExecutionTarget) {
  return createExecutionAccountPolicyId(admission.accountSelection.accountPolicyId);
}
