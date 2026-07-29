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
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeCancellationInput,
  ManagedAgentRuntimeInvocationInput,
} from "./index.js";

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

export class ManagedRemoteHarnessAdapter implements ManagedAgentRuntimeAdapter {
  readonly descriptor: ManagedAgentAdapterDescriptor;
  private readonly providerId: string;
  private readonly transport: ManagedRemoteHarnessTransport;
  private readonly cancelAcknowledgements = new Set<string>();

  constructor(config: ManagedRemoteHarnessAdapterConfig) {
    this.providerId = requireText(config.providerId, "Managed remote harness provider id is required");
    requireText(config.model, "Managed remote harness model is required");
    this.transport = config.transport ?? new ManagedRemoteHarnessHttpTransport({
      invokeUrl: config.invokeUrl,
      cancelUrl: config.cancelUrl,
      authTokenEnv: config.authTokenEnv,
    });
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

  async cancel(input: ManagedAgentRuntimeCancellationInput): Promise<void> {
    await this.cancelRemote(input.request, input.reason, input.abortSignal);
  }

  async invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord> {
    if (input.abortSignal.aborted) {
      const reason = abortReason(input.abortSignal.reason);
      await this.cancelRemote(input.request, reason, input.abortSignal).catch(() => undefined);
      return cancelledRecord(input, reason);
    }

    let cancellation: Promise<void> | undefined;
    const cancelOnAbort = (): void => {
      cancellation = this.cancelRemote(input.request, abortReason(input.abortSignal.reason), input.abortSignal)
        .catch(() => undefined);
    };
    input.abortSignal.addEventListener("abort", cancelOnAbort, { once: true });
    try {
      const execution = this.transport.invoke({
        request: input.request,
        admission: input.admission,
        abortSignal: input.abortSignal,
        ...(input.environment !== undefined ? { environment: input.environment } : {}),
      });
      input.registerExecutionSettlement(execution);
      const remoteRecord = await execution;
      if (input.abortSignal.aborted) {
        await cancellation;
        return cancelledRecord(input, abortReason(input.abortSignal.reason));
      }
      return defineManagedAgentInvocationRecord(remoteRecord as ManagedAgentInvocationRecord);
    } catch (error) {
      if (input.abortSignal.aborted) {
        await cancellation;
        return cancelledRecord(input, abortReason(input.abortSignal.reason));
      }
      throw error;
    } finally {
      input.abortSignal.removeEventListener("abort", cancelOnAbort);
    }
  }

  private async cancelRemote(
    request: ManagedAgentInvocationRequest,
    reason: string,
    abortSignal: AbortSignal,
  ): Promise<void> {
    if (this.cancelAcknowledgements.has(request.invocationId)) {
      return;
    }
    await this.transport.cancel({
      invocationId: request.invocationId,
      request,
      reason,
      abortSignal,
    });
    this.cancelAcknowledgements.add(request.invocationId);
  }
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
