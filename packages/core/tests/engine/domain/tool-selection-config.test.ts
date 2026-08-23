import { describe, it, expect } from "vitest";
import { validateToolSelectionConfig, type ToolSelectionConfig } from "../../../src/engine/domain/tool-selection-config.js";

describe("validateToolSelectionConfig", () => {
  it("valid 'all' strategy passes", () => {
    const config: ToolSelectionConfig = { strategy: "all" };
    expect(validateToolSelectionConfig(config)).toEqual([]);
  });

  it("rejects the deleted 'rag' strategy", () => {
    const config = { strategy: "rag" } as unknown as ToolSelectionConfig;
    const errors = validateToolSelectionConfig(config);
    expect(errors).toContainEqual({ field: "strategy", message: "must be 'all'" });
  });

  it("errors on non-positive maxTools", () => {
    const config: ToolSelectionConfig = { strategy: "all", maxTools: 0 };
    const errors = validateToolSelectionConfig(config);
    expect(errors).toContainEqual({ field: "maxTools", message: "must be a positive number" });
  });

  it("errors on negative maxTools", () => {
    const config: ToolSelectionConfig = { strategy: "all", maxTools: -5 };
    const errors = validateToolSelectionConfig(config);
    expect(errors).toContainEqual({ field: "maxTools", message: "must be a positive number" });
  });

  it("errors on non-positive threshold", () => {
    const config: ToolSelectionConfig = { strategy: "all", threshold: 0 };
    const errors = validateToolSelectionConfig(config);
    expect(errors).toContainEqual({ field: "threshold", message: "must be a positive number" });
  });

  it("errors when maxTools >= threshold", () => {
    const config: ToolSelectionConfig = { strategy: "all", maxTools: 30, threshold: 30 };
    const errors = validateToolSelectionConfig(config);
    expect(errors).toContainEqual({ field: "maxTools", message: "must be less than threshold" });
  });

  it("errors when maxTools > threshold", () => {
    const config: ToolSelectionConfig = { strategy: "all", maxTools: 50, threshold: 30 };
    const errors = validateToolSelectionConfig(config);
    expect(errors).toContainEqual({ field: "maxTools", message: "must be less than threshold" });
  });

  it("valid config with maxTools and threshold passes", () => {
    const config: ToolSelectionConfig = { strategy: "all", maxTools: 15, threshold: 50 };
    expect(validateToolSelectionConfig(config)).toEqual([]);
  });
});
