import { describe, it, expect } from "vitest";
import type { Workflow, Gate } from "../../src/engine/domain/workflow.js";

describe("Workflow interface", () => {
  it("accepts a valid Temper-style 6-phase workflow with gates", () => {
    const workflow: Workflow = {
      phases: ["Analyze", "Research", "Architect", "Implement", "Verify", "Synthesize"],
      gates: {
        Architect: { requires: ["tests_pass", "lint_clean"] },
        Verify: { requires: ["type_check", "coverage_80"] },
      },
    };
    expect(workflow.phases).toHaveLength(6);
    expect(workflow.phases[0]).toBe("Analyze");
    expect(workflow.gates["Architect"].requires).toContain("tests_pass");
    expect(workflow.gates["Verify"].requires).toContain("coverage_80");
  });

  it("accepts a valid Ehrlich-style 6-phase workflow with different phases", () => {
    const workflow: Workflow = {
      phases: ["Hypothesize", "Literature", "Design", "Experiment", "Analyze", "Report"],
      gates: {
        Experiment: { requires: ["protocol_approved", "data_validated"] },
        Report: { requires: ["statistical_significance"] },
      },
    };
    expect(workflow.phases).toHaveLength(6);
    expect(workflow.phases[1]).toBe("Literature");
    expect(workflow.gates["Report"].requires).toContain("statistical_significance");
  });

  it("accepts a minimal 2-phase workflow (Artu-style)", () => {
    const workflow: Workflow = {
      phases: ["Listen", "Respond"],
      gates: {},
    };
    expect(workflow.phases).toHaveLength(2);
    expect(Object.keys(workflow.gates)).toHaveLength(0);
  });

  it("accepts a gate with multiple requires", () => {
    const gate: Gate = {
      requires: ["tests_pass", "lint_clean", "type_check", "coverage_80", "no_security_issues"],
    };
    expect(gate.requires).toHaveLength(5);
    expect(gate.requires[2]).toBe("type_check");
  });

  it("accepts an empty gates record (no gates between phases)", () => {
    const workflow: Workflow = {
      phases: ["Plan", "Execute", "Review"],
      gates: {},
    };
    expect(workflow.gates).toEqual({});
    expect(workflow.phases).toHaveLength(3);
  });

  it("treats maxIterations as optional", () => {
    const withoutMax: Workflow = {
      phases: ["Analyze", "Implement", "Verify"],
      gates: {},
    };
    expect(withoutMax.maxIterations).toBeUndefined();

    const withMax: Workflow = {
      phases: ["Analyze", "Implement", "Verify"],
      gates: {},
      maxIterations: 5,
    };
    expect(withMax.maxIterations).toBe(5);
  });
});
