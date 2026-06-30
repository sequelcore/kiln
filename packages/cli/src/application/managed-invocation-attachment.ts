import type { ManagedAgentCallerAttachmentIdentity } from "@kilnai/core";
import type {
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
} from "@kilnai/runtime";

export type KilnRuntimeManagedInvocationSurface = "run" | "gui" | "tui" | "benchmark";

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
  return {
    kind: "kiln-runtime",
    surface,
    attachmentId: `kiln-runtime:${surface}`,
  };
}
