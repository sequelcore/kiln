import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
} from "@kilnai/core";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentAdapterDescriptor,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import type { EffectiveAuthorityAdmissionBundle } from "../../session/effective-authority-admission-bundle.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeCancellationInput,
  ManagedAgentRuntimeCancellationResult,
  ManagedAgentRuntimeInvocationInput,
} from "./index.js";
import {
  ManagedExternalInvocationCommittedError,
  prepareManagedExternalInvocationActionClaim,
  managedExternalInvocationDigest,
  requirePersistedAuthorityAdmission,
  type ManagedExternalInvocationClaimHandle,
  type ManagedExternalInvocationClaimSettlement,
} from "./external-invocation-action-claim.js";

export interface ManagedRemoteHarnessTransportInvokeInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly abortSignal: AbortSignal;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface ManagedRemoteHarnessTransportCancelInput {
  readonly invocationId: string;
  readonly request: ManagedAgentInvocationRequest;
  readonly reason: string;
  readonly abortSignal: AbortSignal;
}

export interface ManagedRemoteHarnessTransport {
  invoke(input: ManagedRemoteHarnessTransportInvokeInput): Promise<unknown>;
  cancel(input: ManagedRemoteHarnessTransportCancelInput): Promise<void>;
}

export interface ManagedRemoteHarnessAdapterConfig {
  readonly providerId: string;
  readonly model: string;
  readonly transport?: ManagedRemoteHarnessTransport;
  readonly invokeUrl?: string;
  readonly cancelUrl?: string;
  readonly authTokenEnv?: string;
  readonly limitations?: readonly string[];
}

type ManagedRemoteHarnessStartOutcome =
  | { readonly status: "started" }
  | { readonly status: "not-started" };

interface ManagedRemoteHarnessActiveInvocation {
  invokeClaim?: ManagedExternalInvocationClaimHandle;
  readonly input: ManagedAgentRuntimeInvocationInput;
  readonly externalActionClaim: NonNullable<ManagedAgentRuntimeInvocationInput["externalActionClaim"]>;
  readonly childAuthorityAdmission: EffectiveAuthorityAdmissionBundle;
  readonly startOutcome: Promise<ManagedRemoteHarnessStartOutcome>;
  readonly resolveStartOutcome: (outcome: ManagedRemoteHarnessStartOutcome) => void;
  startOutcomeResolved: boolean;
  cancellationRequested?: { readonly reason: string };
  started: boolean;
  cancelPromise?: Promise<void>;
  cancellationClaim?: ManagedExternalInvocationClaimHandle;
  invokeSettled: boolean;
}

export class ManagedRemoteHarnessAdapter implements ManagedAgentRuntimeAdapter {
  readonly descriptor: ManagedAgentAdapterDescriptor;
  private readonly providerId: string;
  private transport?: ManagedRemoteHarnessTransport;
  private readonly transportConfig?: {
    readonly invokeUrl: string;
    readonly cancelUrl: string;
    readonly authTokenEnv?: string;
  };
  private readonly activeInvocations = new Map<string, ManagedRemoteHarnessActiveInvocation>();

