import {
  evaluateManagedAgentAdmission,
} from "@kilnai/core";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentAdmissionDecision,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
export {
  admitManagedChildContextAndCredentials,
} from "./context-credential-admission.js";
export type {
  ManagedChildContextCredentialAdmissionInput,
  ManagedChildContextCredentialAdmissionResult,
  ManagedChildContextCredentialEvidence,
  ManagedChildCredentialRouteInput,
  ManagedChildExplicitAuthority,
  ManagedChildGovernedContext,
  ManagedChildParentAuthoritySnapshot,
} from "./context-credential-admission.js";
export {
  appendManagedInvocationSessionEvents,
} from "./session-events.js";
export type {
  AppendManagedInvocationSessionEventsInput,
} from "./session-events.js";
export {
  ManagedCliHarnessAdapter,
} from "./cli-harness-adapter.js";
export type {
  ManagedCliHarnessAdapterConfig,
} from "./cli-harness-adapter.js";
export { ManagedAgentRuntimeAdmissionError } from "./errors.js";

export interface ManagedAgentRuntimeInvocationInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
}

export interface ManagedAgentRuntimeAdapter {
  readonly descriptor: ManagedAgentAdapterDescriptor;
  invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord>;
}

export type ManagedAgentRuntimeInvocationResult =
  | {
    readonly status: "completed";
    readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
    readonly record: ManagedAgentInvocationRecord;
  }
  | {
    readonly status: "denied";
    readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }>;
  };

export class RuntimeManagedAgentInvocationService {
  async invoke(
    request: ManagedAgentInvocationRequest,
    adapter: ManagedAgentRuntimeAdapter,
  ): Promise<ManagedAgentRuntimeInvocationResult> {
    const decision = evaluateManagedAgentAdmission(request, adapter.descriptor);
    if (decision.status === "denied") {
      return {
        status: "denied",
        decision,
      };
    }

    const record = await this.invokeAdmitted({
      request,
      adapter,
      admission: decision,
    });

    return {
      status: "completed",
      decision,
      record,
    };
  }

  async invokeAdmitted(input: {
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly admission: ManagedAgentAdmissionDecision;
  }): Promise<ManagedAgentInvocationRecord> {
    if (input.admission.status !== "admitted") {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation requires an admitted decision");
    }
    if (input.admission.adapterDescriptorId !== input.adapter.descriptor.adapterDescriptorId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admission adapter descriptor does not match runtime adapter");
    }
    if (input.admission.invocationId !== input.request.invocationId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admission invocation id does not match request");
    }

    return input.adapter.invoke({
      request: input.request,
      admission: input.admission,
    });
  }
}
