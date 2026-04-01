import type { HookEvent, HookHandler, HookRule, KilnHooksConfig } from "../kiln-yaml-types.js";

export class HookRegistry {
  private readonly rules: Map<HookEvent, readonly HookRule[]>;

  constructor(config: KilnHooksConfig) {
    this.rules = new Map<HookEvent, readonly HookRule[]>();
    this.initRules(config);
  }

  private initRules(config: KilnHooksConfig): void {
    if (config.PreToolUse) this.rules.set("PreToolUse", config.PreToolUse);
    if (config.PostToolUse) this.rules.set("PostToolUse", config.PostToolUse);
    if (config.UserPromptSubmit) this.rules.set("UserPromptSubmit", config.UserPromptSubmit);
    if (config.SessionStart) this.rules.set("SessionStart", config.SessionStart);
    if (config.SessionEnd) this.rules.set("SessionEnd", config.SessionEnd);
    if (config.SubagentStart) this.rules.set("SubagentStart", config.SubagentStart);
    if (config.SubagentStop) this.rules.set("SubagentStop", config.SubagentStop);
  }

  hasHooks(event: HookEvent): boolean {
    return this.rules.has(event);
  }

  getRules(event: HookEvent, toolName?: string): readonly HookHandler[] {
    const rules = this.rules.get(event);
    if (!rules) return [];

    const handlers: HookHandler[] = [];
    for (const rule of rules) {
      if (!rule.matcher || !toolName) {
        handlers.push(...rule.hooks);
      } else if (this.matchesGlob(rule.matcher, toolName)) {
        handlers.push(...rule.hooks);
      }
    }
    return handlers;
  }

  private matchesGlob(pattern: string, value: string): boolean {
    const parts = pattern.split("*");
    if (parts.length === 1) return pattern === value;

    let pos = 0;
    for (const part of parts) {
      if (part === "") continue;
      const idx = value.indexOf(part, pos);
      if (idx === -1) return false;
      pos = idx + part.length;
    }
    return true;
  }
}
