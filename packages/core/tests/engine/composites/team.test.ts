import { describe, it, expect } from "vitest";
import type { Team, QualityGate, TeamKnowledge } from "../../../src/engine/composites/team.js";
import { validateTeam } from "../../../src/engine/composites/team.js";
import type { Agent } from "../../../src/engine/domain/agent.js";
import type { Capability } from "../../../src/engine/domain/capability.js";
import type { Workflow } from "../../../src/engine/domain/workflow.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: "Marcus",
    role: "Implementation Specialist",
    goal: "Write clean, well-tested code",
    tier: "coding",
    tools: ["code_edit"],
    ...overrides,
  };
}

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    name: "code_edit",
    description: "code_edit tool",
    schema: {},
    tags: ["coding"],
    ...overrides,
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
          architect: makeAgent({ name: "Aria", role: "Senior Architect", goal: "Design robust solutions", tier: "reasoning", tools: [] }),
          worker: makeAgent({ name: "Marcus", role: "Implementation Specialist", goal: "Write clean code", tier: "coding", tools: ["code_edit"] }),
          optimizer: makeAgent({ name: "Zoe", role: "Performance Optimizer", goal: "Optimize for speed", tier: "fast", tools: [] }),
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

  describe("team mode validation", () => {
    it("accepts sequential mode (default)", () => {
      const team = makeTeam({ mode: "sequential" });
      expect(validateTeam(team)).toEqual([]);
    });

    it("accepts undefined mode (defaults to sequential)", () => {
      const team = makeTeam();
      expect(team.mode).toBeUndefined();
      expect(validateTeam(team)).toEqual([]);
    });

    it("accepts supervisor mode with valid manager", () => {
      const team = makeTeam({
        mode: "supervisor",
        manager: "architect",
        agents: {
          architect: makeAgent({ name: "Aria", role: "Architect", goal: "Design systems", tier: "reasoning", tools: [] }),
          worker: makeAgent({ tools: ["code_edit"] }),
        },
      });
      expect(validateTeam(team)).toEqual([]);
    });

    it("reports supervisor mode without manager", () => {
      const team = makeTeam({ mode: "supervisor" });
      const errors = validateTeam(team);
      expect(errors.some((e) => e.field === "manager" && e.message.includes("required"))).toBe(true);
    });

    it("reports supervisor mode with manager not in agents", () => {
      const team = makeTeam({ mode: "supervisor", manager: "nonexistent" });
      const errors = validateTeam(team);
      expect(errors.some((e) => e.field === "manager" && e.message.includes("not found"))).toBe(true);
    });

    it("reports manager field without supervisor mode", () => {
      const team = makeTeam({ mode: "sequential", manager: "worker" });
      const errors = validateTeam(team);
      expect(errors.some((e) => e.field === "manager" && e.message.includes("only valid"))).toBe(true);
    });

    it("reports unsupported team mode values at the boundary", () => {
      const invalidTeam = {
        ...makeTeam(),
        mode: "swarm",
      } as Team & { mode: "swarm" };

      const errors = validateTeam(invalidTeam as unknown as Team);
      expect(errors.some((e) => e.field === "mode" && e.message.includes("sequential"))).toBe(true);
    });
  });

  describe("capability guardrail validation", () => {
    it("accepts capability with guardrail fields", () => {
      const team = makeTeam({
        capabilities: [makeCapability({ guardrail: "validate_json", guardrailRetries: 3 })],
      });
      expect(validateTeam(team)).toEqual([]);
    });

    it("accepts capability with outputSchema", () => {
      const team = makeTeam({
        capabilities: [makeCapability({ outputSchema: { type: "object", properties: {} } })],
      });
      expect(validateTeam(team)).toEqual([]);
    });

    it("reports invalid guardrailRetries (zero)", () => {
      const team = makeTeam({
        capabilities: [makeCapability({ guardrailRetries: 0 })],
      });
      const errors = validateTeam(team);
      expect(errors.some((e) => e.field.includes("guardrailRetries"))).toBe(true);
    });

    it("reports invalid guardrailRetries (negative)", () => {
      const team = makeTeam({
        capabilities: [makeCapability({ guardrailRetries: -1 })],
      });
      const errors = validateTeam(team);
      expect(errors.some((e) => e.field.includes("guardrailRetries"))).toBe(true);
    });

    it("reports invalid guardrailRetries (non-integer)", () => {
      const team = makeTeam({
        capabilities: [makeCapability({ guardrailRetries: 2.5 })],
      });
      const errors = validateTeam(team);
      expect(errors.some((e) => e.field.includes("guardrailRetries"))).toBe(true);
    });
  });
});
