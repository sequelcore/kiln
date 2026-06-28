export const WORK_CLASSIFICATION_INTENTS = [
  "write",
  "edit",
  "summarize",
  "explain",
  "research",
  "analyze",
  "plan",
  "review",
  "decide",
  "support",
  "teach",
  "translate",
  "code",
  "design",
  "operate",
] as const;

export const WORK_CLASSIFICATION_ARTIFACTS = [
  "prose",
  "code",
  "ui",
  "data",
  "document",
  "message",
  "slide",
  "spreadsheet",
  "image",
  "audio",
  "workflow",
  "configuration",
] as const;

export const WORK_CLASSIFICATION_DOMAINS = [
  "software",
  "business",
  "education",
  "support",
  "marketing",
  "legal",
  "regulatory",
  "finance",
  "medical",
  "operations",
  "personal-productivity",
] as const;

export const WORK_CLASSIFICATION_EFFECTS = [
  "answer-only",
  "read-only",
  "write-artifact",
  "mutate-workspace",
  "execute-command",
  "external-side-effect",
  "publish-send",
] as const;

export const WORK_CLASSIFICATION_MODES = [
  "answer",
  "coauthor",
  "transform",
  "critique",
  "delegate",
  "automate",
  "monitor",
] as const;

export type WorkClassificationIntent = typeof WORK_CLASSIFICATION_INTENTS[number];
export type WorkClassificationArtifact = typeof WORK_CLASSIFICATION_ARTIFACTS[number];
export type WorkClassificationDomain = typeof WORK_CLASSIFICATION_DOMAINS[number];
export type WorkClassificationEffect = typeof WORK_CLASSIFICATION_EFFECTS[number];
export type WorkClassificationMode = typeof WORK_CLASSIFICATION_MODES[number];

export interface WorkClassification {
  readonly intents?: readonly WorkClassificationIntent[];
  readonly artifacts?: readonly WorkClassificationArtifact[];
  readonly domains?: readonly WorkClassificationDomain[];
  readonly effects?: readonly WorkClassificationEffect[];
  readonly modes?: readonly WorkClassificationMode[];
}

export interface WorkClassificationInput {
  readonly intents?: readonly string[];
  readonly artifacts?: readonly string[];
  readonly domains?: readonly string[];
  readonly effects?: readonly string[];
  readonly modes?: readonly string[];
}

const CLEAR_WRITING_INTENTS = new Set<WorkClassificationIntent>([
  "write",
  "edit",
  "summarize",
  "explain",
  "support",
  "teach",
  "translate",
]);

const CLEAR_WRITING_ARTIFACTS = new Set<WorkClassificationArtifact>([
  "prose",
  "document",
  "message",
  "slide",
]);

export function defineWorkClassification(input: WorkClassificationInput): WorkClassification {
  const classification: WorkClassification = {
    ...normalizeFacet("intent", input.intents, WORK_CLASSIFICATION_INTENTS),
    ...normalizeFacet("artifact", input.artifacts, WORK_CLASSIFICATION_ARTIFACTS),
    ...normalizeFacet("domain", input.domains, WORK_CLASSIFICATION_DOMAINS),
    ...normalizeFacet("effect", input.effects, WORK_CLASSIFICATION_EFFECTS),
    ...normalizeFacet("mode", input.modes, WORK_CLASSIFICATION_MODES),
  };
  return Object.fromEntries(
    Object.entries(classification).filter(([, value]) => Array.isArray(value) && value.length > 0),
  ) as WorkClassification;
}

export function recommendedSkillsForWorkClassification(
  classification: WorkClassification | undefined,
): readonly string[] {
  if (!classification || Object.keys(classification).length === 0) {
    return [];
  }
  return isClearWritingWork(classification) ? ["clear-writing"] : [];
}

function isClearWritingWork(classification: WorkClassification): boolean {
  const intents = classification.intents ?? [];
  const artifacts = classification.artifacts ?? [];
  if (artifacts.length > 0) {
    return artifacts.some((artifact) => CLEAR_WRITING_ARTIFACTS.has(artifact));
  }
  return intents.some((intent) => CLEAR_WRITING_INTENTS.has(intent));
}

function normalizeFacet<const T extends readonly string[]>(
  name: string,
  values: readonly string[] | undefined,
  allowed: T,
): Record<string, readonly T[number][]> {
  if (!values || values.length === 0) {
    return {};
  }
  const allowedValues = new Set<string>(allowed);
  const normalized: T[number][] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!allowedValues.has(trimmed)) {
      throw new Error(`Unsupported work classification ${name}: ${trimmed}`);
    }
    if (!normalized.includes(trimmed as T[number])) {
      normalized.push(trimmed as T[number]);
    }
  }
  return normalized.length > 0 ? { [`${name}s`]: normalized } : {};
}
