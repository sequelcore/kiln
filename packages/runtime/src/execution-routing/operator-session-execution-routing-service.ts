import {
  admitOperatorExecutionIntent,
  createExecutionAccountPolicyId,
  selectAdmittedExecutionAccount,
  type AdmittedExecutionRoute,
  type ExecutionAccountAdmissionCandidate,
  type ExecutionCatalog,
  type ExecutionSessionBindingEvidence,
  type OperatorExecutionIntent,
} from "@kilnai/core";
import type {
  AccountCapacityRecord,
  ExecutionAccountCandidateBinding,
} from "../execution-kernel/execution-account-capacity-authority.js";
import type { SqliteManagedAccountLeaseAuthorityOptions } from "../managed-account-leases/managed-account-lease-authority.js";
import { SqliteManagedAccountLeaseAuthority } from "../managed-account-leases/managed-account-lease-authority.js";
import type { ExecutionAccountCapacityAuthority } from "../execution-kernel/execution-account-capacity-authority.js";
import {
  normalizeRuntimeConfigurationRevision,
  type RuntimeConfigurationRevisionSnapshot,
} from "../session/runtime-configuration-revision-pin.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundleInput,
  type EconomicCommitmentReference,
  type TurnBudgetAdmission,
} from "../session/effective-authority-admission-bundle.js";
import { evaluateExecutionTargetDataPolicy, type SanitizedExecutionRouteDataPolicyDecision } from "./execution-route-data-policy-authority.js";

/** Candidate evidence is prepared without resolving credential material or constructing a provider adapter. */
export interface OperatorSessionExecutionCandidate {
  readonly candidate: ExecutionAccountAdmissionCandidate;
  readonly lease: ExecutionAccountCandidateBinding;
}

export interface OperatorSessionExecutionCandidatePort {
  resolve(input: {
    readonly admission: AdmittedExecutionRoute;
    /** The exact catalog activated for this admission. */
    readonly catalog: ExecutionCatalog;
    /** Secret-free configuration evidence captured with the catalog. */
    readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
  }): Promise<readonly OperatorSessionExecutionCandidate[]>;
}

export interface OperatorSessionCredentialPort<Credential> {
  /** Called only after the durable account-capacity dispatch fence succeeds. */
  resolve(input: {
    readonly routeId: string;
    readonly accountId: string;
    readonly credentialId: string;
    readonly lease: AccountCapacityRecord;
    /** The exact catalog and revision activated for this admission. */
    readonly catalog: ExecutionCatalog;
    readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
  }): Promise<OperatorSessionResolvedCredential<Credential>>;
}

/** Credential material plus the secret-free identity observed during post-fence resolution. */
export interface OperatorSessionResolvedCredential<Credential> {
  readonly credential: Credential;
  readonly credentialId: string;
  readonly credentialRevisionId: string;
}

/**
 * One immutable routing snapshot.  The source owns the effective catalog;
 * Runtime owns the lifetime and prevents a second activation from interleaving
 * with the first execution's candidate, capacity, or credential admission.
 */
export interface OperatorSessionExecutionCatalogSnapshot {
  readonly catalog: ExecutionCatalog;
  readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
}

/**
 * Runtime's narrow source boundary for effective execution configuration.
 * Implementations must return a Core-defined (immutable) catalog and may
 * switch their candidate/credential owner to the supplied exact snapshot.
 */
export interface OperatorSessionExecutionCatalogSource {
  capture(): OperatorSessionExecutionCatalogSnapshot | Promise<OperatorSessionExecutionCatalogSnapshot>;
  activate(snapshot: OperatorSessionExecutionCatalogSnapshot): void | Promise<void>;
}

/** Authority facets are supplied by the Runtime composition owner; execution identity is added only after fencing. */
export interface OperatorSessionAuthorityAdmissionFacets {
  readonly sessionId: string;
  /** Canonical Runtime turn identity reserved by the session/adoption owner. */
  readonly turnId: string;
  readonly sessionRevision: RuntimeConfigurationRevisionSnapshot;
  readonly session: EffectiveAuthorityAdmissionBundleInput["session"];
  readonly turn: Omit<EffectiveAuthorityAdmissionBundleInput["turn"], "execution" | "budget">;
  readonly economicCommitment?: EconomicCommitmentReference;
}

