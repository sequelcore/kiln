import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
import {
  defineWorkClassification,
  type AgentTier,
  type ModelTaskSuitabilityTask,
  type WorkClassification,
  type WorkClassificationInput,
  type CommunicationIntent,
  resolveCommunicationIntent,
} from "@kilnai/core";

export interface KilnAgentDefinition {
  readonly name: string;
  readonly displayName?: string;
  readonly nicknameCandidates?: readonly string[];
  readonly role: string;
  readonly description?: string;
  readonly goal: string;
  readonly backstory?: string;
  readonly tier: AgentTier;
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
  readonly instructionProfiles?: readonly string[];
  readonly taskAffinity?: readonly ModelTaskSuitabilityTask[];
  readonly mode?: KilnAgentMode;
  readonly structured?: boolean;
  readonly count?: number;
  readonly sandbox?: boolean;
  readonly modalities?: readonly string[];
  readonly authorityProfileId?: string;
  readonly economicPolicyId?: string;
  readonly targetId?: string;
  readonly workClassification?: WorkClassification;
  readonly voiceProfile?: string;
  readonly communication?: CommunicationIntent;
  readonly instructions?: string;
  readonly scope: "global" | "project";
}

export type KilnAgentMode = "primary" | "subagent" | "managed-child" | "all";

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

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asAgentTier(value: unknown): AgentTier | undefined {
  return value === "reasoning" || value === "coding" || value === "fast" ? value : undefined;
}

function asAgentMode(value: unknown): KilnAgentMode | undefined {
  return value === "primary" || value === "subagent" || value === "managed-child" || value === "all"
    ? value
    : undefined;
}

function asTaskAffinity(value: unknown): readonly ModelTaskSuitabilityTask[] | undefined {
  const entries = asStringArray(value);
  if (!entries) {
    return undefined;
  }
  const supported = entries.filter((entry): entry is ModelTaskSuitabilityTask =>
    entry === "architecture-review"
    || entry === "backend-coding"
    || entry === "frontend-design"
    || entry === "mechanical-edit"
    || entry === "research"
    || entry === "test-writing"
  );
  return supported.length > 0 ? supported : undefined;
}

function asWorkClassification(value: unknown): WorkClassification | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const input: WorkClassificationInput = {
    ...(asStringArray(record.intents) ? { intents: asStringArray(record.intents) } : {}),
    ...(asStringArray(record.artifacts) ? { artifacts: asStringArray(record.artifacts) } : {}),
    ...(asStringArray(record.domains) ? { domains: asStringArray(record.domains) } : {}),
    ...(asStringArray(record.evidenceScopes) ? { evidenceScopes: asStringArray(record.evidenceScopes) } : {}),
    ...(asStringArray(record.effects) ? { effects: asStringArray(record.effects) } : {}),
    ...(asStringArray(record.modes) ? { modes: asStringArray(record.modes) } : {}),
  };
  return defineWorkClassification(input);
}

