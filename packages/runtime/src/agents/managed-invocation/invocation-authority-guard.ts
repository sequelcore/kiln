import { buildManagedAgentAuthorityEvidence } from "@kilnai/core";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentInvocationRequest,
  ManagedAgentObservedRuntimeAuthorityEvidence,
  ManagedEconomicCommitment,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { cloneJson, toError } from "./runtime-primitives.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeAuthorityObservationInput,
  RuntimeManagedAgentInvocationServiceOptions,
} from "./invocation-service.js";

export class ManagedAgentRuntimeAuthorityObservationError extends ManagedAgentRuntimeAdmissionError {}

export function projectedAuthoritySourceForAdapter(
  adapter: ManagedAgentRuntimeAdapter,
): Parameters<typeof buildManagedAgentAuthorityEvidence>[0]["projectedSource"] {
  if (adapter.descriptor.adapterKind === "harness" && adapter.descriptor.supportedExecutionModes.includes("cli-harness")) {
    return "cli-harness-session-factory";
  }
  if (adapter.descriptor.supportedExecutionModes.includes("remote-harness")) {
    return "remote-harness-adapter";
  }
  return "direct-provider-adapter";
}

export function capabilitySnapshotInputWithRuntimeAuthorityProjection(
  request: ManagedAgentInvocationRequest,
  adapter: ManagedAgentRuntimeAdapter,
  input: ManagedAgentCapabilitySnapshotInput,
  evaluatedAt: Date,
): ManagedAgentCapabilitySnapshotInput {
  return {
    ...input,
    authorityEvidence: buildManagedAgentAuthorityEvidence({
      request,
      projectedSource: projectedAuthoritySourceForAdapter(adapter),
      evaluatedAt: evaluatedAt.toISOString(),
    }),
  };
}

export async function capabilitySnapshotInputWithObservedRuntimeAuthority(
  options: RuntimeManagedAgentInvocationServiceOptions,
  now: () => Date,
  request: ManagedAgentInvocationRequest,
  adapter: ManagedAgentRuntimeAdapter,
  input: ManagedAgentCapabilitySnapshotInput,
  abortSignal: AbortSignal | undefined,
): Promise<ManagedAgentCapabilitySnapshotInput> {
  const observedRuntime = await observeRuntimeAuthority(options, {
    phase: "pre-start",
    request,
    adapter,
    abortSignal,
  });
  return {
    ...input,
    authorityEvidence: buildManagedAgentAuthorityEvidence({
      request,
      projectedSource: projectedAuthoritySourceForAdapter(adapter),
      ...(observedRuntime !== undefined ? { observedRuntime } : {}),
      evaluatedAt: now().toISOString(),
    }),
  };
}

export async function assertPostStartAuthority(
  options: RuntimeManagedAgentInvocationServiceOptions,
  now: () => Date,
  request: ManagedAgentInvocationRequest,
  adapter: ManagedAgentRuntimeAdapter,
  admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  abortController: AbortController,
): Promise<void> {
  if (options.authorityObserver === undefined) return;
  const observedRuntime = await observeRuntimeAuthority(options, {
    phase: "post-start",
    request,
    adapter,
    abortSignal: abortController.signal,
  });
  const evidence = buildManagedAgentAuthorityEvidence({
    request,
    projectedSource: admission.capabilitySnapshot.authorityEvidence.projected.source,
    observedRuntime,
    evaluatedAt: now().toISOString(),
  });
  if (evidence.classification !== "current-verified") {
    const reason = `Managed child runtime authority changed after start: ${evidence.classification}`;
    abortController.abort(reason);
    await adapter.cancel?.({
      request: cloneJson(request),
      admission: cloneJson(admission),
      reason,
      abortSignal: abortController.signal,
    });
    throw new ManagedAgentRuntimeAuthorityObservationError(reason);
  }
}

async function observeRuntimeAuthority(
  options: RuntimeManagedAgentInvocationServiceOptions,
  input: {
    readonly phase: ManagedAgentRuntimeAuthorityObservationInput["phase"];
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly abortSignal?: AbortSignal;
  },
): Promise<ManagedAgentObservedRuntimeAuthorityEvidence | undefined> {
  try {
    const observation = options.authorityObserver?.observe({
      phase: input.phase,
      request: cloneJson(input.request),
      adapterDescriptor: cloneJson(input.adapter.descriptor),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
    return observation
      ? await awaitManagedInvocationAbortableStep(observation, input.abortSignal)
      : undefined;
  } catch (error) {
    const runtimeError = toError(error);
    return {
      source: "runtime-observation",
      proof: "failed",
      reason: `Managed child runtime authority observation failed during ${input.phase}: ${runtimeError.message}`,
    };
  }
}

export function awaitManagedInvocationAbortableStep<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(managedInvocationAbortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(managedInvocationAbortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function managedInvocationAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(managedInvocationAbortReason(signal.reason));
}

export function managedInvocationAbortReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message;
  }
  return "Parent runtime turn interrupted.";
}

export function assertManagedEconomicCommitmentMatchesRequest(
  request: ManagedAgentInvocationRequest,
  routeId: string,
  commitment: ManagedEconomicCommitment,
): void {
  const selected = commitment.reservation.selectedIdentity;
  if (
    selected.route.routeId !== routeId
    || selected.route.providerId !== request.providerRoute.providerId
    || selected.route.modelId !== request.providerRoute.model
  ) {
    throw new ManagedAgentRuntimeAdmissionError(
      "Managed economic commitment does not match the admitted provider route.",
    );
  }
  const credentialRoute = request.authority.credentialRoute;
  if (selected.account.kind === "account-bound") {
    if (
      credentialRoute.mode !== "account-leased"
      || selected.route.accountPolicyId !== credentialRoute.accountPolicyId
    ) {
      throw new ManagedAgentRuntimeAdmissionError(
        "Managed economic commitment does not match the admitted account policy.",
      );
    }
    return;
  }
  if (credentialRoute.mode !== "credentialless") {
    throw new ManagedAgentRuntimeAdmissionError(
      "Accountless managed economic commitment requires a credentialless admitted route.",
    );
  }
}

export function requiresRuntimeAuthorityProof(request: ManagedAgentInvocationRequest): boolean {
  return request.executionIntent?.attendance === "unattended" || request.executionIntent?.lifecycle !== "foreground";
}
