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

/*
 * The accepted doctrine key set is declared exactly once here and the doctrine
 * definition type is derived from it. This closes the gap that allowed
 * `executionDiscipline` to be silently dropped: adding a new doctrine section
 * to the type now requires adding it to `DOCTRINE_KEYS`, which is also the set
 * the parser validates against. See issue #44.
 */
export const DOCTRINE_KEYS = [
  "principles",
  "workflow",
  "qualityGates",
  "reviewPosture",
  "delegation",
  "executionDiscipline",
] as const;

export type KilnInstructionDoctrineKey = (typeof DOCTRINE_KEYS)[number];

export type KilnInstructionDoctrineDefinition = Partial<
  Record<KilnInstructionDoctrineKey, readonly string[]>
>;

/**
 * Raised when an instruction profile declares a `doctrine` key the parser does
 * not accept. Surfacing this through `loadInstructionProfiles` (rather than
 * silently dropping the key) is the fail-closed behaviour required by issue
 * #44. Callers — projection entry points and `resolveInstructionProfileContextCandidates`
 * — already convert thrown errors into their existing failure surfaces, so the
 * diagnostic reaches the operator without crashing the process.
 */
export class InstructionProfileSchemaError extends Error {
  readonly filePath: string;
  readonly unknownKeys: readonly string[];
  readonly acceptedKeys: readonly string[];

  constructor(filePath: string, unknownKeys: readonly string[], acceptedKeys: readonly string[]) {
    super(
      `Instruction profile ${filePath} declares unknown doctrine key(s): `
        + `${unknownKeys.join(", ")}. `
        + `Accepted keys: ${acceptedKeys.join(", ")}.`,
    );
    this.name = "InstructionProfileSchemaError";
    this.filePath = filePath;
    this.unknownKeys = unknownKeys;
    this.acceptedKeys = acceptedKeys;
  }
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

function asDoctrine(value: unknown, filePath: string): KilnInstructionDoctrineDefinition | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const accepted = new Set<string>(DOCTRINE_KEYS);
  const unknownKeys = Object.keys(record).filter((key) => !accepted.has(key));
  if (unknownKeys.length > 0) {
    throw new InstructionProfileSchemaError(
      filePath,
      [...unknownKeys].sort(),
      [...DOCTRINE_KEYS],
    );
  }

  const doctrine: KilnInstructionDoctrineDefinition = {};
  for (const key of DOCTRINE_KEYS) {
    const values = asStringArray(record[key]);
    if (values) {
      doctrine[key] = values;
    }
  }

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
  const doctrine = asDoctrine(record.doctrine, filePath);

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
    /*
     * Distinguish unreadable (I/O) from invalid (schema) failures, as required
     * by issue #44. A vanished file, permission error, or directory-in-place
     * of a profile is an I/O condition the scan may legitimately skip. A parse
     * failure — notably an unknown doctrine key thrown by asDoctrine — is an
     * operator authoring error and must reach the caller. The previous bare
     * catch converted a partial silent drop into a silent total drop (the S2
     * trap), so schema errors are allowed to propagate: the projection entry
     * points (`syncGlobalInstructionShimProjections`,
     * `writeRepoShimProjections`) and `resolveInstructionProfileContextCandidates`
     * already convert thrown errors into their existing failure surfaces, so
     * the diagnostic reaches the operator without aborting unrelated work.
     */
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const profile = parseInstructionProfile(raw, filePath, scope);
    if (profile) {
      profiles.push(profile);
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
