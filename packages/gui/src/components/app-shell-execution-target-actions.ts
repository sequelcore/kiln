import { waitForExecutionTargetSelectionResolution } from "./app-shell-runtime.js";

export function createExecutionTargetPickerActions(input: {
  readonly selectExecutionTarget: (targetId: string, accountOverrideId?: string) => boolean;
  readonly waitForTarget?: (targetId: string, accountOverrideId?: string) => Promise<void>;
}) {
  return {
    onSelectTarget: async (targetId: string, accountOverrideId?: string): Promise<
      | { readonly status: "selected" }
      | { readonly status: "failed" }
    > => {
      if (!input.selectExecutionTarget(targetId, accountOverrideId)) return { status: "failed" };
      try {
        await (input.waitForTarget?.(targetId, accountOverrideId)
          ?? waitForExecutionTargetSelectionResolution(targetId, accountOverrideId));
        return { status: "selected" };
      } catch {
        return { status: "failed" };
      }
    },
  };
}
