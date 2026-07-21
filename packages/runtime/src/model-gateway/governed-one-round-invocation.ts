import {
  advanceAttemptCommit,
  createAttemptCommit,
  dispatchModelGatewayOneRound,
  selectModelGatewayAccount,
  validateModelTurn,
  type AttemptCommitPhase,
  type ModelGatewayAccountCandidate,
  type ModelGatewayAccountSelectionResult,
  type ModelGatewayAffinity,
  type ModelGatewayOneRoundDispatcher,
  type ModelGatewayRoute,
  type ModelTurn,
  type ModelTurnResult,
} from "@kilnai/core";

export type GovernedOneRoundToolExecutionMode = "caller-owned" | "kiln-owned";

export interface GovernedOneRoundIdentity {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly sessionId: string;
  readonly turnId: string;
}

/** Evidence is admitted before this boundary; it is not inferred from model output. */
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
  | { readonly continuity: "prefer" | "require"; readonly key: string; readonly allowRebind?: boolean };

export interface GovernedOneRoundInvocationInput {
  /** Caller-owned stable identity for this invocation/replay attempt. */
  readonly attemptId: string;
  readonly identity: GovernedOneRoundIdentity;
  readonly route: ModelGatewayRoute;
  readonly authority: GovernedOneRoundAuthorityEvidence;
  readonly budget: GovernedOneRoundBudgetEvidence;
  readonly affinity: GovernedOneRoundAffinityPolicy;
  readonly toolExecutionMode: GovernedOneRoundToolExecutionMode;
  readonly turn: ModelTurn;
  readonly signal?: AbortSignal;
  /** Called after committed evidence and immediately before the sole provider dispatch. */
  readonly lifecycle?: { readonly afterCommittedBeforeDispatch: () => void | Promise<void> };
}

export interface GovernedOneRoundCandidateCatalog {
  list(input: Pick<GovernedOneRoundInvocationInput, "identity" | "route" | "authority" | "budget">): Promise<readonly ModelGatewayAccountCandidate[]>;
}

export interface GovernedOneRoundAffinityStore {
  read(input: { readonly identity: GovernedOneRoundIdentity; readonly route: ModelGatewayRoute; readonly key: string }): Promise<ModelGatewayAffinity | undefined>;
  write(input: { readonly identity: GovernedOneRoundIdentity; readonly route: ModelGatewayRoute; readonly key: string; readonly affinity: ModelGatewayAffinity }): Promise<void>;
}

export interface GovernedOneRoundAccountLease {
  acquire(input: { readonly identity: GovernedOneRoundIdentity; readonly route: ModelGatewayRoute; readonly account: ModelGatewayAffinity["account"] }): Promise<{ readonly leaseId: string } | undefined>;
  release(input: { readonly leaseId: string }): Promise<void>;
}

export type GovernedOneRoundAttemptPhase = AttemptCommitPhase;

/** Portable event evidence. It deliberately excludes secrets, prompts, and headers. */
export interface GovernedOneRoundAttemptEvidence {
  readonly attemptId: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly route: ModelGatewayRoute;
  readonly account: ModelGatewayAffinity["account"];
  readonly phase: GovernedOneRoundAttemptPhase;
  readonly selectionReason: "existing-affinity" | "least-pressure" | "affinity-rebind";
  readonly authorityCapabilityId: string;
  readonly budgetEvidenceId: string;
}

export interface GovernedOneRoundAttemptEvidenceSink {
  record(evidence: GovernedOneRoundAttemptEvidence): Promise<void>;
}

export interface GovernedOneRoundDispatcherResolver {
  resolve(input: { readonly identity: GovernedOneRoundIdentity; readonly route: ModelGatewayRoute; readonly account: ModelGatewayAffinity["account"]; readonly leaseId: string }): Promise<ModelGatewayOneRoundDispatcher>;
}

export interface GovernedOneRoundInvocationPorts {
  readonly candidateCatalog: GovernedOneRoundCandidateCatalog;
  readonly affinityStore: GovernedOneRoundAffinityStore;
  readonly accountLease: GovernedOneRoundAccountLease;
  readonly attemptEvidence: GovernedOneRoundAttemptEvidenceSink;
  readonly dispatcherResolver: GovernedOneRoundDispatcherResolver;
}

