import type {
  ManagedAgentCallerAttachmentIdentity,
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
        candidateCaptureRoot: snapshot.record?.resourceLease?.workingDirectoryPath
          ?? snapshot.request.authority.workingDirectory.path,
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
): ManagedInvocationToolAttachment {
  return {
    options,
    callerIdentity: createKilnRuntimeCallerIdentity(surface),
  };
}

export function createKilnRuntimeCallerIdentity(
  surface: KilnRuntimeManagedInvocationSurface,
): ManagedAgentCallerAttachmentIdentity {
  const base = {
    kind: "kiln-runtime" as const,
    surface,
    attachmentId: `kiln-runtime:${surface}`,
  };
  return base;
}
