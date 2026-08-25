import { waitForExecutionRouteSelectionResolution } from "./app-shell-runtime.js";

export function createExecutionRoutePickerActions(input: {
  readonly selectExecutionRoute: (routeId: string, accountOverrideId?: string) => boolean;
  readonly waitForRoute?: (routeId: string, accountOverrideId?: string) => Promise<void>;
}) {
  return {
    onSelectRoute: async (routeId: string, accountOverrideId?: string): Promise<
      | { readonly status: "selected" }
      | { readonly status: "failed" }
    > => {
      if (!input.selectExecutionRoute(routeId, accountOverrideId)) {
        return { status: "failed" };
      }
      try {
        await (input.waitForRoute?.(routeId, accountOverrideId)
          ?? waitForExecutionRouteSelectionResolution(routeId, accountOverrideId));
        return { status: "selected" };
      } catch {
        return { status: "failed" };
      }
    },
  };
}
