// Engine primitive: System prompt assembler -- pure function, zero dependencies
// Assembles system prompts from Agent identity fields + team context

import type { Agent } from "./agent.js";

/** Context for assembling agent prompts with team and capability info */
export interface PromptContext {
  readonly teamName?: string;
  readonly teamMode?: string;                 // "sequential" | "supervisor" | "swarm" (future-proof)
  readonly teammates?: readonly { name: string; role: string }[];
  readonly capabilities?: readonly { name: string; description: string }[];
  readonly qualityGates?: readonly { name: string; description: string }[];
}

/**
 * Assemble a system prompt from Agent identity fields + team context.
 * Pure function, zero dependencies.
 *
 * Assembly order:
 * 1. Identity:     "You are {name}, {role}. Your goal: {goal}"
 * 2. Backstory:    "{backstory}" (if provided and non-empty)
 * 3. Instructions: "## Operating Rules\n{instructions}" (if provided and non-empty)
 * 4. Team context: "Team '{teamName}', {mode} mode. Teammates: {name + role for each}" (if context provided)
 * 5. Capabilities: "## Available Tools\n{capability descriptions}" (if capabilities provided)
 * 6. Quality gates: "## Quality Standards\n{gate descriptions}" (if gates provided)
 */
export function assembleAgentPrompt(agent: Agent, context?: PromptContext): string {
  const sections: string[] = [];

  // 1. Identity section (always present)
  sections.push(`You are ${agent.name}, ${agent.role}. Your goal: ${agent.goal}`);

  // 2. Backstory section (optional, skip empty strings)
  if (agent.backstory && agent.backstory.trim() !== "") {
    sections.push(agent.backstory);
  }

  // 3. Instructions section (optional)
  if (agent.instructions) {
    sections.push(`## Operating Rules\n${agent.instructions}`);
  }

  // 4. Team context section (if context provided)
  if (context) {
    const teamParts: string[] = [];
    
    if (context.teamName) {
      const mode = context.teamMode ?? "sequential";
      teamParts.push(`You are part of team '${context.teamName}' in ${mode} mode.`);
    }
    
    if (context.teammates && context.teammates.length > 0) {
      const teammateList = context.teammates
        .map(tm => `${tm.name} (${tm.role})`)
        .join(", ");
      teamParts.push(`Teammates: ${teammateList}`);
    }
    
    if (teamParts.length > 0) {
      sections.push(teamParts.join("\n"));
    }
  }

  // 5. Capabilities section (if provided)
  if (context?.capabilities && context.capabilities.length > 0) {
    const capLines = context.capabilities
      .map(cap => `- ${cap.name}: ${cap.description}`)
      .join("\n");
    sections.push(`## Available Tools\n${capLines}`);
  }

  // 6. Quality gates section (if provided)
  if (context?.qualityGates && context.qualityGates.length > 0) {
    const gateLines = context.qualityGates
      .map(gate => `- ${gate.name}: ${gate.description}`)
      .join("\n");
    sections.push(`## Quality Standards\n${gateLines}`);
  }

  return sections.join("\n\n");
}
