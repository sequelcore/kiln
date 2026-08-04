import type {
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentRequestedAuthority,
  ManagedInvocationExecutionProof,
} from "@kilnai/core";
import type {
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
  ManagedInvocationToolOptionsWithService,
} from "@kilnai/runtime";
import type { ManagedInvocationExecutionProofResolver } from "./work-governance-tool.js";

export type KilnRuntimeManagedInvocationSurface = "run" | "gui" | "tui" | "benchmark";

export interface ManagedInvocationExecutionProofResolverRef {
  readonly resolve: ManagedInvocationExecutionProofResolver;
  bind(options: ManagedInvocationToolOptionsWithService | undefined): void;
}

export function createManagedInvocationExecutionProofResolverRef(): ManagedInvocationExecutionProofResolverRef {
  let options: ManagedInvocationToolOptionsWithService | undefined;
  return {
    resolve(invocationId): ManagedInvocationExecutionProof | undefined {
      const snapshot = options?.invocationService.status(invocationId);
      const scope = snapshot?.request.executionScope;
      const resultHandoff = snapshot?.record?.resultHandoff;
      if (
        !snapshot
        || snapshot.lifecycleState !== "completed"
        || !resultHandoff
        || scope?.kind !== "work_item"
      ) {
        return undefined;
      }
      return {
        invocationId: snapshot.invocationId,
        parentSessionId: snapshot.parentSessionId,
        goalRunId: scope.goalRunId,
        workItemId: scope.workItemId,
        resultHandoff,
      };
    },
    bind(next): void {
      options = next;
    },
  };
}

export function createKilnRuntimeManagedInvocationAttachment(
  surface: KilnRuntimeManagedInvocationSurface,
  options: ManagedInvocationToolOptions,
  parentEffectiveRequestedAuthority?: ManagedAgentRequestedAuthority,
): ManagedInvocationToolAttachment {
  return {
    options,
    callerIdentity: createKilnRuntimeCallerIdentity(surface, parentEffectiveRequestedAuthority),
  };
}

export function createKilnRuntimeCallerIdentity(
  surface: KilnRuntimeManagedInvocationSurface,
  parentEffectiveRequestedAuthority?: ManagedAgentRequestedAuthority,
): ManagedAgentCallerAttachmentIdentity {
  const base = {
    kind: "kiln-runtime" as const,
    surface,
    attachmentId: `kiln-runtime:${surface}`,
  };
  return parentEffectiveRequestedAuthority !== undefined
    ? { ...base, parentEffectiveRequestedAuthority }
    : base;
}
