// Preset loader: bridges App (YAML) -> OrchestratorConfig
// Extracts workflow, agent counts, and gate configuration from a team

import type { App } from "../composites/app.js";
import type { Team } from "../composites/team.js";
import type { OrchestratorConfig } from "../../orchestrator/index.js";

/** Error thrown when preset loading fails */
export class PresetLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetLoaderError";
  }
}

/**
 * Load an OrchestratorConfig from a parsed App, targeting a specific team.
 * If no team name is given, uses the router's fallback team.
 */
export function loadPresetConfig(app: App, teamName?: string): OrchestratorConfig {
  const resolvedTeam = teamName ?? app.router.fallback;
  const team = app.teams[resolvedTeam];
  if (!team) {
    const available = Object.keys(app.teams).join(", ");
    throw new PresetLoaderError(
      `Team "${resolvedTeam}" not found in app "${app.name}". Available: ${available}`,
    );
  }

  return teamToConfig(team);
}

/** Extract OrchestratorConfig from a single Team composite */
function teamToConfig(team: Team): OrchestratorConfig {
  const workflow = team.workflow;

  // Find the phase that requires human_approval (if any)
  let approvalAfterPhase: string | undefined;
  for (const [phaseName, gate] of Object.entries(workflow.gates)) {
    if (gate.requires.includes("human_approval")) {
      approvalAfterPhase = phaseName;
      break;
    }
  }

  // Sum parallel worker count from all coding-tier agents with count > 1
  let parallelWorkers = 2; // default
  for (const agent of Object.values(team.agents)) {
    if (agent.tier === "coding" && agent.count && agent.count > 1) {
      parallelWorkers = agent.count;
    }
  }

  return {
    requireApproval: approvalAfterPhase !== undefined,
    approvalAfterPhase,
    phases: workflow.phases,
    maxIterations: workflow.maxIterations ?? 3,
    maxDepth: 3,
    parallelWorkers,
  };
}