export interface OperatorSessionAuthorityAdmissionPort<Payload = unknown> {
  preflight(input: {
    readonly request: OperatorSessionExecutionRequest<Payload>;
  }): TurnBudgetAdmission | Promise<TurnBudgetAdmission>;
  prepare(input: {
    readonly request: OperatorSessionExecutionRequest<Payload>;
    readonly admission: AdmittedExecutionRoute;
    readonly snapshot: OperatorSessionExecutionCatalogSnapshot;
    readonly binding: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
    readonly dataPolicy: SanitizedExecutionRouteDataPolicyDecision;
  }): OperatorSessionAuthorityAdmissionFacets | Promise<OperatorSessionAuthorityAdmissionFacets>;
  persist(bundle: EffectiveAuthorityAdmissionBundle): void | Promise<void>;
  /** Releases any pre-dispatch authority reservation after admission fails. */
  abort(executionId: string): void | Promise<void>;
}

export interface OperatorSessionExecutionRoutingServiceOptions<Credential, Payload, Result> {
  readonly catalogSource: OperatorSessionExecutionCatalogSource;
  readonly candidates: OperatorSessionExecutionCandidatePort;
  /** Must be a SqliteManagedAccountLeaseAuthority configured with participantKind: operator-session. */
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  readonly credentials: OperatorSessionCredentialPort<Credential>;
  /** Sole Runtime authority-admission composition port; required for every committed turn. */
  readonly authorityAdmission: OperatorSessionAuthorityAdmissionPort<Payload>;
  /** Adapter construction and the existing session/orchestrator pipeline are composition-owned. */
  readonly dispatch: OperatorSessionExecutionDispatch<Credential, Payload, Result>;
  /** Reads the direct-provider workload outcome from the committed bridge result. */
  readonly readDispatchOutcome?: (result: Result) => "completed" | "unknown";
  readonly now?: () => Date;
}

/**
 * The only value that can cross the routing boundary into the operator
 * session pipeline.  The symbol is deliberately module-private: callers can
 * consume a committed execution, but cannot manufacture one for a gateway.
 */
const operatorSessionCommitmentBrand: unique symbol = Symbol("operator-session-commitment");

export interface OperatorSessionCommittedExecution<Credential, Payload> {
  readonly [operatorSessionCommitmentBrand]: typeof operatorSessionCommitmentBrand;
  /** Routing reservation identity; distinct from the canonical Runtime turn when adoption owns that identity. */
  readonly executionId: string;
  readonly intentFingerprint: string;
  readonly admission: AdmittedExecutionRoute;
  readonly accountId: string;
  readonly lease: AccountCapacityRecord;
  readonly credential: Credential;
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle;
  readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
  readonly binding: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
  readonly payload: Payload;
}

export interface OperatorSessionExecutionDispatch<Credential, Payload, Result> {
  dispatchCommittedTurn(
    input: OperatorSessionCommittedExecution<Credential, Payload>,
  ): Promise<Result>;
}

export interface OperatorSessionExecutionRequest<Payload> {
  readonly executionId: string;
  readonly intentFingerprint: string;
  readonly intent: OperatorExecutionIntent;
  readonly payload: Payload;
}

export interface OperatorSessionExecutionResult<Result> {
  readonly admission: AdmittedExecutionRoute;
  readonly accountId: string;
  readonly leaseId: string;
  readonly evidence: OperatorSessionCommittedExecutionEvidence;
  readonly result: Result;
}

/** Secret-free, route-based evidence intended for the common execution event stream. */
export interface OperatorSessionCommittedExecutionEvidence {
  readonly routeId: string;
  readonly accountId: string;
  readonly credentialId: string;
  readonly credentialRevision: string;
  readonly capacityIdentity: string;
  readonly leaseId: string;
  readonly dispatchFenceId: string;
  readonly status: "completed" | "unknown";
}

