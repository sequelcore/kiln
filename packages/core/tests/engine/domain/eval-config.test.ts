// Tests for validateEvalConfig

import { describe, it, expect } from "vitest";
import { validateEvalConfig } from "../../../src/engine/domain/eval-config.js";
import type { EvalConfig, EvalScorerType } from "../../../src/engine/domain/eval-config.js";

function validConfig(): EvalConfig {
  return {
    datasets: [{ name: "ds1", path: "./data.jsonl" }],
    scorers: [{ name: "sc1", type: "exact-match" }],
    experiments: [{ name: "exp1", dataset: "ds1", team: "team1", scorers: ["sc1"] }],
  };
}

describe("validateEvalConfig", () => {
  it("returns empty array for valid config", () => {
    expect(validateEvalConfig(validConfig())).toEqual([]);
  });

  it("errors when datasets is empty", () => {
    const config = { ...validConfig(), datasets: [] };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "datasets")).toBe(true);
  });

  it("errors on duplicate dataset names", () => {
    const config = {
      ...validConfig(),
      datasets: [
        { name: "ds1", path: "./a.jsonl" },
        { name: "ds1", path: "./b.jsonl" },
      ],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.message === "duplicate dataset name")).toBe(true);
  });

  it("errors on missing dataset name", () => {
    const config = { ...validConfig(), datasets: [{ name: "", path: "./a.jsonl" }] };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "datasets[0].name")).toBe(true);
  });

  it("errors on missing dataset path", () => {
    const config = { ...validConfig(), datasets: [{ name: "ds1", path: "" }] };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "datasets[0].path")).toBe(true);
  });

  it("errors when scorers is empty", () => {
    const config = { ...validConfig(), scorers: [] };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "scorers")).toBe(true);
  });

  it("errors on invalid scorer type", () => {
    const config = {
      ...validConfig(),
      scorers: [{ name: "sc1", type: "invalid" as unknown as EvalScorerType }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "scorers[0].type")).toBe(true);
  });

  it("errors on duplicate scorer names", () => {
    const config = {
      ...validConfig(),
      scorers: [
        { name: "sc1", type: "exact-match" as const },
        { name: "sc1", type: "contains" as const, substrings: ["a"] },
      ],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.message === "duplicate scorer name")).toBe(true);
  });

  it("errors on composite scorer without scorers array", () => {
    const config = {
      ...validConfig(),
      scorers: [{ name: "sc1", type: "composite" as const }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "scorers[0].scorers")).toBe(true);
  });

  it("errors on custom-prompt scorer without prompt", () => {
    const config = {
      ...validConfig(),
      scorers: [{ name: "sc1", type: "custom-prompt" as const }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "scorers[0].prompt")).toBe(true);
  });

  it("errors on contains scorer without substrings", () => {
    const config = {
      ...validConfig(),
      scorers: [{ name: "sc1", type: "contains" as const }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "scorers[0].substrings")).toBe(true);
  });

  it("errors when length minLength >= maxLength", () => {
    const config = {
      ...validConfig(),
      scorers: [{ name: "sc1", type: "length" as const, minLength: 100, maxLength: 50 }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "scorers[0].minLength" && e.message.includes("less than"))).toBe(true);
  });

  it("errors when latency maxLatencyMs <= 0", () => {
    const config = {
      ...validConfig(),
      scorers: [{ name: "sc1", type: "latency" as const, maxLatencyMs: -1 }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "scorers[0].maxLatencyMs")).toBe(true);
  });

  it("errors when cost maxCostUsd <= 0", () => {
    const config = {
      ...validConfig(),
      scorers: [{ name: "sc1", type: "cost" as const, maxCostUsd: 0 }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "scorers[0].maxCostUsd")).toBe(true);
  });

  it("errors when experiments is empty", () => {
    const config = { ...validConfig(), experiments: [] };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "experiments")).toBe(true);
  });

  it("errors on duplicate experiment names", () => {
    const config = {
      ...validConfig(),
      experiments: [
        { name: "exp1", dataset: "ds1", team: "t1", scorers: ["sc1"] },
        { name: "exp1", dataset: "ds1", team: "t1", scorers: ["sc1"] },
      ],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.message === "duplicate experiment name")).toBe(true);
  });

  it("errors when experiment references unknown dataset", () => {
    const config = {
      ...validConfig(),
      experiments: [{ name: "exp1", dataset: "nonexistent", team: "t1", scorers: ["sc1"] }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "experiments[0].dataset" && e.message.includes("unknown"))).toBe(true);
  });

  it("errors when experiment references unknown scorer", () => {
    const config = {
      ...validConfig(),
      experiments: [{ name: "exp1", dataset: "ds1", team: "t1", scorers: ["nonexistent"] }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "experiments[0].scorers[0]" && e.message.includes("unknown"))).toBe(true);
  });

  it("errors when experiment compares to itself", () => {
    const config = {
      ...validConfig(),
      experiments: [{ name: "exp1", dataset: "ds1", team: "t1", scorers: ["sc1"], compare: "exp1" }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "experiments[0].compare" && e.message.includes("itself"))).toBe(true);
  });

  it("errors when experiment compare references unknown experiment", () => {
    const config = {
      ...validConfig(),
      experiments: [{ name: "exp1", dataset: "ds1", team: "t1", scorers: ["sc1"], compare: "nonexistent" }],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.field === "experiments[0].compare" && e.message.includes("unknown"))).toBe(true);
  });

  it("errors on circular compare references (A -> B -> A)", () => {
    const config = {
      ...validConfig(),
      experiments: [
        { name: "expA", dataset: "ds1", team: "t1", scorers: ["sc1"], compare: "expB" },
        { name: "expB", dataset: "ds1", team: "t1", scorers: ["sc1"], compare: "expA" },
      ],
    };
    const errors = validateEvalConfig(config);
    expect(errors.some((e) => e.message.includes("circular compare"))).toBe(true);
  });
});
