import { describe, expect, it, vi } from "vitest";
import { createExecutionRoutePickerActions } from "../src/components/app-shell-execution-route-actions.js";

describe("execution target actions", () => {
  it("selects a route with an optional exact account", async () => {
    const input = {
      selectExecutionRoute: vi.fn(() => true),
      waitForRoute: vi.fn(async () => undefined),
    };

    await expect(createExecutionRoutePickerActions(input).onSelectRoute("terra", "work")).resolves.toEqual({
      status: "selected",
    });

    expect(input.selectExecutionRoute).toHaveBeenCalledWith("terra", "work");
  });

  it("returns a visible failure outcome instead of rejecting the event handler", async () => {
    const input = {
      selectExecutionRoute: vi.fn(() => true),
      waitForRoute: vi.fn(async () => {
        throw new Error("Selected account is unavailable.");
      }),
    };

    await expect(createExecutionRoutePickerActions(input).onSelectRoute("terra")).resolves.toEqual({
      status: "failed",
    });
  });
});
