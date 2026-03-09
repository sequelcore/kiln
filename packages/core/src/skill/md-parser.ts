import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { KilnError } from "../engine/errors.js";
import type { SkillConfig, SkillIndex } from "./types.js";
import type { EventType } from "../events/index.js";
import { EVENT_LEVEL_MAP } from "../events/index.js";

const VALID_EVENT_TYPES = new Set<string>(Object.keys(EVENT_LEVEL_MAP));
const FRONTMATTER_DELIMITER = "---";

interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export class SkillMdError extends KilnError {
  readonly errors: readonly ValidationError[];
  readonly filePath?: string;

  constructor(errors: readonly ValidationError[], filePath?: string) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super("SKILL_MD_INVALID", `Invalid SKILL.md${filePath ? ` (${filePath})` : ""}:\n${msg}`, {
      context: { errors, filePath },
      retryable: false,
    });
    this.name = "SkillMdError";
    this.errors = errors;
    this.filePath = filePath;
  }
}

/** Split SKILL.md content into frontmatter YAML and markdown body */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    return { frontmatter: "", body: content };
  }

  const afterFirst = trimmed.slice(FRONTMATTER_DELIMITER.length);
  const endIndex = afterFirst.indexOf(`\n${FRONTMATTER_DELIMITER}`);
  if (endIndex === -1) {
    return { frontmatter: "", body: content };
  }

  const frontmatter = afterFirst.slice(0, endIndex).trim();
  const bodyStart = endIndex + 1 + FRONTMATTER_DELIMITER.length;
  const body = afterFirst.slice(bodyStart).trim();

  return { frontmatter, body };
}

/** Validate frontmatter object and return errors */
function validateFrontmatter(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push({ field: "(root)", message: "Frontmatter must be a YAML object" });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  // Required: name, description
  if (!("name" in obj) || typeof obj.name !== "string" || obj.name.trim() === "") {
    errors.push({ field: "name", message: "Required string field" });
  }
  if (!("description" in obj) || typeof obj.description !== "string" || obj.description.trim() === "") {
    errors.push({ field: "description", message: "Required string field" });
  }

  // Optional: handler (string)
  if ("handler" in obj && typeof obj.handler !== "string") {
    errors.push({ field: "handler", message: `Expected string, got ${typeof obj.handler}` });
  }

  // Optional: tools (string[])
  if ("tools" in obj) {
    if (!Array.isArray(obj.tools)) {
      errors.push({ field: "tools", message: `Expected array, got ${typeof obj.tools}` });
    } else {
      for (let i = 0; i < obj.tools.length; i++) {
        if (typeof obj.tools[i] !== "string") {
          errors.push({ field: `tools[${i}]`, message: `Expected string, got ${typeof obj.tools[i]}` });
        }
      }
    }
  }

  // Optional: tags (string[])
  if ("tags" in obj) {
    if (!Array.isArray(obj.tags)) {
      errors.push({ field: "tags", message: `Expected array, got ${typeof obj.tags}` });
    } else {
      for (let i = 0; i < obj.tags.length; i++) {
        if (typeof obj.tags[i] !== "string") {
          errors.push({ field: `tags[${i}]`, message: `Expected string, got ${typeof obj.tags[i]}` });
        }
      }
    }
  }

  // Optional: triggers (array of {event, filter?})
  if ("triggers" in obj) {
    if (!Array.isArray(obj.triggers)) {
      errors.push({ field: "triggers", message: `Expected array, got ${typeof obj.triggers}` });
    } else {
      for (let i = 0; i < obj.triggers.length; i++) {
        const trigger = obj.triggers[i];
        if (typeof trigger !== "object" || trigger === null || Array.isArray(trigger)) {
          errors.push({ field: `triggers[${i}]`, message: "Expected an object" });
        } else {
          const t = trigger as Record<string, unknown>;
          if (!("event" in t) || typeof t.event !== "string") {
            errors.push({ field: `triggers[${i}].event`, message: "Required string field" });
          }
        }
      }
    }
  }

  return errors;
}

/** Build SkillIndex from validated frontmatter */
function buildIndex(obj: Record<string, unknown>, filePath: string): SkillIndex {
  const rawTriggers = (obj.triggers as Array<Record<string, unknown>> | undefined) ?? [];

  // Validate event types
  const triggerErrors: ValidationError[] = [];
  for (let i = 0; i < rawTriggers.length; i++) {
    const event = rawTriggers[i]!.event as string;
    if (!VALID_EVENT_TYPES.has(event)) {
      triggerErrors.push({ field: `triggers[${i}].event`, message: `Unknown event type "${event}"` });
    }
  }
  if (triggerErrors.length > 0) throw new SkillMdError(triggerErrors, filePath);

  return {
    name: obj.name as string,
    description: obj.description as string,
    tools: (obj.tools as string[] | undefined) ?? [],
    triggers: rawTriggers.map((t) => ({
      event: t.event as EventType,
      ...(t.filter !== undefined ? { filter: t.filter as Record<string, unknown> } : {}),
    })),
    tags: (obj.tags as string[] | undefined) ?? [],
    ...(obj.handler !== undefined ? { handler: obj.handler as string } : {}),
    filePath,
  };
}

/** Parse SKILL.md content into a full SkillConfig (frontmatter + body) */
export function parseSkillMd(content: string, filePath = ""): SkillConfig {
  const { frontmatter, body } = splitFrontmatter(content);

  if (!frontmatter) {
    throw new SkillMdError([{ field: "(root)", message: "Missing YAML frontmatter (wrap in --- delimiters)" }], filePath);
  }

  const data = parse(frontmatter) as unknown;
  const errors = validateFrontmatter(data);
  if (errors.length > 0) throw new SkillMdError(errors, filePath);

  if (!body) {
    throw new SkillMdError([{ field: "body", message: "Missing markdown body (instructions)" }], filePath);
  }

  const index = buildIndex(data as Record<string, unknown>, filePath);
  return { ...index, instructions: body };
}

/** Parse only the frontmatter of a SKILL.md file (index-only, skips body) */
export function parseSkillMdIndex(content: string, filePath = ""): SkillIndex {
  const { frontmatter } = splitFrontmatter(content);

  if (!frontmatter) {
    throw new SkillMdError([{ field: "(root)", message: "Missing YAML frontmatter (wrap in --- delimiters)" }], filePath);
  }

  const data = parse(frontmatter) as unknown;
  const errors = validateFrontmatter(data);
  if (errors.length > 0) throw new SkillMdError(errors, filePath);

  return buildIndex(data as Record<string, unknown>, filePath);
}

/** Read a SKILL.md file from disk and parse into full SkillConfig */
export function loadSkillMd(filePath: string): SkillConfig {
  const content = readFileSync(filePath, "utf-8");
  return parseSkillMd(content, filePath);
}

/** Read a SKILL.md file from disk and parse only the index (frontmatter) */
export function loadSkillMdIndex(filePath: string): SkillIndex {
  const content = readFileSync(filePath, "utf-8");
  return parseSkillMdIndex(content, filePath);
}
