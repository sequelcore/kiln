import type { SkillIndex } from "./types.js";

export type SkillHarnessPortability = "agnostic" | "harness-specific";
export type SkillDisconnectedExecution =
  | "supported"
  | "capability-dependent"
  | "kiln-runtime-required";

export interface DeclaredSkillPortability {
  readonly status: "declared";
  readonly harnessPortability: SkillHarnessPortability;
  readonly disconnectedExecution: SkillDisconnectedExecution;
  readonly requiredCapabilities: readonly string[];
}

export interface UnknownSkillPortability {
  readonly status: "unknown";
  readonly reason: string;
}

export type SkillPortability = DeclaredSkillPortability | UnknownSkillPortability;

export const SKILL_PORTABILITY_METADATA_KEYS = {
  harnessPortability: "kiln.harnessPortability",
  disconnectedExecution: "kiln.disconnectedExecution",
  requiredCapabilities: "kiln.requiredCapabilities",
} as const;

const CAPABILITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function createSkillPortabilityMetadata(
  portability: Omit<DeclaredSkillPortability, "status">,
): Readonly<Record<string, string>> {
  const requiredCapabilities = normalizeCapabilities(portability.requiredCapabilities);
  if (portability.disconnectedExecution === "supported" && requiredCapabilities.length > 0) {
    throw new Error("A disconnected-supported skill cannot require an external capability.");
  }
  if (portability.disconnectedExecution !== "supported" && requiredCapabilities.length === 0) {
    throw new Error(`${portability.disconnectedExecution} requires at least one capability identity.`);
  }
  return {
    [SKILL_PORTABILITY_METADATA_KEYS.harnessPortability]: portability.harnessPortability,
    [SKILL_PORTABILITY_METADATA_KEYS.disconnectedExecution]: portability.disconnectedExecution,
    [SKILL_PORTABILITY_METADATA_KEYS.requiredCapabilities]: requiredCapabilities.length > 0
      ? requiredCapabilities.join(",")
      : "none",
  };
}

export function readSkillPortability(skill: Pick<SkillIndex, "metadata">): SkillPortability {
  const metadata = skill.metadata ?? {};
  const harnessPortability = metadata[SKILL_PORTABILITY_METADATA_KEYS.harnessPortability];
  const disconnectedExecution = metadata[SKILL_PORTABILITY_METADATA_KEYS.disconnectedExecution];
  const rawCapabilities = metadata[SKILL_PORTABILITY_METADATA_KEYS.requiredCapabilities];
  if (harnessPortability === undefined && disconnectedExecution === undefined && rawCapabilities === undefined) {
    return { status: "unknown", reason: "Skill does not declare Kiln portability metadata." };
  }
  if (harnessPortability !== "agnostic" && harnessPortability !== "harness-specific") {
    return { status: "unknown", reason: "Skill harness portability metadata is missing or invalid." };
  }
  if (disconnectedExecution !== "supported"
    && disconnectedExecution !== "capability-dependent"
    && disconnectedExecution !== "kiln-runtime-required") {
    return { status: "unknown", reason: "Skill disconnected execution metadata is missing or invalid." };
  }
  if (rawCapabilities === undefined) {
    return { status: "unknown", reason: "Skill required-capabilities metadata is missing." };
  }
  let requiredCapabilities: readonly string[];
  try {
    requiredCapabilities = rawCapabilities === "none" ? [] : normalizeCapabilities(rawCapabilities.split(","));
  } catch (error) {
    return { status: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
  if (disconnectedExecution === "supported" && requiredCapabilities.length > 0) {
    return { status: "unknown", reason: "Disconnected-supported skill declares external capabilities." };
  }
  if (disconnectedExecution !== "supported" && requiredCapabilities.length === 0) {
    return { status: "unknown", reason: `${disconnectedExecution} skill lacks a required capability.` };
  }
  return {
    status: "declared",
    harnessPortability,
    disconnectedExecution,
    requiredCapabilities,
  };
}

function normalizeCapabilities(values: readonly string[]): readonly string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en")
  );
  for (const value of normalized) {
    if (!CAPABILITY_ID.test(value)) {
      throw new Error(`Invalid skill capability identity '${value}'.`);
    }
  }
  return normalized;
}
