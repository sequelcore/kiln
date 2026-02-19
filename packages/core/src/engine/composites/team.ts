// Engine composite: Team -- agents + workflow + capabilities + quality gates
// A self-contained unit that operates independently

import type { Agent } from "../domain/agent.js";
import type { Capability } from "../domain/capability.js";
import type { Workflow } from "../domain/workflow.js";

/** A quality gate command that must pass before phase transitions */
export interface QualityGate {
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly required: boolean;
}

/** Reference documents and examples available to team agents */
export interface TeamKnowledge {
  readonly documents: readonly string[];
  readonly examples: readonly string[];
}

/** A self-contained unit: agents + workflow + capabilities + gates */
export interface Team {
  readonly name: string;
  readonly agents: Record<string, Agent>;
  readonly workflow: Workflow;
  readonly capabilities: readonly Capability[];
  readonly qualityGates: readonly QualityGate[];
  readonly knowledge?: TeamKnowledge;
}

/** Validation error for team configuration */
export interface TeamValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate a Team composite configuration */
export function validateTeam(team: Team): TeamValidationError[] {
  const errors: TeamValidationError[] = [];

  if (!team.name || typeof team.name !== "string") {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  // Must have at least one agent
  const agentNames = Object.keys(team.agents);
  if (agentNames.length === 0) {
    errors.push({ field: "agents", message: "must have at least one agent" });
  }

  // Workflow must have at least one phase
  if (team.workflow.phases.length === 0) {
    errors.push({ field: "workflow.phases", message: "must have at least one phase" });
  }

  // Agent tool references must exist in capabilities
  const capabilityNames = new Set(team.capabilities.map((c) => c.name));
  for (const [agentName, agent] of Object.entries(team.agents)) {
    for (const tool of agent.tools) {
      if (!capabilityNames.has(tool)) {
        errors.push({
          field: `agents.${agentName}.tools`,
          message: `references unknown capability "${tool}"`,
        });
      }
    }
  }

  // Gate phase references must exist in workflow phases
  const phaseSet = new Set(team.workflow.phases);
  for (const phaseName of Object.keys(team.workflow.gates)) {
    if (!phaseSet.has(phaseName)) {
      errors.push({
        field: `workflow.gates.${phaseName}`,
        message: `references unknown phase "${phaseName}"`,
      });
    }
  }

  return errors;
}
