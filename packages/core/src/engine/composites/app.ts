// Engine composite: App -- top-level deployment unit
// Composes teams, router, memory, and channels into a deployable application

import type { MemoryScope } from "../domain/memory.js";
import type { Trigger } from "../domain/trigger.js";
import { validateTrigger } from "../domain/trigger.js";
import type { Team } from "./team.js";
import type { Router } from "./router.js";
import { validateTeam } from "./team.js";
import { validateRouter } from "./router.js";

/** Memory configuration for an App */
export interface MemoryConfig {
  readonly scopes: readonly MemoryScope[];
  readonly backend: string;
  readonly sync?: string;
}

/** Top-level deployment unit: teams + router + memory + channels */
export interface App {
  readonly name: string;
  readonly teams: Record<string, Team>;
  readonly router: Router;
  readonly memory: MemoryConfig;
  readonly channels: readonly string[];
  readonly triggers?: readonly Trigger[];
}

/** Validation error for app configuration */
export interface AppValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate an App composite configuration */
export function validateApp(app: App): AppValidationError[] {
  const errors: AppValidationError[] = [];

  if (!app.name || typeof app.name !== "string") {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  const teamNames = Object.keys(app.teams);
  if (teamNames.length === 0) {
    errors.push({ field: "teams", message: "must have at least one team" });
  }

  if (app.channels.length === 0) {
    errors.push({ field: "channels", message: "must have at least one channel" });
  }

  if (app.router.fallback && !app.teams[app.router.fallback]) {
    errors.push({
      field: "router.fallback",
      message: `references unknown team "${app.router.fallback}"`,
    });
  }

  for (let i = 0; i < app.router.rules.length; i++) {
    const rule = app.router.rules[i]!;
    if (rule.team && !app.teams[rule.team]) {
      errors.push({
        field: `router.rules[${i}].team`,
        message: `references unknown team "${rule.team}"`,
      });
    }
  }

  if (app.memory.scopes.length === 0) {
    errors.push({ field: "memory.scopes", message: "must have at least one scope" });
  }

  for (const [teamName, team] of Object.entries(app.teams)) {
    const teamErrors = validateTeam(team);
    for (const e of teamErrors) {
      errors.push({ field: `teams.${teamName}.${e.field}`, message: e.message });
    }
  }

  const routerErrors = validateRouter(app.router);
  for (const e of routerErrors) {
    errors.push({ field: `router.${e.field}`, message: e.message });
  }

  // Trigger validation
  if (app.triggers) {
    const triggerNames = new Set<string>();
    const webhookPaths = new Set<string>();

    for (let i = 0; i < app.triggers.length; i++) {
      const trigger = app.triggers[i]!;

      // Validate each trigger via validateTrigger
      const triggerErrors = validateTrigger(trigger, teamNames);
      for (const e of triggerErrors) {
        errors.push({ field: `triggers[${i}].${e.field}`, message: e.message });
      }

      // Check trigger names are unique
      if (trigger.name) {
        if (triggerNames.has(trigger.name)) {
          errors.push({ field: `triggers[${i}].name`, message: `duplicate trigger name "${trigger.name}"` });
        }
        triggerNames.add(trigger.name);
      }

      // Check webhook paths are unique
      if (trigger.type === "webhook" && trigger.path) {
        if (webhookPaths.has(trigger.path)) {
          errors.push({ field: `triggers[${i}].path`, message: `duplicate webhook path "${trigger.path}"` });
        }
        webhookPaths.add(trigger.path);
      }
    }
  }

  return errors;
}
