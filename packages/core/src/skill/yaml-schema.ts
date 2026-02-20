import type { YamlValidationError } from "../domain/yaml-schema.js";

// Re-export for consumers of the skill module
export type { YamlValidationError };

/** Trigger as expressed in YAML */
export interface SkillTriggerYaml {
  readonly event: string;
  readonly filter?: Record<string, unknown>;
}

/** Skill config as expressed in YAML */
export interface SkillYaml {
  readonly name: string;
  readonly description: string;
  readonly tools?: readonly string[];
  readonly triggers?: readonly SkillTriggerYaml[];
  readonly tags?: readonly string[];
  readonly instructions: string;
  readonly handler?: string;
}

const REQUIRED_FIELDS = ["name", "description", "instructions"] as const;

/** Validate a parsed YAML object against the SkillYaml schema */
export function validateSkillYaml(
  data: unknown,
  filePath?: string,
): YamlValidationError[] {
  const errors: YamlValidationError[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push({ field: "(root)", message: "Expected an object", filePath });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) {
      errors.push({ field, message: `Missing required field "${field}"`, filePath });
    }
  }

  // Type checks for present fields
  if ("name" in obj && typeof obj.name !== "string") {
    errors.push({ field: "name", message: `Expected string, got ${typeof obj.name}`, filePath });
  }
  if ("description" in obj && typeof obj.description !== "string") {
    errors.push({ field: "description", message: `Expected string, got ${typeof obj.description}`, filePath });
  }
  if ("instructions" in obj && typeof obj.instructions !== "string") {
    errors.push({ field: "instructions", message: `Expected string, got ${typeof obj.instructions}`, filePath });
  }
  if ("handler" in obj && typeof obj.handler !== "string") {
    errors.push({ field: "handler", message: `Expected string, got ${typeof obj.handler}`, filePath });
  }

  // tools: optional array of strings
  if ("tools" in obj) {
    if (!Array.isArray(obj.tools)) {
      errors.push({ field: "tools", message: `Expected array, got ${typeof obj.tools}`, filePath });
    } else {
      for (let i = 0; i < obj.tools.length; i++) {
        if (typeof obj.tools[i] !== "string") {
          errors.push({ field: `tools[${i}]`, message: `Expected string, got ${typeof obj.tools[i]}`, filePath });
        }
      }
    }
  }

  // tags: optional array of strings
  if ("tags" in obj) {
    if (!Array.isArray(obj.tags)) {
      errors.push({ field: "tags", message: `Expected array, got ${typeof obj.tags}`, filePath });
    } else {
      for (let i = 0; i < obj.tags.length; i++) {
        if (typeof obj.tags[i] !== "string") {
          errors.push({ field: `tags[${i}]`, message: `Expected string, got ${typeof obj.tags[i]}`, filePath });
        }
      }
    }
  }

  // triggers: optional array of objects with event=string
  if ("triggers" in obj) {
    if (!Array.isArray(obj.triggers)) {
      errors.push({ field: "triggers", message: `Expected array, got ${typeof obj.triggers}`, filePath });
    } else {
      for (let i = 0; i < obj.triggers.length; i++) {
        const trigger = obj.triggers[i];
        if (typeof trigger !== "object" || trigger === null || Array.isArray(trigger)) {
          errors.push({ field: `triggers[${i}]`, message: "Expected an object", filePath });
        } else {
          const t = trigger as Record<string, unknown>;
          if (!("event" in t)) {
            errors.push({ field: `triggers[${i}].event`, message: `Missing required field "event"`, filePath });
          } else if (typeof t.event !== "string") {
            errors.push({ field: `triggers[${i}].event`, message: `Expected string, got ${typeof t.event}`, filePath });
          }
        }
      }
    }
  }

  return errors;
}