export type GovernedOneRoundCloseoutDiagnosticCode =
  | "affinity-write-failed"
  | "terminal-evidence-failed"
  | "lease-release-failed";

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
  readonly route: ModelGatewayRoute;
  readonly account: ModelGatewayAffinity["account"];
  readonly selection: ModelGatewayAccountSelectionResult;
  readonly affinity?: ModelGatewayAffinity;
  readonly attempt: { readonly attemptId: string; readonly leaseId: string; readonly phases: readonly GovernedOneRoundAttemptPhase[] };
  readonly closeout: GovernedOneRoundCloseout;
}

export type GovernedOneRoundInvocationErrorCode = "tool-execution-mode" | "authority-denied" | "budget-denied" | "invalid-input" | "affinity-required" | "no-eligible-account" | "lease-conflict" | "aborted";

export class GovernedOneRoundInvocationError extends Error {
  constructor(readonly code: GovernedOneRoundInvocationErrorCode, message: string) {
    super(message);
    this.name = "GovernedOneRoundInvocationError";
  }
}

/** A provider error after conservative commit. It must never be auto-retried. */
export class GovernedOneRoundCommittedError extends Error {
  readonly retryable = false;

  constructor(
    readonly cause: unknown,
    readonly diagnostics: readonly GovernedOneRoundCloseoutDiagnostic[],
    readonly attempt: { readonly attemptId: string; readonly leaseId: string; readonly phases: readonly GovernedOneRoundAttemptPhase[] },
  ) {
    super(cause instanceof Error ? cause.message : "Committed one-round invocation failed.", { cause });
    this.name = "GovernedOneRoundCommittedError";
  }
}

/**
 * Runtime application boundary for a caller-owned, single provider round.
 * It intentionally has neither a ToolExecutor port nor a retry path.
 */
