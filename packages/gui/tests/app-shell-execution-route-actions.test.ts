import { describe, expect, it, vi } from "vitest";
import { createExecutionRoutePickerActions } from "../src/components/app-shell-execution-route-actions.js";

describe("execution route actions", () => {
  it("selects a route with an optional exact account", async () => {
    const input = {
      selectExecutionRoute: vi.fn(() => true),
      readFailure: vi.fn(() => null),
      waitForRoute: vi.fn(async () => undefined),
    };

    await createExecutionRoutePickerActions(input).onSelectRoute("terra", "work");

    expect(input.selectExecutionRoute).toHaveBeenCalledWith("terra", "work");
  });
});
