// Engine primitive: Agent -- a configured LLM instance
// Ehrlich #6: domain-agnostic config (tiers, not hardcoded roles)

/** Agent tier determines model class and capabilities */
export type AgentTier = "reasoning" | "coding" | "fast";

/** A configured LLM instance with a role, model tier, and tool access policy */
export interface Agent {
  readonly name: string;
  readonly tier: AgentTier;
  readonly tools: readonly string[];
  readonly systemPrompt?: string;
  readonly structured?: boolean;
  readonly count?: number;
  readonly sandbox?: boolean;
}