export class OperatorSessionExecutionRoutingError extends Error {
  override name = "OperatorSessionExecutionRoutingError";
}

/** Known cancellation before the committed bridge begins provider/effect dispatch. */
export class OperatorSessionPreDispatchCancellationError extends Error {
  override readonly name = "OperatorSessionPreDispatchCancellationError";
}

/** Known fail-closed rejection before a provider adapter or tool effect can start. */
export class OperatorSessionPreProviderLaunchRejectionError extends Error {
  override readonly name = "OperatorSessionPreProviderLaunchRejectionError";
}

/**
 * Applies the Core execution-routing contract to one operator turn and commits
 * shared SQLite capacity before any provider adapter or credential is materialized.
 */
export class OperatorSessionExecutionRoutingService<Credential = unknown, Payload = unknown, Result = unknown> {
  readonly #options: OperatorSessionExecutionRoutingServiceOptions<Credential, Payload, Result>;
  readonly #admissionMutex = new AsyncAdmissionMutex();

  constructor(options: OperatorSessionExecutionRoutingServiceOptions<Credential, Payload, Result>) {
    this.#options = options;
  }

  async execute(request: OperatorSessionExecutionRequest<Payload>): Promise<OperatorSessionExecutionResult<Result>> {
    const releaseAdmission = await this.#admissionMutex.acquire();
    let admissionReleased = false;
    const releaseAdmissionOnce = (): void => {
      if (admissionReleased) return;
      admissionReleased = true;
      releaseAdmission();
    };

    let admission: AdmittedExecutionRoute;
    let snapshot: OperatorSessionExecutionCatalogSnapshot;
    let account: ExecutionCatalog["accounts"][number];
    let fenceId: string;
    let fenced: AccountCapacityRecord;
    let budgetAdmission: TurnBudgetAdmission;
    let capacityAcquired = false;
    try {
      budgetAdmission = await this.#options.authorityAdmission.preflight({ request });
      snapshot = await this.#captureAndNormalizeSnapshot();
      await this.#options.catalogSource.activate(snapshot);
      admission = admitOperatorExecutionIntent(snapshot.catalog, request.intent);
      const candidates = await this.#options.candidates.resolve({
        admission,
        catalog: snapshot.catalog,
        configurationRevision: snapshot.configurationRevision,
      });
      account = this.#acquireSelectedCapacity(request, admission, candidates, snapshot.catalog);
      capacityAcquired = true;

