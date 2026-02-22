// Policy Rails: topic, competitor, escalation, compliance guardrails

import type { RailConfig, TopicRailConfig, CompetitorRailConfig, EscalationRailConfig, ComplianceRailConfig } from "../engine/domain/safety-config.js";
import type { PolicyResult, SafetyDirection } from "./types.js";

/** Interface for a policy rail that evaluates messages */
export interface PolicyRail {
  evaluate(text: string, direction: SafetyDirection): PolicyResult;
}

/** Case-insensitive keyword match against block/escalate arrays */
export class TopicRail implements PolicyRail {
  private readonly config: TopicRailConfig;

  constructor(config: TopicRailConfig) {
    this.config = config;
  }

  evaluate(text: string, _direction: SafetyDirection): PolicyResult {
    const lower = text.toLowerCase();

    // Check blocked topics
    if (this.config.block) {
      for (const topic of this.config.block) {
        if (lower.includes(topic.toLowerCase())) {
          return {
            allowed: false,
            railType: "topic",
            reason: `Blocked topic detected: ${topic}`,
          };
        }
      }
    }

    // Check escalation topics
    if (this.config.escalate) {
      for (const topic of this.config.escalate) {
        if (lower.includes(topic.toLowerCase())) {
          return {
            allowed: true,
            railType: "topic",
            reason: `Escalation topic detected: ${topic}`,
            escalate: true,
          };
        }
      }
    }

    return { allowed: true, railType: "topic" };
  }
}

/** Checks for competitor names in message */
export class CompetitorRail implements PolicyRail {
  private readonly config: CompetitorRailConfig;

  constructor(config: CompetitorRailConfig) {
    this.config = config;
  }

  evaluate(text: string, _direction: SafetyDirection): PolicyResult {
    const lower = text.toLowerCase();

    for (const competitor of this.config.competitors) {
      if (lower.includes(competitor.toLowerCase())) {
        return {
          allowed: false,
          railType: "competitor",
          reason: `Competitor mentioned: ${competitor}`,
          suggestion: this.config.response,
        };
      }
    }

    return { allowed: true, railType: "competitor" };
  }
}

/** Always allowed, but sets escalate flag when triggers match */
export class EscalationRail implements PolicyRail {
  private readonly config: EscalationRailConfig;

  constructor(config: EscalationRailConfig) {
    this.config = config;
  }

  evaluate(text: string, _direction: SafetyDirection): PolicyResult {
    const lower = text.toLowerCase();

    for (const trigger of this.config.triggers) {
      if (lower.includes(trigger.toLowerCase())) {
        return {
          allowed: true,
          railType: "escalation",
          reason: `Escalation trigger detected: ${trigger}`,
          escalate: true,
        };
      }
    }

    return { allowed: true, railType: "escalation" };
  }
}

/** On output: checks required present + forbid absent. On input: always allowed */
export class ComplianceRail implements PolicyRail {
  private readonly config: ComplianceRailConfig;

  constructor(config: ComplianceRailConfig) {
    this.config = config;
  }

  evaluate(text: string, direction: SafetyDirection): PolicyResult {
    // Compliance only applies to output
    if (direction === "input") {
      return { allowed: true, railType: "compliance" };
    }

    // Check forbidden phrases
    if (this.config.forbid) {
      const lower = text.toLowerCase();
      for (const phrase of this.config.forbid) {
        if (lower.includes(phrase.toLowerCase())) {
          return {
            allowed: false,
            railType: "compliance",
            reason: `Forbidden phrase detected: ${phrase}`,
          };
        }
      }
    }

    // Check required phrases
    if (this.config.required) {
      const lower = text.toLowerCase();
      for (const phrase of this.config.required) {
        if (!lower.includes(phrase.toLowerCase())) {
          return {
            allowed: false,
            railType: "compliance",
            reason: `Required phrase missing: ${phrase}`,
            suggestion: `Include: "${phrase}"`,
          };
        }
      }
    }

    return { allowed: true, railType: "compliance" };
  }
}

/** Factory: creates the appropriate rail from config */
export function createRail(config: RailConfig): PolicyRail {
  switch (config.type) {
    case "topic":
      return new TopicRail(config);
    case "competitor":
      return new CompetitorRail(config);
    case "escalation":
      return new EscalationRail(config);
    case "compliance":
      return new ComplianceRail(config);
  }
}
