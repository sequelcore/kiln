import {
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  evaluateManagedAgentAdmission,
  isManagedAgentWriteAuthorityProfile,
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
  collectManagedAgentLiveWriteDecisionEvidence,
  collectManagedAgentLiveWriteEvidence,
  normalizeManagedAgentLiveWriteChanges,
} from "./live-write-event-bridge.js";
export type {
  ManagedAgentLiveWriteDecision,
  ManagedAgentLiveWriteDecisionEvidenceInput,
  ManagedAgentLiveWriteDecisionSource,
  ManagedAgentLiveWriteDecisionStatus,
  ManagedAgentLiveWriteEventBridgeInput,
  ManagedAgentLiveWriteEventBridgeResult,
  ManagedAgentLiveWriteChange,
  ManagedAgentLiveWriteChangeSource,
} from "./live-write-event-bridge.js";
export {
  ManagedDirectProviderRuntimeAdapter,
  type ManagedDirectProviderRuntimeAdapterConfig,
} from "./direct-runtime-adapter.js";
export {
  ManagedCliHarnessAdapter,
} from "./cli-harness-adapter.js";
export type {
  ManagedCliHarnessAdapterConfig,
  ManagedCliHarnessFilesystemBoundaryConfig,
} from "./cli-harness-adapter.js";
export {
  attachManagedInvocationSessionEventSink,
  createManagedInvocationToolExecutor,
  MANAGED_AGENT_INVOKE_CAPABILITY,
  MANAGED_AGENT_INVOKE_TOOL,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
} from "./runtime-tool.js";
export type {
  ManagedInvocationSessionEventSink,
  ManagedInvocationRouteProfile,
  ManagedInvocationToolOptions,
  ManagedInvocationToolRoute,
} from "./runtime-tool.js";
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
    const admission = this.requireRuntimeAdmission(input);
    const record = await input.adapter.invoke({
      request: input.request,
      admission,
    });
    this.assertRecordWithinAdmission(record, input.request, admission);
    return record;
  }

  private requireRuntimeAdmission(input: {
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly admission: ManagedAgentAdmissionDecision;
  }): Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }> {
    if (input.admission.status !== "admitted") {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation requires an admitted decision");
    }
    if (input.admission.adapterDescriptorId !== input.adapter.descriptor.adapterDescriptorId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admission adapter descriptor does not match runtime adapter");
    }
    if (input.admission.invocationId !== input.request.invocationId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admission invocation id does not match request");
    }
    if (input.admission.profile !== input.request.profile) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admission profile does not match request");
    }

    const runtimeDecision = evaluateManagedAgentAdmission(input.request, input.adapter.descriptor);
    if (runtimeDecision.status !== "admitted") {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime admission no longer satisfies adapter policy: ${runtimeDecision.reason}`);
    }
    if (!sameJson(runtimeDecision, input.admission)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime admission must match the current core admission decision");
    }

    this.assertWriteAdmissionSupported(input.request, input.adapter.descriptor, input.admission);
    return input.admission;
  }

  private assertWriteAdmissionSupported(
    request: ManagedAgentInvocationRequest,
    descriptor: ManagedAgentAdapterDescriptor,
    admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  ): void {
    if (request.profile === "foundation-readonly-plan") {
      if (request.authority.writeAuthority !== undefined || admission.writeAuthority !== undefined) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent read-only runtime invocation cannot carry write authority");
      }
      return;
    }

    if (!isManagedAgentWriteAuthorityProfile(request.profile)) {
      return;
    }

    if (request.authority.writeAuthority === undefined || admission.writeAuthority === undefined) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent write runtime invocation requires admitted write authority");
    }
    if (!sameJson(request.authority.writeAuthority, admission.writeAuthority)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admitted write authority does not match request authority");
    }

    const writeCapabilities = defineManagedAgentAdapterWriteAuthorityDescriptor(descriptor.writeAuthority);
    if (!writeCapabilities.proposalSupported || !writeCapabilities.scopeReduction) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce write proposal scope");
    }
    if (request.profile === "foundation-apply-approved-writes") {
      if (!writeCapabilities.approvedApplySupported || !writeCapabilities.cleanupEvidence || !writeCapabilities.rollbackEvidence) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce approved-write authority");
      }
    }
    if (
      (request.profile === "foundation-memory-write-proposals" ||
        request.authority.writeAuthority.scope.memory.mode !== "none" ||
        request.authority.memoryScope.access === "write-proposals") &&
      !writeCapabilities.memoryProposalSupported
    ) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce memory write proposals");
    }
  }

  private assertRecordWithinAdmission(
    record: ManagedAgentInvocationRecord,
    request: ManagedAgentInvocationRequest,
    admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  ): void {
    if (record.invocationId !== request.invocationId || record.invocationId !== admission.invocationId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record invocation id does not match admitted request");
    }
    if (record.parentSessionId !== request.parentSessionId || record.parentTurnId !== request.parentTurnId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record parent lineage does not match request");
    }
    if (record.profile !== request.profile || record.profile !== admission.profile) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record profile does not match admitted request");
    }
    if (record.authority.authorityProfileId !== admission.authorityProfileId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record authority profile does not match admission");
    }
    if (!sameJson(record.authority, request.authority)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned authority outside the admitted request");
    }

    if (admission.writeAuthority === undefined) {
      if (record.authority.writeAuthority !== undefined) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned write authority for a non-write admission");
      }
      const nonDeniedWriteEvidence = record.writeEvidence?.filter((evidence) => evidence.kind !== "write-authority-denied") ?? [];
      if (nonDeniedWriteEvidence.length > 0) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned write evidence for a non-write admission");
      }
      if ((record.resultHandoff?.memoryWriteProposalUris.length ?? 0) > 0) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned memory write proposals for a non-write admission");
      }
      return;
    }

    if (record.authority.writeAuthority === undefined) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter dropped admitted write authority from the record");
    }
    if (!sameJson(record.authority.writeAuthority, admission.writeAuthority)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter broadened or changed admitted write authority");
    }
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
