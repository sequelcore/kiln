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

export interface OperatorSessionExecutionRoutingServiceOptions<Credential, Payload, Result> {
  readonly catalogSource: OperatorSessionExecutionCatalogSource;
  readonly candidates: OperatorSessionExecutionCandidatePort;
  /** Must be a SqliteManagedAccountLeaseAuthority configured with participantKind: operator-session. */
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  readonly credentials: OperatorSessionCredentialPort<Credential>;
  /** Adapter construction and the existing session/orchestrator pipeline are composition-owned. */
  readonly dispatch: OperatorSessionExecutionDispatch<Credential, Payload, Result>;
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
  readonly admission: AdmittedExecutionRoute;
  readonly accountId: string;
  readonly lease: AccountCapacityRecord;
  readonly credential: Credential;
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
  readonly status: "completed";
}

export class OperatorSessionExecutionRoutingError extends Error {
  override name = "OperatorSessionExecutionRoutingError";
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
    let capacityAcquired = false;
    try {
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
        releaseAdmissionOnce();
      }
      throw error;
    }
    let credential: Credential;
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
        this.#settleUnknown(request.executionId, fenceId, "credential-identity-drift");
        throw new OperatorSessionExecutionRoutingError("The post-fence credential identity does not match the committed account lease.");
      }
      credential = resolved.credential;
    } catch (error) {
      try {
        if (!(error instanceof OperatorSessionExecutionRoutingError)) {
          this.#settleUnknown(request.executionId, fenceId, "credential-resolution-failed");
        }
      } finally {
        releaseAdmissionOnce();
      }
      throw error;
    }
    // Provider dispatch remains concurrent; only effective-config admission is
    // serialized through credential identity resolution and the dispatch fence.
    releaseAdmissionOnce();
    try {
      const binding = Object.freeze({
        status: "bound" as const,
        routeId: admission.routeId,
        accountId: account.id,
        credentialId: account.credentialId,
        credentialRevision: fenced.credentialRevisionId,
      });
      const committed = Object.freeze({
        [operatorSessionCommitmentBrand]: operatorSessionCommitmentBrand,
        admission,
        accountId: account.id,
        lease: fenced,
        credential,
        configurationRevision: snapshot.configurationRevision,
        binding,
        payload: request.payload,
      }) as OperatorSessionCommittedExecution<Credential, Payload>;
      const result = await this.#options.dispatch.dispatchCommittedTurn(committed);
      this.#options.accountCapacityAuthority.settleAccountCapacity(
        request.executionId,
        fenceId,
        { kind: "completed", outcome: "success", observedAt: this.#now().toISOString() },
      );
      return Object.freeze({
        admission,
        accountId: account.id,
        leaseId: fenced.leaseId,
        evidence: Object.freeze({
          routeId: admission.routeId,
          accountId: account.id,
          credentialId: account.credentialId,
          credentialRevision: fenced.credentialRevisionId,
          capacityIdentity: fenced.capacityIdentity,
          leaseId: fenced.leaseId,
          dispatchFenceId: fenceId,
          status: "completed",
        }),
        result,
      });
    } catch (error) {
      this.#settleUnknown(request.executionId, fenceId, "dispatch-outcome-unknown");
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