export async function invokeGovernedOneRound(
  input: GovernedOneRoundInvocationInput,
  ports: GovernedOneRoundInvocationPorts,
): Promise<GovernedOneRoundInvocationResult> {
  validateAdmission(input);
  const candidates = await ports.candidateCatalog.list({
    identity: input.identity,
    route: input.route,
    authority: input.authority,
    budget: input.budget,
  });
  const storedAffinity = input.affinity.continuity === "none"
    ? undefined
    : await ports.affinityStore.read({ identity: input.identity, route: input.route, key: input.affinity.key });
  if (input.affinity.continuity === "require" && storedAffinity === undefined) {
    throw new GovernedOneRoundInvocationError("affinity-required", "A required route affinity is unavailable.");
  }

  const selection = selectModelGatewayAccount({
    route: input.route,
    work: storedAffinity === undefined ? "new" : "existing",
    ...(storedAffinity === undefined ? {} : {
      affinity: storedAffinity,
      allowAffinityRebind: input.affinity.continuity !== "none" && input.affinity.allowRebind === true,
    }),
    candidates,
  });
  const selected = selection.selected;
  if (selected === undefined) {
    throw new GovernedOneRoundInvocationError("no-eligible-account", "No eligible account is admitted for this one-round invocation.");
  }

  let attempt = createAttemptCommit({ attemptId: input.attemptId, account: selected.account });
  const phases: GovernedOneRoundAttemptPhase[] = [];
  const diagnostics: GovernedOneRoundCloseoutDiagnostic[] = [];
  const record = async (): Promise<void> => {
    phases.push(attempt.phase);
    await ports.attemptEvidence.record({
      attemptId: attempt.attemptId,
      tenantId: input.identity.tenantId,
      applicationId: input.identity.applicationId,
      callerId: input.identity.callerId,
      sessionId: input.identity.sessionId,
      turnId: input.identity.turnId,
      route: input.route,
      account: selected.account,
      phase: attempt.phase,
      selectionReason: selected.reason,
      authorityCapabilityId: input.authority.capabilityId,
      budgetEvidenceId: input.budget.evidenceId,
    });
  };
  const recordTerminal = async (): Promise<void> => {
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
        account: selected.account,
        phase: attempt.phase,
        selectionReason: selected.reason,
        authorityCapabilityId: input.authority.capabilityId,
        budgetEvidenceId: input.budget.evidenceId,
      });
    } catch {
      diagnostics.push({ code: "terminal-evidence-failed", phase: attempt.phase });
    }
  };

  await record();
  const lease = await ports.accountLease.acquire({ identity: input.identity, route: input.route, account: selected.account });
  if (lease === undefined) {
    throw new GovernedOneRoundInvocationError("lease-conflict", "The selected account lease is unavailable.");
  }

  let result: ModelTurnResult | undefined;
  let primaryError: unknown;
  let effectsMayHaveEscaped = false;
  try {
    attempt = advanceAttemptCommit(attempt, "leased");
    await record();
    if (input.signal?.aborted) {
      attempt = advanceAttemptCommit(attempt, "cancelled");
      await recordTerminal();
      primaryError = new GovernedOneRoundInvocationError("aborted", "The one-round invocation was aborted before dispatch.");
    } else {
      let dispatcher: ModelGatewayOneRoundDispatcher | undefined;
      try {
        dispatcher = await ports.dispatcherResolver.resolve({ identity: input.identity, route: input.route, account: selected.account, leaseId: lease.leaseId });
      } catch (error) {
        attempt = advanceAttemptCommit(attempt, "failed");
        await recordTerminal();
        primaryError = error;
      }

      if (dispatcher !== undefined) {
        attempt = advanceAttemptCommit(attempt, "dispatching");
        await record();
        attempt = advanceAttemptCommit(attempt, "committed");
        await record();
        effectsMayHaveEscaped = true;
        try {
          await input.lifecycle?.afterCommittedBeforeDispatch();
          result = await dispatchModelGatewayOneRound(dispatcher, {
            account: selected.account,
            route: input.route,
            sessionId: input.identity.sessionId,
            turn: input.turn,
            signal: input.signal,
          });
        } catch (error) {
          primaryError = error;
        }

        if (result !== undefined) {
          if (input.affinity.continuity !== "none") {
            try {
              await ports.affinityStore.write({
                identity: input.identity,
                route: input.route,
                key: input.affinity.key,
                affinity: { account: selected.account, route: input.route },
              });
            } catch {
              diagnostics.push({ code: "affinity-write-failed", phase: attempt.phase });
            }
          }
          attempt = advanceAttemptCommit(attempt, "succeeded");
          await recordTerminal();
        } else {
          attempt = advanceAttemptCommit(attempt, input.signal?.aborted ? "cancelled" : "failed");
          await recordTerminal();
        }
      }
    }
  } catch (error) {
    primaryError = primaryError ?? error;
  }

  try {
    await ports.accountLease.release({ leaseId: lease.leaseId });
  } catch {
    diagnostics.push({ code: "lease-release-failed", phase: attempt.phase });
  }

  const attemptResult = { attemptId: attempt.attemptId, leaseId: lease.leaseId, phases: Object.freeze([...phases]) };
  if (result !== undefined) {
    const affinity = input.affinity.continuity === "none"
      ? undefined
      : { account: selected.account, route: input.route };
    return {
      result,
      route: input.route,
      account: selected.account,
      selection,
      ...(affinity === undefined ? {} : { affinity }),
      attempt: attemptResult,
      closeout: { status: diagnostics.length === 0 ? "complete" : "incomplete", diagnostics: Object.freeze([...diagnostics]) },
    };
  }
  if (effectsMayHaveEscaped) {
    throw new GovernedOneRoundCommittedError(primaryError, Object.freeze([...diagnostics]), attemptResult);
  }
  throw primaryError;
}

function validateAdmission(input: GovernedOneRoundInvocationInput): void {
  if (input.toolExecutionMode !== "caller-owned") {
    throw new GovernedOneRoundInvocationError("tool-execution-mode", "This boundary admits caller-owned tools only.");
  }
  if (input.authority.status !== "admitted") {
    throw new GovernedOneRoundInvocationError("authority-denied", "The invocation authority was not admitted.");
  }
  if (input.budget.status !== "admitted") {
    throw new GovernedOneRoundInvocationError("budget-denied", "The invocation budget was not admitted.");
  }
  const required = {
    attemptId: input.attemptId,
    tenantId: input.identity.tenantId,
    applicationId: input.identity.applicationId,
    callerId: input.identity.callerId,
    sessionId: input.identity.sessionId,
    turnId: input.identity.turnId,
    capabilityId: input.authority.capabilityId,
    budgetEvidenceId: input.budget.evidenceId,
    providerId: input.route.providerId,
    providerModelId: input.route.providerModelId,
    routeScope: input.route.scope,
    ...(input.affinity.continuity === "none" ? {} : { affinityKey: input.affinity.key }),
  };
  for (const [name, value] of Object.entries(required)) {
    if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
      throw new GovernedOneRoundInvocationError("invalid-input", `${name} must be a non-empty canonical string.`);
    }
  }
  try {
    validateModelTurn(input.turn);
  } catch (error) {
    throw new GovernedOneRoundInvocationError(
      "invalid-input",
      error instanceof Error ? error.message : "Model turn is invalid.",
    );
  }
}
