import { describe, it, expect } from "vitest";
import type { Team, QualityGate, TeamKnowledge } from "../../../src/engine/composites/team.js";
import { validateTeam } from "../../../src/engine/composites/team.js";
import type { Agent } from "../../../src/engine/domain/agent.js";
import type { Capability } from "../../../src/engine/domain/capability.js";
import type { Workflow } from "../../../src/engine/domain/workflow.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: "worker",
    tier: "coding",
    tools: ["code_edit"],
    ...overrides,
  };
}

function makeCapability(name = "code_edit"): Capability {
  return {
    name,
    description: `${name} tool`,
    schema: {},
    tags: ["coding"],
  };
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    phases: ["implement", "verify"],
    gates: { verify: { requires: ["tests_pass"] } },
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    name: "development",
    agents: { worker: makeAgent() },
    workflow: makeWorkflow(),
    capabilities: [makeCapability()],
    qualityGates: [{ name: "test", command: "vitest run", description: "Run tests", required: true }],
    ...overrides,
  };
}

describe("Team composite", () => {
  describe("interface conformance", () => {
    it("accepts a valid Team", () => {
      const team = makeTeam();
      expect(team.name).toBe("development");
      expect(Object.keys(team.agents)).toHaveLength(1);
      expect(team.workflow.phases).toHaveLength(2);
      expect(team.capabilities).toHaveLength(1);
      expect(team.qualityGates).toHaveLength(1);
    });

    it("supports optional knowledge field", () => {
      const knowledge: TeamKnowledge = {
        documents: ["docs/guide.md"],
        examples: ["examples/hello.ts"],
      };
      const team = makeTeam({ knowledge });
      expect(team.knowledge?.documents).toHaveLength(1);
      expect(team.knowledge?.examples).toHaveLength(1);
    });

    it("supports multiple agents", () => {
      const team = makeTeam({
        agents: {
          architect: makeAgent({ name: "architect", tier: "reasoning", tools: [] }),
          worker: makeAgent({ name: "worker", tier: "coding", tools: ["code_edit"] }),
          optimizer: makeAgent({ name: "optimizer", tier: "fast", tools: [] }),
        },
      });
      expect(Object.keys(team.agents)).toHaveLength(3);
    });

    it("supports QualityGate required field", () => {
      const gate: QualityGate = {
        name: "lint",
        command: "biome check",
        description: "Lint code",
        required: false,
      };
      expect(gate.required).toBe(false);
    });
  });

  describe("validateTeam", () => {
    it("returns empty array for valid team", () => {
      expect(validateTeam(makeTeam())).toEqual([]);
    });

    it("reports empty name", () => {
      const errors = validateTeam(makeTeam({ name: "" }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("name");
    });

    it("reports no agents", () => {
      const errors = validateTeam(makeTeam({ agents: {} }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("agents");
    });

    it("reports empty workflow phases", () => {
      const errors = validateTeam(makeTeam({ workflow: { phases: [], gates: {} } }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("workflow.phases");
    });

    it("reports agent tool referencing unknown capability", () => {
      const team = makeTeam({
        agents: { worker: makeAgent({ tools: ["unknown_tool"] }) },
      });
      const errors = validateTeam(team);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("agents.worker.tools");
      expect(errors[0]!.message).toContain("unknown_tool");
    });

    it("reports gate referencing unknown phase", () => {
      const team = makeTeam({
        workflow: {
          phases: ["implement"],
          gates: { nonexistent: { requires: ["check"] } },
        },
      });
      const errors = validateTeam(team);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("workflow.gates.nonexistent");
    });

    it("allows agents with no tools", () => {
      const team = makeTeam({
        agents: { architect: makeAgent({ tools: [] }) },
      });
      expect(validateTeam(team)).toEqual([]);
    });

    it("accumulates multiple errors", () => {
      const team = makeTeam({
        name: "",
        agents: {},
        workflow: makeWorkflow({ phases: [] }),
      });
      const errors = validateTeam(team);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
