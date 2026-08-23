// Engine composite: Team -- agents + capabilities
// A self-contained unit that operates independently

import type { Agent } from "../domain/agent.js";
import type { Capability } from "../domain/capability.js";

/** Team execution mode */
export type TeamMode = "sequential" | "supervisor";

/** A self-contained unit: agents + capabilities */
export interface Team {
  readonly name: string;
  readonly mode?: TeamMode;
  readonly manager?: string;
  readonly agents: Record<string, Agent>;
  readonly capabilities: readonly Capability[];
}

/** Validation error for team configuration */
export interface TeamValidationError {
  readonly field: string;
  readonly message: string;
}

/** Valid orchestration modes for programmatically constructed teams. */
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

  const mode = team.mode ?? "sequential";
  if (!VALID_MODES.includes(mode)) {
    errors.push({ field: "mode", message: `must be one of: ${VALID_MODES.join(", ")}` });
  }

  if (mode === "supervisor" && !team.manager) {
    errors.push({ field: "manager", message: "required when mode is 'supervisor'" });
  }

  // The optional manager selects the primary team persona and must name an agent.
  if (team.manager && !team.agents[team.manager]) {
    errors.push({
      field: "manager",
      message: `agent "${team.manager}" not found in agents`,
    });
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

  return errors;
}