      fenceId = `${request.executionId}:dispatch`;
      fenced = this.#options.accountCapacityAuthority.fenceAccountCapacityDispatch(request.executionId, fenceId);
    } catch (error) {
      try {
        if (capacityAcquired) this.#releasePreFenceOrThrow(request.executionId, error);
      } finally {
        await this.#options.authorityAdmission.abort(request.executionId);
        releaseAdmissionOnce();
      }
      throw error;
    }
    let credential: Credential;
    let binding: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
    let authorityAdmission: EffectiveAuthorityAdmissionBundle;
    try {
      const resolved = await this.#options.credentials.resolve({
        routeId: admission.routeId,
        accountId: account.id,
        credentialId: account.credentialId,
        lease: fenced,
        catalog: snapshot.catalog,
        configurationRevision: snapshot.configurationRevision,
      });
      if (resolved.credentialId !== account.credentialId || resolved.credentialRevisionId !== fenced.credentialRevisionId) {
        throw new OperatorSessionExecutionRoutingError("The post-fence credential identity does not match the committed account lease.");
      }
      credential = resolved.credential;

      binding = Object.freeze({
        status: "bound" as const,
        routeId: admission.routeId,
        accountId: account.id,
        credentialId: account.credentialId,
        credentialRevision: fenced.credentialRevisionId,
      });
      const route = snapshot.catalog.routes.find(({ id }) => id === admission.routeId);
      const dataPolicy = evaluateExecutionTargetDataPolicy({
        routeId: admission.routeId,
        providerId: admission.providerId,
        providerModelId: admission.providerModelId,
        requestedClassification: route?.dataClassification ?? "restricted",
        evidence: route?.dataPolicyEvidence,
        now: this.#now(),
      });
      if (dataPolicy.decision.status !== "admitted") {
        throw new OperatorSessionExecutionRoutingError(`Execution route data policy denied execution: ${dataPolicy.decision.reason}.`);
      }
      const facets = await this.#options.authorityAdmission.prepare({ request, admission, snapshot, binding, dataPolicy });
      authorityAdmission = defineEffectiveAuthorityAdmissionBundle({
        sessionId: facets.sessionId,
        turnId: facets.turnId,
        admittedAt: this.#now().toISOString(),
        configuration: {
          sessionRevision: facets.sessionRevision,
          turnRevision: snapshot.configurationRevision,
        },
        session: facets.session,
        turn: {
          authority: facets.turn.authority,
          workGovernance: facets.turn.workGovernance,
          operatorAdoption: facets.turn.operatorAdoption,
          tools: facets.turn.tools,
          effectCeiling: facets.turn.effectCeiling,
          budget: budgetAdmission,
          execution: {
            status: "routed",
            route: admission,
            dataPolicy,
            binding,
            ...(facets.economicCommitment ? { economicCommitment: facets.economicCommitment } : {}),
          },
        },
      });
      await this.#options.authorityAdmission.persist(authorityAdmission);
    } catch (error) {
      let settlementFailure: unknown;
      try {
        this.#settleCancelledPreserving(request.executionId, fenceId, error);
      } catch (failure) {
        settlementFailure = failure;
      } finally {
        try {
          await this.#options.authorityAdmission.abort(request.executionId);
        } catch (abortFailure) {
          settlementFailure ??= abortFailure;
        }
        releaseAdmissionOnce();
      }
      if (settlementFailure) throw settlementFailure;
      throw error;
    }
    if (authorityAdmission.turn.execution.status !== "routed") {
      throw new OperatorSessionExecutionRoutingError("Authority admission did not produce a routed execution.");
    }
    const committedBinding = authorityAdmission.turn.execution.binding;
    const committedRoute = authorityAdmission.turn.execution.route;
    const committedConfigurationRevision = authorityAdmission.configuration.turnRevision;
    // Provider dispatch remains concurrent; only effective-config admission is
    // serialized through credential identity resolution and the dispatch fence.
    releaseAdmissionOnce();
    let capacitySettled = false;
    try {
      const committed = Object.freeze({
        [operatorSessionCommitmentBrand]: operatorSessionCommitmentBrand,
        executionId: request.executionId,
        intentFingerprint: request.intentFingerprint,
        admission: committedRoute,
        accountId: committedBinding.accountId,
        lease: fenced,
        credential,
        authorityAdmission,
        configurationRevision: committedConfigurationRevision,
        binding: committedBinding,
        payload: request.payload,
      }) as OperatorSessionCommittedExecution<Credential, Payload>;
      const result = await this.#options.dispatch.dispatchCommittedTurn(committed);
      const dispatchOutcome = this.#options.readDispatchOutcome?.(result) ?? "completed";
      if (dispatchOutcome === "unknown") {
        this.#settleUnknown(request.executionId, fenceId, "model-round-outcome-unknown");
        capacitySettled = true;
        return Object.freeze({
          admission: committedRoute,
          accountId: committedBinding.accountId,
          leaseId: fenced.leaseId,
          evidence: Object.freeze({
            routeId: committedRoute.routeId,
            accountId: committedBinding.accountId,
            credentialId: committedBinding.credentialId,
            credentialRevision: committedBinding.credentialRevision,
            capacityIdentity: fenced.capacityIdentity,
            leaseId: fenced.leaseId,
            dispatchFenceId: fenceId,
            status: "unknown" as const,
          }),
          result,
        });
      }
      this.#options.accountCapacityAuthority.settleAccountCapacity(
        request.executionId,
        fenceId,
        { kind: "completed", outcome: "success", observedAt: this.#now().toISOString() },
      );
      capacitySettled = true;
      return Object.freeze({
        admission: committedRoute,
        accountId: committedBinding.accountId,
        leaseId: fenced.leaseId,
        evidence: Object.freeze({
          routeId: committedRoute.routeId,
          accountId: committedBinding.accountId,
          credentialId: committedBinding.credentialId,
          credentialRevision: committedBinding.credentialRevision,
          capacityIdentity: fenced.capacityIdentity,
          leaseId: fenced.leaseId,
          dispatchFenceId: fenceId,
          status: "completed",
        }),
        result,
      });
    } catch (error) {
      let settlementFailure: unknown;
      try {
        if (capacitySettled) {
          // The dispatch result already settled the capacity owner.
        } else if (error instanceof OperatorSessionPreDispatchCancellationError) {
          this.#settleCancelled(request.executionId, fenceId);
        } else if (error instanceof OperatorSessionPreProviderLaunchRejectionError) {
          this.#options.accountCapacityAuthority.settleAccountCapacity(
            request.executionId,
            fenceId,
            { kind: "completed", outcome: "provider-error", observedAt: this.#now().toISOString() },
          );
        } else {
          this.#settleUnknown(request.executionId, fenceId, "dispatch-outcome-unknown");
        }
      } catch (failure) {
        settlementFailure = failure;
      }
      try {
        await this.#options.authorityAdmission.abort(request.executionId);
      } catch (failure) {
        settlementFailure ??= failure;
      }
      if (settlementFailure) throw settlementFailure;
      throw error;
    }
  }

  #settleUnknown(executionId: string, fenceId: string, reason: string): void {
    this.#options.accountCapacityAuthority.settleAccountCapacity(executionId, fenceId, {
      kind: "unknown",
      reason,
      observedAt: this.#now().toISOString(),
    });
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  #acquireSelectedCapacity(
    request: OperatorSessionExecutionRequest<Payload>,
    admission: AdmittedExecutionRoute,
    candidates: readonly OperatorSessionExecutionCandidate[],
    catalog: ExecutionCatalog,
  ): ExecutionCatalog["accounts"][number] {
    const excludedAccountIds = new Set<string>();
    while (true) {
      const selection = selectAdmittedExecutionAccount(
        admission,
        candidates
          .filter(({ candidate }) => !excludedAccountIds.has(candidate.accountId))
          .map(({ candidate }) => candidate),
      );
      if (selection.kind !== "selected") {
        throw new OperatorSessionExecutionRoutingError("No eligible account is available for the admitted operator route.");
      }
      const selected = candidates.find(({ candidate }) => candidate.accountId === selection.accountId);
      if (!selected) throw new OperatorSessionExecutionRoutingError("The selected account has no lease binding.");
      this.#validateLeaseBinding(admission, selected);
      const account = catalog.accounts.find(({ id }) => id === selection.accountId);
      if (!account) throw new OperatorSessionExecutionRoutingError("The selected account is no longer configured.");

      // The atomic acquire is the capacity authority.  Candidate availability is
      // only a snapshot used to preserve Core's safety/health/quota/economic order.
      const acquired = this.#options.accountCapacityAuthority.acquireAccountCapacity({
        runtimeInvocationId: request.executionId,
        intentFingerprint: request.intentFingerprint,
        accountPolicyId: accountPolicyId(admission),
        route: selected.lease.candidate.route,
        candidates: [selected.lease],
      });
      if (acquired.status === "conflict") {
        throw new OperatorSessionExecutionRoutingError("The operator execution conflicts with a prior capacity intent.");
      }
      if (acquired.status === "unavailable") {
        if (admission.accountSelection.mode === "exact") {
          throw new OperatorSessionExecutionRoutingError("The selected operator account has no available shared capacity.");
        }
        excludedAccountIds.add(selection.accountId);
        continue;
      }
      if (acquired.replay) {
        throw new OperatorSessionExecutionRoutingError("The operator execution was already committed and cannot be dispatched again.");
      }
      if (acquired.record.accountRef !== selected.lease.candidate.account) {
        this.#releasePreFenceOrThrow(
          request.executionId,
          new OperatorSessionExecutionRoutingError("The acquired account lease does not match the selected account binding."),
        );
        throw new OperatorSessionExecutionRoutingError("The acquired account lease does not match the selected account binding.");
      }
      return account;
    }
  }

  #settleCancelled(executionId: string, fenceId: string): void {
    this.#options.accountCapacityAuthority.settleAccountCapacity(executionId, fenceId, {
      kind: "completed",
      outcome: "cancelled",
      observedAt: this.#now().toISOString(),
    });
  }

  #settleCancelledPreserving(executionId: string, fenceId: string, original: unknown): void {
    try {
      this.#settleCancelled(executionId, fenceId);
    } catch (settlementError) {
      throw new OperatorSessionExecutionRoutingError(
        `${errorMessage(original)}; settlement error: ${errorMessage(settlementError)}`,
      );
    }
  }

  async #captureAndNormalizeSnapshot(): Promise<OperatorSessionExecutionCatalogSnapshot> {
    const observed = await this.#options.catalogSource.capture();
    if (!observed || typeof observed !== "object" || !observed.catalog || !observed.configurationRevision) {
      throw new TypeError("The execution catalog source must return a catalog and configuration revision snapshot.");
    }
    const configurationRevision = normalizeRuntimeConfigurationRevision(observed.configurationRevision);
    return Object.freeze({
      catalog: observed.catalog,
      configurationRevision,
    });
  }

  #validateLeaseBinding(admission: AdmittedExecutionRoute, selected: OperatorSessionExecutionCandidate): void {
    if (
      selected.lease.candidate.route.providerId !== admission.providerId
      || selected.lease.candidate.route.providerModelId !== admission.providerModelId
      || selected.lease.candidate.route.scope !== "operator-session"
    ) {
      throw new OperatorSessionExecutionRoutingError("The selected account lease binding does not match the admitted operator route.");
    }
    const expectedExecutionAccountRefPrefix = `configured:${selected.candidate.accountId}`;
    const accountRef = selected.lease.candidate.account;
    if (accountRef !== expectedExecutionAccountRefPrefix && !accountRef.startsWith(`${expectedExecutionAccountRefPrefix}:`)) {
      throw new OperatorSessionExecutionRoutingError("The selected account lease binding does not belong to the logical account candidate.");
    }
  }

  #releasePreFenceOrThrow(executionId: string, cause: unknown): void {
    try {
      this.#options.accountCapacityAuthority.releaseAccountCapacityPreFence(executionId);
    } catch (releaseError) {
      throw new OperatorSessionExecutionRoutingError(
        `The pre-fence account lease could not be released after failure: ${errorMessage(cause)}; release error: ${errorMessage(releaseError)}`,
      );
    }
  }
}

/** Serializes only the mutable effective-config activation window. */
class AsyncAdmissionMutex {
  #tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    const predecessor = this.#tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.#tail = predecessor.then(() => current);
    await predecessor;
    return release;
  }
}

/** Creates the shared SQLite authority with the only participant identity valid for operator sessions. */
export function createOperatorSessionAccountCapacityAuthority(
  options: Omit<SqliteManagedAccountLeaseAuthorityOptions, "participantKind">,
): SqliteManagedAccountLeaseAuthority {
  const authority = new SqliteManagedAccountLeaseAuthority({ ...options, participantKind: "operator-session" });
  authority.recoverAccountCapacity();
  return authority;
}

function accountPolicyId(admission: AdmittedExecutionRoute) {
  return createExecutionAccountPolicyId(
    admission.accountSelection.mode === "automatic"
      ? admission.accountSelection.accountPolicyId
      : `execution-route:${admission.routeId}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
