import type { EventType } from "../events/index.js";

/** Trigger condition: a skill activates when an event matches */
export interface SkillTrigger {
  readonly event: EventType;
  readonly filter?: Record<string, unknown>;
}

/** Skill configuration (runtime form) */
export interface SkillConfig {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly triggers: readonly SkillTrigger[];
  readonly tags: readonly string[];
  readonly instructions: string;
  readonly handler?: string; // optional TS handler file path
}
