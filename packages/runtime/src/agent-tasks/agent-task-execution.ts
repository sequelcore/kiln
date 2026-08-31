import type {
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentResultHandoff,
  ManagedAgentWriteEvidence,
} from "@kilnai/core";
import type { ManagedEconomicDispatchPreparation } from "../agents/managed-invocation/economic-dispatch-coordinator.js";
import type { ManagedAgentRuntimeConsumedWriteApproval } from "../agents/managed-invocation/internal-consumed-write-approval.js";
import type {
  AgentTaskDataPolicyProof,
  AgentTaskCapabilityOutput,
  AgentTaskDispatch,
  AgentTaskNativeHarnessRoute,
  AgentTaskRecord,
} from "./contracts.js";

export interface AgentTaskEconomicExecutionPort {
  execute(input: {
    readonly job: AgentTaskRecord;
    readonly preparation: Extract<ManagedEconomicDispatchPreparation, { readonly status: "prepared" }>;
    readonly consumedWriteApproval?: ManagedAgentRuntimeConsumedWriteApproval;
    readonly workLimits?: {
      readonly maxTurns?: number;
      readonly maxDurationMs?: number;
      readonly maxConcurrency?: number;
    };
  }): Promise<{
    readonly runtimeInvocationId: string;
    readonly completedAt: string;
    readonly resultHandoff: ManagedAgentResultHandoff;
    /** Typed child evidence for the job's admitted capability, when present. */
    readonly capabilityOutput?: AgentTaskCapabilityOutput;
    /** Exact sanitized decision returned by the configured Runtime authority. */
    readonly dataPolicyProof: AgentTaskDataPolicyProof;
    readonly writeEvidence?: readonly ManagedAgentWriteEvidence[];
  }>;
}

export interface AgentTaskNativeHarnessExecutionPort {
  execute(input: {
    readonly job: AgentTaskRecord & { readonly dispatch: Extract<AgentTaskDispatch, { readonly kind: "native-harness" }> };
    readonly route: AgentTaskNativeHarnessRoute;
    readonly dispatchFenceId: string;
    readonly consumedWriteApproval?: ManagedAgentRuntimeConsumedWriteApproval;
    readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
    readonly abortSignal?: AbortSignal;
  }): Promise<{
    readonly runtimeInvocationId: string;
    readonly completedAt: string;
    readonly resultHandoff: ManagedAgentResultHandoff;
    /** Typed child evidence for the job's admitted capability, when present. */
    readonly capabilityOutput?: AgentTaskCapabilityOutput;
    readonly dataPolicyProof: AgentTaskDataPolicyProof;
    readonly writeEvidence?: readonly ManagedAgentWriteEvidence[];
  }>;
}