  constructor(config: ManagedRemoteHarnessAdapterConfig) {
    this.providerId = requireText(config.providerId, "Managed remote harness provider id is required");
    requireText(config.model, "Managed remote harness model is required");
    if (config.transport !== undefined) {
      this.transport = config.transport;
    } else {
      this.transportConfig = {
        invokeUrl: requireHttpsUrl(config.invokeUrl, "Managed remote harness invokeUrl is required"),
        cancelUrl: requireHttpsUrl(config.cancelUrl, "Managed remote harness cancelUrl is required"),
        ...(config.authTokenEnv !== undefined
          ? { authTokenEnv: requireEnvironmentName(config.authTokenEnv) }
          : {}),
      };
    }
    this.descriptor = defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: `adapter:${this.providerId}:remote-harness`,
      providerId: this.providerId,
      adapterKind: "harness",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["remote-harness"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: {
        supported: true,
        diagnosticArtifactOnTimeout: true,
      },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
        tokenClasses: ["input", "output"],
        semanticSourceGranularity: "unknown",
        evidenceBasis: "adapter",
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
      ...(config.limitations !== undefined ? { limitations: config.limitations } : {}),
    });
  }

  async cancel(input: ManagedAgentRuntimeCancellationInput): Promise<ManagedAgentRuntimeCancellationResult> {
    const externalActionClaim = requireExternalActionClaimContext(input.externalActionClaim);
    const childAuthorityAdmission = requirePersistedAuthorityAdmission({
      authorityAdmission: input.childAuthorityAdmission?.bundle,
      request: input.request,
    });
    const active = this.activeInvocations.get(input.request.invocationId);
    if (active === undefined) return { status: "not-active" };
    if (externalActionClaim !== active.externalActionClaim) {
      throw new Error("Managed remote cancellation must use the invocation's external action claim context.");
    }
    if (!active.started) {
      active.cancellationRequested ??= { reason: input.reason };
      const outcome = await active.startOutcome;
      if (outcome.status === "not-started") return outcome;
    }
    await this.cancelRemote(active, input.reason, input.abortSignal, externalActionClaim, childAuthorityAdmission);
    return { status: "requested" };
  }

  async invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord> {
    const externalActionClaim = requireExternalActionClaimContext(input.externalActionClaim);
    const childAuthorityAdmission = requirePersistedAuthorityAdmission({
      authorityAdmission: input.childAuthorityAdmission?.bundle,
      request: input.request,
    });
    if (input.abortSignal.aborted) {
      const reason = abortReason(input.abortSignal.reason);
      return cancelledRecord(input, reason);
    }

    const start = deferredRemoteStartOutcome();
    const active: ManagedRemoteHarnessActiveInvocation = {
      input,
      externalActionClaim,
      childAuthorityAdmission,
      startOutcome: start.promise,
      resolveStartOutcome: start.resolve,
      startOutcomeResolved: false,
      started: false,
      invokeSettled: false,
    };
    this.activeInvocations.set(input.request.invocationId, active);
    let cancellation: Promise<void> | undefined;
    let cancellationError: unknown;
    const cancelOnAbort = (): void => {
      if (!active.started || cancellation !== undefined) return;
      cancellation = this.cancelRemote(
        active,
        abortReason(input.abortSignal.reason),
        input.abortSignal,
        externalActionClaim,
        childAuthorityAdmission,
      ).catch((error) => {
        cancellationError = error;
        throw error;
      });
    };
    let execution: Promise<unknown>;
    try {
      const invokeClaim = await prepareManagedExternalInvocationActionClaim({
        context: externalActionClaim,
        request: input.request,
        admission: input.admission,
        authorityAdmission: childAuthorityAdmission,
        effectKind: "remote-invoke",
        effect: {
          operation: "transport.invoke",
          providerId: this.providerId,
          model: input.request.providerRoute.model,
          routeId: input.admission.capabilitySnapshot.routeId,
          request: managedExternalInvocationDigest(input.request),
        },
        abortSignal: input.abortSignal,
      });
      active.invokeClaim = invokeClaim;
      if (active.cancellationRequested !== undefined) {
        settleClaim(invokeClaim, externalActionClaim, {
          kind: "interrupted",
          reason: "remote-invocation-cancelled-before-transport-start",
        });
        active.invokeSettled = true;
        resolveRemoteStartOutcome(active, { status: "not-started" });
        return cancelledRecord(input, active.cancellationRequested.reason);
      }
      await input.registerExternalActionClaim?.(invokeClaim.claim);
      const cancellationAfterCheckpoint = readRemoteCancellationRequest(active);
      if (cancellationAfterCheckpoint !== undefined) {
        settleClaim(invokeClaim, externalActionClaim, {
          kind: "interrupted",
          reason: "remote-invocation-cancelled-before-transport-start",
        });
        active.invokeSettled = true;
        resolveRemoteStartOutcome(active, { status: "not-started" });
        return cancelledRecord(input, cancellationAfterCheckpoint.reason);
      }
      // The permit is consumed immediately adjacent to this exact transport
      // call. There is intentionally no adapter retry around it.
      const transport = this.getTransport();
      invokeClaim.permit.consume();
      active.started = true;
      resolveRemoteStartOutcome(active, { status: "started" });
      execution = transport.invoke({
        request: input.request,
        admission: input.admission,
        abortSignal: input.abortSignal,
        ...(input.environment !== undefined ? { environment: input.environment } : {}),
      });
      input.abortSignal.addEventListener("abort", cancelOnAbort, { once: true });
      if (input.abortSignal.aborted) cancelOnAbort();
      input.registerAdapterCompletion(execution);
      const remoteRecord = await execution;
      if (input.abortSignal.aborted) {
        try {
          await cancellation;
        } catch (cancellationFailure) {
          cancellationError ??= cancellationFailure;
        }
        if (cancellationError !== undefined) throw cancellationError;
        settleClaim(invokeClaim, externalActionClaim, {
          kind: "interrupted",
          reason: "remote-invocation-interrupted-after-start",
        });
        active.invokeSettled = true;
        throw new ManagedExternalInvocationCommittedError(
          new Error("Remote invocation completed after cancellation was requested."),
          invokeClaim.claim.claimId,
          "interrupted",
        );
      }
      settleClaim(invokeClaim, externalActionClaim, { kind: "success" });
      active.invokeSettled = true;
      return defineManagedAgentInvocationRecord(remoteRecord as ManagedAgentInvocationRecord);
    } catch (error) {
      if (!active.startOutcomeResolved) {
        resolveRemoteStartOutcome(active, { status: "not-started" });
      }
      const invokeClaim = active.invokeClaim;
      if (invokeClaim === undefined) throw error;
      if (input.abortSignal.aborted) {
        try {
          await cancellation;
        } catch (cancellationFailure) {
          cancellationError ??= cancellationFailure;
        }
        if (!active.invokeSettled) {
          settleClaim(invokeClaim, externalActionClaim, {
            kind: "interrupted",
            reason: cancellationError === undefined
              ? "remote-invocation-interrupted-after-start"
              : "remote-cancel-outcome-unknown",
          });
          active.invokeSettled = true;
        }
        if (cancellationError !== undefined) throw cancellationError;
        throw new ManagedExternalInvocationCommittedError(error, invokeClaim.claim.claimId, "interrupted");
      }
      if (!active.invokeSettled) {
        settleClaim(invokeClaim, externalActionClaim, active.started
          ? { kind: "unknown", reason: "remote-invocation-failed-after-claim" }
          : { kind: "interrupted", reason: "remote-invocation-checkpoint-failed-before-start" });
        active.invokeSettled = true;
      }
      throw new ManagedExternalInvocationCommittedError(error, invokeClaim.claim.claimId);
    } finally {
      input.abortSignal.removeEventListener("abort", cancelOnAbort);
      this.activeInvocations.delete(input.request.invocationId);
    }
  }

  private async cancelRemote(
    active: {
      readonly input: ManagedAgentRuntimeInvocationInput;
      started: boolean;
      cancelPromise?: Promise<void>;
      cancellationClaim?: ManagedExternalInvocationClaimHandle;
    },
    reason: string,
    abortSignal: AbortSignal,
    actionContext: NonNullable<ManagedAgentRuntimeInvocationInput["externalActionClaim"]>,
    authorityAdmission: EffectiveAuthorityAdmissionBundle,
  ): Promise<void> {
    const request = active.input.request;
    if (!active.started) return;
    if (active.cancelPromise !== undefined) return active.cancelPromise;
    // Publish the single-flight promise before the first admission await so
    // timeout abort and operator cancellation cannot claim two remote sends.
    const cancelPromise = (async () => {
      const cancelClaim = await prepareManagedExternalInvocationActionClaim({
        context: actionContext,
        request,
        admission: active.input.admission,
        authorityAdmission,
        effectKind: "remote-cancel",
        effect: {
          operation: "transport.cancel",
          providerId: this.providerId,
          invocationId: request.invocationId,
          reason,
        },
        abortSignal: undefined,
      });
      cancelClaim.permit.consume();
      active.cancellationClaim = cancelClaim;
      try {
        // This is a distinct post-start action claim; invoke and cancel can
        // never share a permit or a durable slot.
        await this.getTransport().cancel({
          invocationId: request.invocationId,
          request,
          reason,
          abortSignal,
        });
        settleClaim(cancelClaim, actionContext, { kind: "success" });
      } catch (error) {
        settleClaim(cancelClaim, actionContext, { kind: "unknown", reason: "remote-cancel-failed-after-claim" });
        throw new ManagedExternalInvocationCommittedError(error, cancelClaim.claim.claimId);
      }
    })();
    active.cancelPromise = cancelPromise;
    return cancelPromise;
  }

  private getTransport(): ManagedRemoteHarnessTransport {
    if (this.transport !== undefined) return this.transport;
    if (this.transportConfig === undefined) {
      throw new Error("Managed remote harness transport is not configured.");
    }
    this.transport = new ManagedRemoteHarnessHttpTransport(this.transportConfig);
    return this.transport;
  }
}

