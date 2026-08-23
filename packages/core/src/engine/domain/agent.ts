// Engine primitive: Agent -- a persona with expertise
// Ehrlich #6: domain-agnostic config (tiers, not hardcoded roles)

/** Agent tier determines model class and capabilities */
export type AgentTier = "reasoning" | "coding" | "fast";

/** Agent identity model -- a persona with expertise, not a config blob */
export interface Agent {
  readonly name: string;          // Persona name (e.g., "Aria", "Marcus")
  readonly role: string;          // Expertise / function (e.g., "Senior Architect")
  readonly goal: string;          // What this agent is trying to achieve
  readonly backstory?: string;    // Personality, perspective, behavioral boundaries
  readonly tier: AgentTier;       // Model class
  readonly tools: readonly string[];  // Capability references (can be [])
  readonly instructions?: string; // Operating rules and constraints
  readonly voiceProfile?: string; // Optional governed TTS profile reference
}
