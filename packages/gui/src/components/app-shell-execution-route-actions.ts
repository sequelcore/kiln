import { waitForExecutionRouteSelectionResolution } from "./app-shell-runtime.js";

export function createExecutionRoutePickerActions(input: {
  readonly selectExecutionRoute: (routeId: string, accountOverrideId?: string) => boolean;
  readonly readFailure: () => { readonly message: string } | null;
  readonly waitForRoute?: (routeId: string, accountOverrideId?: string) => Promise<void>;
}) {
  return {
    onSelectRoute: async (routeId: string, accountOverrideId?: string): Promise<void> => {
      if (!input.selectExecutionRoute(routeId, accountOverrideId)) {
        throw new Error(input.readFailure()?.message ?? "Execution target selection failed.");
      }
      await (input.waitForRoute?.(routeId, accountOverrideId)
        ?? waitForExecutionRouteSelectionResolution(routeId, accountOverrideId));
    },
  };
}