function asCommunicationIntent(value: unknown): CommunicationIntent | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent communication intent must be an object.");
  }
  resolveCommunicationIntent([{ source: "agent-profile", intent: value as CommunicationIntent }]);
  return value as CommunicationIntent;
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
  const allowedFields = new Set([
    "name", "displayName", "nicknameCandidates", "role", "description", "goal", "backstory", "tier",
    "tools", "skills", "instructionProfiles", "taskAffinity", "mode", "structured", "count", "sandbox",
    "modalities", "authorityProfileId", "economicPolicyId", "targetId", "workClassification", "voiceProfile",
    "communication",
  ]);
  if (Object.keys(record).some((field) => !allowedFields.has(field))) {
    return undefined;
  }
  const name = asNonEmptyString(record.name);
  const role = asNonEmptyString(record.role);
  const goal = asNonEmptyString(record.goal);
  const tier = asAgentTier(record.tier);
  if (!name || !role || !goal || !tier) {
    return undefined;
  }

  const description = asNonEmptyString(record.description);
  const displayName = asNonEmptyString(record.displayName);
  const nicknameCandidates = asStringArray(record.nicknameCandidates);
  const backstory = asNonEmptyString(record.backstory);
  const tools = asStringArray(record.tools);
  const skills = asStringArray(record.skills);
  const instructionProfiles = asStringArray(record.instructionProfiles);
  const taskAffinity = asTaskAffinity(record.taskAffinity);
  const mode = asAgentMode(record.mode);
  const structured = asBoolean(record.structured);
  const count = asPositiveInteger(record.count);
  const sandbox = asBoolean(record.sandbox);
  const modalities = asStringArray(record.modalities);
  const authorityProfileId = asNonEmptyString(record.authorityProfileId);
  if (record.authorityProfileId !== undefined && !authorityProfileId) return undefined;
  const targetId = asNonEmptyString(record.targetId);
  if (record.targetId !== undefined && !targetId) return undefined;
  const economicPolicyId = asNonEmptyString(record.economicPolicyId);
  let workClassification: WorkClassification | undefined;
  try {
    workClassification = asWorkClassification(record.workClassification);
  } catch {
    return undefined;
  }
  const voiceProfile = asNonEmptyString(record.voiceProfile);
  let communication: CommunicationIntent | undefined;
  try {
    communication = asCommunicationIntent(record.communication);
  } catch {
    return undefined;
  }
  const instructions = parsed.body.length > 0 ? parsed.body : undefined;

  return {
    name,
    ...(displayName ? { displayName } : {}),
    ...(nicknameCandidates ? { nicknameCandidates } : {}),
    role,
    ...(description ? { description } : {}),
    goal,
    ...(backstory ? { backstory } : {}),
    tier,
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(instructionProfiles ? { instructionProfiles } : {}),
    ...(taskAffinity ? { taskAffinity } : {}),
    ...(mode ? { mode } : {}),
    ...(structured !== undefined ? { structured } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(modalities ? { modalities } : {}),
    ...(authorityProfileId ? { authorityProfileId } : {}),
    ...(economicPolicyId ? { economicPolicyId } : {}),
    ...(targetId ? { targetId } : {}),
    ...(workClassification ? { workClassification } : {}),
    ...(voiceProfile ? { voiceProfile } : {}),
    ...(communication ? { communication } : {}),
    ...(instructions ? { instructions } : {}),
    scope,
  };
}

export function parseAgentDefinitionContent(raw: string, scope: "global" | "project" = "project"): KilnAgentDefinition | undefined {
  return parseAgentDefinition(raw, scope);
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

export interface LoadAgentDefinitionsOptions {
  readonly userHome?: string;
}

export async function loadGlobalAgentDefinitions(
  options: LoadAgentDefinitionsOptions = {},
): Promise<KilnAgentDefinition[]> {
  const globalDirectory = join(options.userHome ?? homedir(), ".kiln", "agents");
  return readDefinitionsFromDirectory(globalDirectory, "global");
}

export async function loadAgentDefinitions(
  projectPath: string,
  options: LoadAgentDefinitionsOptions = {},
): Promise<KilnAgentDefinition[]> {
  const projectDirectory = join(projectPath, ".kiln", "agents");

  const merged = new Map<string, KilnAgentDefinition>();

  for (const definition of await loadGlobalAgentDefinitions(options)) {
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

  const canonicalMatch = definitions.find((definition) => definition.name.toLowerCase() === target);
  if (canonicalMatch) {
    return canonicalMatch;
  }

  const nicknameMatches = definitions.filter((definition) => {
    const displayName = definition.displayName?.toLowerCase();
    const nicknames = definition.nicknameCandidates?.map((nickname) => nickname.toLowerCase()) ?? [];
    return displayName === target || nicknames.includes(target);
  });

  return nicknameMatches.length === 1 ? nicknameMatches[0] : undefined;
}
