import { describe, expect, it, vi } from "vitest";
import { createExecutionTargetPickerActions } from "../src/components/app-shell-execution-target-actions.js";

describe("execution target actions", () => {
  it("selects a target with an optional account override", async () => {
    const input = {
      selectExecutionTarget: vi.fn(() => true),
      waitForTarget: vi.fn(async () => undefined),
    };

    await expect(createExecutionTargetPickerActions(input).onSelectTarget("terra", "work")).resolves.toEqual({
      status: "selected",
    });

    expect(input.selectExecutionTarget).toHaveBeenCalledWith("terra", "work");
  });

  it("returns a visible failure outcome instead of rejecting the event handler", async () => {
    const input = {
      selectExecutionTarget: vi.fn(() => true),
      waitForTarget: vi.fn(async () => {
        throw new Error("Selected account is unavailable.");
      }),
    };

    await expect(createExecutionTargetPickerActions(input).onSelectTarget("terra")).resolves.toEqual({
      status: "failed",
    });
  });
});
