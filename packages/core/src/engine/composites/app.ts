// Engine composite: App -- top-level deployment unit
// Composes teams and their runtime policy into a deployable application

import type { Trigger } from "../domain/trigger.js";
import { validateTrigger } from "../domain/trigger.js";
import type { Team } from "./team.js";
import type { Router } from "./router.js";
import { validateTeam } from "./team.js";
import { validateRouter } from "./router.js";
import type { McpConfig } from "../domain/mcp-config.js";
import { validateMcpConfig } from "../domain/mcp-config.js";
import type { VoiceConfig } from "../domain/speech-config.js";
import { validateVoiceConfig } from "../domain/speech-config.js";
import type { SafetyConfig } from "../domain/safety-config.js";
import { validateSafetyConfig } from "../domain/safety-config.js";
import type { RuntimeModeConfig } from "../gateway/runtime-mode-config.js";

/** Top-level deployment unit: teams + fallback routing + runtime policy */
export interface App {
  readonly name: string;
  readonly teams: Record<string, Team>;
  readonly router: Router;
  readonly triggers?: readonly Trigger[];
  readonly mcp?: McpConfig;
  readonly voice?: VoiceConfig;
  readonly safety?: SafetyConfig;
  readonly runtimeModeConfig?: RuntimeModeConfig;
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

  if (app.router.fallback && !app.teams[app.router.fallback]) {
    errors.push({
      field: "router.fallback",
      message: `references unknown team "${app.router.fallback}"`,
    });
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

  // MCP validation
  if (app.mcp) {
    const mcpErrors = validateMcpConfig(app.mcp);
    for (const e of mcpErrors) {
      errors.push({ field: `mcp.${e.field}`, message: e.message });
    }
  }

  // Voice validation
  if (app.voice) {
    const voiceErrors = validateVoiceConfig(app.voice);
    for (const e of voiceErrors) {
      errors.push({ field: e.field, message: e.message });
    }
    for (const [teamName, team] of Object.entries(app.teams)) {
      for (const [agentName, agent] of Object.entries(team.agents)) {
        if (agent.voiceProfile && !app.voice.ttsProfiles?.[agent.voiceProfile]) {
          errors.push({
            field: `teams.${teamName}.agents.${agentName}.voiceProfile`,
            message: `references unknown voice.ttsProfiles entry "${agent.voiceProfile}"`,
          });
        }
      }
    }
  }

  // Safety validation
  if (app.safety) {
    const safetyErrors = validateSafetyConfig(app.safety);
    for (const e of safetyErrors) {
      errors.push({ field: `safety.${e.field}`, message: e.message });
    }
  }

  return errors;
}
