import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { KilnError } from "../engine/errors.js";
import type { SkillConfig } from "./types.js";
import type { SkillYaml } from "./yaml-schema.js";
import { validateSkillYaml } from "./yaml-schema.js";
import type { EventType } from "../events/index.js";
import { EVENT_LEVEL_MAP } from "../events/index.js";

const VALID_EVENT_TYPES = new Set<string>(Object.keys(EVENT_LEVEL_MAP));

export class SkillYamlError extends KilnError {
  readonly errors: readonly { field: string; message: string }[];
  readonly filePath?: string;

  constructor(
    errors: readonly { field: string; message: string }[],
    filePath?: string,
  ) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super("SKILL_YAML_INVALID", `Invalid skill YAML${filePath ? ` (${filePath})` : ""}:\n${msg}`, {
      context: { errors, filePath },
      retryable: false,
    });
    this.name = "SkillYamlError";
    this.errors = errors;
    this.filePath = filePath;
  }
}

/** Parse a YAML string into a validated SkillConfig */
export function parseSkillYaml(content: string, filePath?: string): SkillConfig {
  const data = parse(content) as unknown;
  const errors = validateSkillYaml(data, filePath);
  if (errors.length > 0) throw new SkillYamlError(errors, filePath);

  // Safe cast: validation above confirmed the required shape
  const yaml = data as SkillYaml;

  // Validate trigger event values against known EventType strings
  const triggerErrors: { field: string; message: string }[] = [];
  const rawTriggers = yaml.triggers ?? [];
  for (let i = 0; i < rawTriggers.length; i++) {
    const trigger = rawTriggers[i]!;
    if (!VALID_EVENT_TYPES.has(trigger.event)) {
      triggerErrors.push({
        field: `triggers[${i}].event`,
        message: `Unknown event type "${trigger.event}"`,
      });
    }
  }
  if (triggerErrors.length > 0) throw new SkillYamlError(triggerErrors, filePath);

  return {
    name: yaml.name,
    description: yaml.description,
    tools: yaml.tools ?? [],
    triggers: rawTriggers.map((t) => ({
      event: t.event as EventType,
      ...(t.filter !== undefined ? { filter: t.filter } : {}),
    })),
    tags: yaml.tags ?? [],
    instructions: yaml.instructions,
    ...(yaml.handler !== undefined ? { handler: yaml.handler } : {}),
  };
}

/** Read a YAML file from disk and parse into SkillConfig */
export function loadSkillYaml(filePath: string): SkillConfig {
  const content = readFileSync(filePath, "utf-8");
  return parseSkillYaml(content, filePath);
}
