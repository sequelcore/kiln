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

/** Team execution mode */
export type TeamMode = "sequential" | "supervisor";

/** A self-contained unit: agents + workflow + capabilities + gates */
export interface Team {
  readonly name: string;
  readonly mode?: TeamMode;
  readonly manager?: string;
  readonly agents: Record<string, Agent>;
  readonly workflow: Workflow;
  readonly capabilities: readonly Capability[];
  readonly qualityGates: readonly QualityGate[];
}

/** Validation error for team configuration */
export interface TeamValidationError {
  readonly field: string;
  readonly message: string;
}

/** Valid team modes */
const VALID_MODES: readonly TeamMode[] = ["sequential", "supervisor"];

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

  // Validate mode
  const mode = team.mode ?? "sequential";
  if (!VALID_MODES.includes(mode)) {
    errors.push({ field: "mode", message: `must be one of: ${VALID_MODES.join(", ")}` });
  }

  // Supervisor mode: manager must exist in agents
  if (mode === "supervisor") {
    if (!team.manager || typeof team.manager !== "string") {
      errors.push({ field: "manager", message: "required when mode is 'supervisor'" });
    } else if (!team.agents[team.manager]) {
      errors.push({
        field: "manager",
        message: `agent "${team.manager}" not found in agents`,
      });
    }
  }

  // Manager field only valid with supervisor mode
  if (team.manager && mode !== "supervisor") {
    errors.push({ field: "manager", message: "only valid when mode is 'supervisor'" });
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

  // Capability guardrailRetries must be a positive integer
  for (const cap of team.capabilities) {
    if (cap.guardrailRetries !== undefined) {
      if (!Number.isInteger(cap.guardrailRetries) || cap.guardrailRetries < 1) {
        errors.push({
          field: `capabilities.${cap.name}.guardrailRetries`,
          message: "must be a positive integer",
        });
      }
    }
    if (cap.outputSchema !== undefined) {
      if (typeof cap.outputSchema !== "object" || cap.outputSchema === null || Array.isArray(cap.outputSchema)) {
        errors.push({
          field: `capabilities.${cap.name}.outputSchema`,
          message: "must be a valid object",
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