function deferredRemoteStartOutcome(): {
  readonly promise: Promise<ManagedRemoteHarnessStartOutcome>;
  readonly resolve: (outcome: ManagedRemoteHarnessStartOutcome) => void;
} {
  let resolve!: (outcome: ManagedRemoteHarnessStartOutcome) => void;
  const promise = new Promise<ManagedRemoteHarnessStartOutcome>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function resolveRemoteStartOutcome(
  active: ManagedRemoteHarnessActiveInvocation,
  outcome: ManagedRemoteHarnessStartOutcome,
): void {
  if (active.startOutcomeResolved) return;
  active.startOutcomeResolved = true;
  active.resolveStartOutcome(outcome);
}

function readRemoteCancellationRequest(
  active: ManagedRemoteHarnessActiveInvocation,
): ManagedRemoteHarnessActiveInvocation["cancellationRequested"] {
  return active.cancellationRequested;
}

function settleClaim(
  handle: ManagedExternalInvocationClaimHandle,
  context: NonNullable<ManagedAgentRuntimeInvocationInput["externalActionClaim"]>,
  settlement: ManagedExternalInvocationClaimSettlement,
): void {
  if (handle.settlementAttempted) return;
  handle.settlementAttempted = true;
  try {
    context.store.settle(handle.permit, settlement);
    handle.settled = true;
  } catch (error) {
    throw new ManagedExternalInvocationCommittedError(error, handle.claim.claimId);
  }
}

function requireExternalActionClaimContext(
  context: ManagedAgentRuntimeInvocationInput["externalActionClaim"],
): NonNullable<ManagedAgentRuntimeInvocationInput["externalActionClaim"]> {
  if (context === undefined) {
    throw new Error("Managed remote harness invocation requires an external action claim context.");
  }
  return context;
}

class ManagedRemoteHarnessHttpTransport implements ManagedRemoteHarnessTransport {
  private readonly invokeUrl: string;
  private readonly cancelUrl: string;
  private readonly authTokenEnv?: string;

  constructor(config: {
    readonly invokeUrl?: string;
    readonly cancelUrl?: string;
    readonly authTokenEnv?: string;
  }) {
    this.invokeUrl = requireHttpsUrl(config.invokeUrl, "Managed remote harness invokeUrl is required");
    this.cancelUrl = requireHttpsUrl(config.cancelUrl, "Managed remote harness cancelUrl is required");
    this.authTokenEnv = config.authTokenEnv ? requireEnvironmentName(config.authTokenEnv) : undefined;
  }

  async invoke(input: ManagedRemoteHarnessTransportInvokeInput): Promise<unknown> {
    const body = await this.postJson(this.invokeUrl, {
      request: input.request,
      admission: input.admission,
      ...(input.environment !== undefined ? { environment: input.environment } : {}),
    }, input.abortSignal);
    return readRemoteRecord(body);
  }

  async cancel(input: ManagedRemoteHarnessTransportCancelInput): Promise<void> {
    const signal = input.abortSignal.aborted
      ? new AbortController().signal
      : input.abortSignal;
    await this.postJson(this.cancelUrl, {
      invocationId: input.invocationId,
      reason: input.reason,
    }, signal);
  }

  private async postJson(
    url: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Remote managed harness request failed with HTTP ${response.status} ${response.statusText}`.trim());
    }
    if (response.status === 204) {
      return undefined;
    }
    return response.json();
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (this.authTokenEnv !== undefined) {
      const token = process.env[this.authTokenEnv];
      if (!token || token.trim().length === 0) {
        throw new Error(`Remote managed harness auth token env '${this.authTokenEnv}' is not set`);
      }
      headers.authorization = `Bearer ${token}`;
    }
    return headers;
  }
}

function readRemoteRecord(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "record" in value) {
    return (value as { readonly record: unknown }).record;
  }
  return value;
}

function cancelledRecord(
  input: ManagedAgentRuntimeInvocationInput,
  reason: string,
): ManagedAgentInvocationRecord {
  const request = input.request;
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState: "cancelled",
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot: input.admission.capabilitySnapshot,
    childSessionId: `${request.parentSessionId}:remote:${request.invocationId}`,
    transcript: {
      uri: managedInvocationUri(request.invocationId, "transcript"),
      redacted: "unknown",
      truncated: false,
      persisted: true,
      retention: "external",
    },
    usage: unknownRemoteUsage(),
    resultHandoff: {
      provenance: {
        delivery: "runtime-generated",
        configuredModelId: request.providerRoute.model ?? "provider-default",
        observedModelIds: [],
      },
      summary: reason,
      resourceUris: [managedInvocationUri(request.invocationId, "transcript")],
      memoryWriteProposalUris: [],
    },
  });
}

function unknownRemoteUsage(): ManagedAgentInvocationRecord["usage"] {
  return {
    source: "adapter",
    tokenClasses: [
      { name: "input", value: "unknown" },
      { name: "output", value: "unknown" },
    ],
    cost: {
      currency: "unknown",
      amount: "unknown",
    },
  };
}

function managedInvocationUri(invocationId: string, kind: string): string {
  return `kiln://managed-invocations/${invocationId}/${kind}`;
}

function abortReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason.trim();
  }
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message.trim();
  }
  return "Managed remote harness invocation cancelled.";
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}

function requireHttpsUrl(value: string | undefined, message: string): string {
  const text = requireText(value, message);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") {
      throw new Error(message);
    }
    return url.toString();
  } catch {
    throw new Error(message);
  }
}

function requireEnvironmentName(value: string): string {
  const name = requireText(value, "Managed remote harness authTokenEnv is required");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new Error("Managed remote harness authTokenEnv must be a portable environment variable name");
  }
  return name;
}
