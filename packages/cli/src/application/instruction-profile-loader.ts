import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

export interface KilnInstructionProfileDefinition {
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly doctrine?: KilnInstructionDoctrineDefinition;
  readonly instructions: string;
  readonly filePath: string;
  readonly scope: "global" | "project";
}

export interface KilnInstructionDoctrineDefinition {
  readonly principles?: readonly string[];
  readonly workflow?: readonly string[];
  readonly qualityGates?: readonly string[];
  readonly reviewPosture?: readonly string[];
  readonly delegation?: readonly string[];
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
  const values = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function asDoctrine(value: unknown): KilnInstructionDoctrineDefinition | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const principles = asStringArray(record.principles);
  const workflow = asStringArray(record.workflow);
  const qualityGates = asStringArray(record.qualityGates);
  const reviewPosture = asStringArray(record.reviewPosture);
  const delegation = asStringArray(record.delegation);
  const doctrine: KilnInstructionDoctrineDefinition = {
    ...(principles ? { principles } : {}),
    ...(workflow ? { workflow } : {}),
    ...(qualityGates ? { qualityGates } : {}),
    ...(reviewPosture ? { reviewPosture } : {}),
    ...(delegation ? { delegation } : {}),
  };

  return Object.keys(doctrine).length > 0 ? doctrine : undefined;
}

function parseInstructionProfile(
  raw: string,
  filePath: string,
  scope: "global" | "project",
): KilnInstructionProfileDefinition | undefined {
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
  if (!name || parsed.body.length === 0) {
    return undefined;
  }

  const displayName = asNonEmptyString(record.displayName);
  const description = asNonEmptyString(record.description);
  const tags = asStringArray(record.tags);
  const doctrine = asDoctrine(record.doctrine);

  return {
    name,
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
    ...(doctrine ? { doctrine } : {}),
    instructions: parsed.body,
    filePath,
    scope,
  };
}

function readProfilesFromDirectory(
  directory: string,
  scope: "global" | "project",
): KilnInstructionProfileDefinition[] {
  let entries: string[];
  try {
    entries = readdirSync(directory) as string[];
  } catch {
    return [];
  }

  const profiles: KilnInstructionProfileDefinition[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) {
      continue;
    }
    const filePath = join(directory, entry);
    try {
      const profile = parseInstructionProfile(readFileSync(filePath, "utf-8"), filePath, scope);
      if (profile) {
        profiles.push(profile);
      }
    } catch {
      // Skip unreadable profiles. Missing selected profiles fail closed later.
    }
  }
  return profiles;
}

export function loadInstructionProfiles(
  projectPath: string,
  userHome = homedir(),
): readonly KilnInstructionProfileDefinition[] {
  const globalDirectory = join(userHome, ".kiln", "instructions");
  const projectDirectory = join(projectPath, ".kiln", "instructions");
  const merged = new Map<string, KilnInstructionProfileDefinition>();

  for (const profile of readProfilesFromDirectory(globalDirectory, "global")) {
    merged.set(profile.name.toLowerCase(), profile);
  }
  for (const profile of readProfilesFromDirectory(projectDirectory, "project")) {
    merged.set(profile.name.toLowerCase(), profile);
  }

  return [...merged.values()];
}

export function findInstructionProfile(
  profiles: readonly KilnInstructionProfileDefinition[],
  name: string,
): KilnInstructionProfileDefinition | undefined {
  const target = name.trim().toLowerCase();
  if (!target) {
    return undefined;
  }
  return profiles.find((profile) => profile.name.toLowerCase() === target);
}
