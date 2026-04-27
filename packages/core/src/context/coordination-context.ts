import type { ContextCandidate } from "./projected-context.js";

export interface CoordinationContextCandidateOptions {
  readonly score?: number;
  readonly required?: boolean;
}

export interface CoordinationCrossAgentMemoryEntry {
  readonly id: string;
  readonly agentId: string;
  readonly role: string;
  readonly summary: string;
  readonly updatedAt: string;
}

export interface CoordinationSwarmMember {
  readonly agentId: string;
  readonly role: string;
  readonly status: string;
}

export interface CoordinationSwarmState {
  readonly swarmId: string;
  readonly objective: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly members: readonly CoordinationSwarmMember[];
}

export interface CoordinationContextState {
  readonly crossAgentMemory?: readonly CoordinationCrossAgentMemoryEntry[];
  readonly swarmState?: CoordinationSwarmState;
}

const DEFAULT_COORDINATION_CONTEXT_SCORE = 0.7;

export function coordinationStateToContextCandidates(
  state: CoordinationContextState,
  options?: CoordinationContextCandidateOptions,
): ContextCandidate[] {
  const score = options?.score ?? DEFAULT_COORDINATION_CONTEXT_SCORE;
  const required = options?.required ?? false;
  const candidates: ContextCandidate[] = [];

  const crossAgentMemory = [...(state.crossAgentMemory ?? [])]
    .sort((left, right) => (
      left.updatedAt.localeCompare(right.updatedAt)
      || left.role.localeCompare(right.role)
      || left.agentId.localeCompare(right.agentId)
      || left.id.localeCompare(right.id)
    ));
  for (const entry of crossAgentMemory) {
    candidates.push({
      kind: "coordination",
      source: `runtime-cross-agent-memory:${entry.id}`,
      content: [
        "Cross-agent memory",
        `id: ${entry.id}`,
        `agent: ${entry.role}(${entry.agentId})`,
        `updatedAt: ${entry.updatedAt}`,
        `summary: ${entry.summary}`,
      ].join("\n"),
      score,
      required,
    });
  }

  if (state.swarmState) {
    const members = [...state.swarmState.members]
      .sort((left, right) => (
        left.role.localeCompare(right.role)
        || left.agentId.localeCompare(right.agentId)
      ));
    candidates.push({
      kind: "coordination",
      source: `runtime-swarm-state:${state.swarmState.swarmId}`,
      content: [
        "Swarm state",
        `id: ${state.swarmState.swarmId}`,
        `objective: ${state.swarmState.objective}`,
        `status: ${state.swarmState.status}`,
        `updatedAt: ${state.swarmState.updatedAt}`,
      ].join("\n"),
      score,
      required,
    });
    for (const member of members) {
      candidates.push({
        kind: "coordination",
        source: `runtime-swarm-member:${state.swarmState.swarmId}:${member.agentId}`,
        content: [
          "Swarm member",
          `swarmId: ${state.swarmState.swarmId}`,
          `agent: ${member.role}(${member.agentId})`,
          `status: ${member.status}`,
        ].join("\n"),
        score,
        required,
      });
    }
  }

  return candidates;
}
