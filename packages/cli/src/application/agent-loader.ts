import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";

export interface KilnAgentDefinition {
  readonly name: string;
  readonly role: string;
  readonly tools?: readonly string[];
  readonly model?: string;
  readonly skills?: readonly string[];
  readonly instructions?: string;
  readonly scope: "global" | "project";
}

interface ParsedFrontmatter {
  readonly frontmatter: string;
  readonly body: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter | undefined {
  const content = raw.replace(/^\uFEFF/, "");
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*([\s\S]*)$/u.exec(content);
  if (!match) {
    return undefined;
  }

  return {
    frontmatter: match[1] ?? "",
    body: (match[2] ?? "").trim(),
  };
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? entries : undefined;
}

function parseAgentDefinition(raw: string, scope: "global" | "project"): KilnAgentDefinition | undefined {
  const parsed = parseFrontmatter(raw);
  if (!parsed) {
    return undefined;
  }

  let frontmatter: unknown;
  try {
    frontmatter = parse(parsed.frontmatter);
  } catch {
    return undefined;
  }

  if (!frontmatter || typeof frontmatter !== "object") {
    return undefined;
  }

  const record = frontmatter as Record<string, unknown>;
  const name = asNonEmptyString(record.name);
  const role = asNonEmptyString(record.role);
  if (!name || !role) {
    return undefined;
  }

  const tools = asStringArray(record.tools);
  const model = asNonEmptyString(record.model);
  const skills = asStringArray(record.skills);
  const instructions = parsed.body.length > 0 ? parsed.body : undefined;

  return {
    name,
    role,
    ...(tools ? { tools } : {}),
    ...(model ? { model } : {}),
    ...(skills ? { skills } : {}),
    ...(instructions ? { instructions } : {}),
    scope,
  };
}

function readDefinitionsFromDirectory(
  directory: string,
  scope: "global" | "project",
): KilnAgentDefinition[] {
  let entries: string[];
  try {
    entries = readdirSync(directory) as string[];
  } catch {
    return [];
  }

  const definitions: KilnAgentDefinition[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) {
      continue;
    }

    try {
      const filePath = join(directory, entry);
      const raw = readFileSync(filePath, "utf-8");
      const definition = parseAgentDefinition(raw, scope);
      if (definition) {
        definitions.push(definition);
      }
    } catch {
      // skip unreadable or malformed files
    }
  }

  return definitions;
}

export async function loadAgentDefinitions(projectPath: string): Promise<KilnAgentDefinition[]> {
  const globalDirectory = join(homedir(), ".kiln", "agents");
  const projectDirectory = join(projectPath, ".kiln", "agents");

  const merged = new Map<string, KilnAgentDefinition>();

  for (const definition of readDefinitionsFromDirectory(globalDirectory, "global")) {
    merged.set(definition.name.toLowerCase(), definition);
  }

  for (const definition of readDefinitionsFromDirectory(projectDirectory, "project")) {
    merged.set(definition.name.toLowerCase(), definition);
  }

  return [...merged.values()];
}

export function findAgent(
  definitions: KilnAgentDefinition[],
  name: string,
): KilnAgentDefinition | undefined {
  const target = name.trim().toLowerCase();
  if (target.length === 0) {
    return undefined;
  }

  return definitions.find((definition) => definition.name.toLowerCase() === target);
}
