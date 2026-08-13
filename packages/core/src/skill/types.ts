import type { EventType } from "../events/index.js";

/** Trigger condition: a skill activates when an event matches */
export interface SkillTrigger {
  readonly event: EventType;
  readonly filter?: Record<string, unknown>;
}

/** Lightweight index entry — loaded at discovery time (progressive disclosure) */
export interface SkillIndex {
  readonly name: string;
  readonly description: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly tools: readonly string[];
  readonly triggers: readonly SkillTrigger[];
  readonly tags: readonly string[];
  readonly handler?: string;
  readonly filePath: string;
}

/** Full skill config — loaded on activation. Body is the markdown instructions. */
export interface SkillConfig extends SkillIndex {
  readonly instructions: string;
}
