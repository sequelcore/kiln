declare const deliberationLevelBrand: unique symbol;

/** Provider-advertised identifier. Meaning and ordering are capability-scoped. */
export type DeliberationLevelId = string & { readonly [deliberationLevelBrand]: true };

const PORTABLE_LEVEL_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;

export function defineDeliberationLevelId(value: string): DeliberationLevelId {
  if (!PORTABLE_LEVEL_ID.test(value)) {
    throw new Error(`Deliberation level '${value}' must be a portable identifier.`);
  }
  return value as DeliberationLevelId;
}

export const KNOWN_DELIBERATION_LEVEL_IDS = Object.freeze({
  none: defineDeliberationLevelId("none"),
  minimal: defineDeliberationLevelId("minimal"),
  low: defineDeliberationLevelId("low"),
  medium: defineDeliberationLevelId("medium"),
  high: defineDeliberationLevelId("high"),
  xhigh: defineDeliberationLevelId("xhigh"),
  max: defineDeliberationLevelId("max"),
  ultra: defineDeliberationLevelId("ultra"),
});

export type DeliberationTarget = "latency-first" | "balanced" | "quality-first";
export type UnsupportedDeliberationPolicy = "deny" | "omit" | "allow-clamp";
export type DeliberationSource =
  | "operator"
  | "work-item"
  | "agent-profile"
  | "route"
  | "task"
  | "project"
  | "provider-default";

export interface DeliberationBounds {
  readonly min?: DeliberationLevelId;
  readonly max?: DeliberationLevelId;
}

export type DeliberationIntent =
  | {
      readonly mode: "provider-default";
      readonly onUnsupported: UnsupportedDeliberationPolicy;
    }
  | {
      readonly mode: "fixed";
      readonly preferredLevel: DeliberationLevelId;
      readonly bounds?: DeliberationBounds;
      readonly onUnsupported: UnsupportedDeliberationPolicy;
    }
  | {
      readonly mode: "adaptive";
      readonly target: DeliberationTarget;
      readonly bounds?: DeliberationBounds;
      readonly onUnsupported: UnsupportedDeliberationPolicy;
    };

export interface DeliberationCapabilityEvidence {
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly observedAt: string;
}

export interface ModelDeliberationLevel {
  readonly id: DeliberationLevelId;
  readonly nativeId?: string;
}

export interface ModelDeliberationCapabilities {
  readonly provider: string;
  readonly model: string;
  /** Ordered from least to most provider-advertised inference work. */
  readonly levels: readonly ModelDeliberationLevel[];
  readonly defaultLevel?: DeliberationLevelId;
  readonly supportsAdaptive: boolean;
  readonly evidence: DeliberationCapabilityEvidence;
}

export type DeliberationResolutionReason =
  | "not-requested"
  | "capability-unknown"
  | "capability-invalid"
  | "provider-default-unavailable"
  | "adaptive-unsupported"
  | "preferred-level-unsupported"
  | "preferred-level-outside-bounds"
  | "bound-unsupported"
  | "invalid-bounds"
  | "no-level-within-bounds";

interface DeliberationResolutionBase {
  readonly requested?: DeliberationIntent;
  readonly source: DeliberationSource;
  readonly capabilityEvidence?: DeliberationCapabilityEvidence;
}

export type DeliberationResolution =
  | (DeliberationResolutionBase & {
      readonly status: "exact" | "defaulted";
      readonly selectedLevel: DeliberationLevelId;
    })
  | (DeliberationResolutionBase & {
      readonly status: "clamped";
      readonly selectedLevel: DeliberationLevelId;
      readonly reason: DeliberationResolutionReason;
    })
  | (DeliberationResolutionBase & {
      readonly status: "omitted" | "denied";
      readonly reason: DeliberationResolutionReason;
    });

export type ResolveDeliberationInput =
  | {
      readonly intent: DeliberationIntent;
      readonly source: Exclude<DeliberationSource, "provider-default">;
      readonly capabilities?: ModelDeliberationCapabilities;
    }
  | {
      readonly intent?: undefined;
      readonly source?: undefined;
      readonly capabilities?: ModelDeliberationCapabilities;
    };

export function resolveDeliberation(input: ResolveDeliberationInput): DeliberationResolution {
  if (!input.intent) {
    return { status: "omitted", source: "provider-default", reason: "not-requested" };
  }

  const intent = input.intent;
  const resolutionSource = intent.mode === "provider-default" ? "provider-default" : input.source;
  if (!input.capabilities) {
    return unresolved(intent, resolutionSource, "capability-unknown");
  }

  const capabilities = input.capabilities;
  if (!validCapabilities(capabilities)) {
    return unresolved(intent, resolutionSource, "capability-invalid", capabilities.evidence);
  }
  const evidence = capabilities.evidence;
  const orderedLevels = capabilities.levels.map((level) => level.id);

  if (intent.mode === "provider-default") {
    if (!capabilities.defaultLevel) {
      return unresolved(intent, resolutionSource, "provider-default-unavailable", evidence);
    }
    return {
      status: "defaulted",
      requested: intent,
      selectedLevel: capabilities.defaultLevel,
      source: "provider-default",
      capabilityEvidence: evidence,
    };
  }

  const range = resolveRange(intent.bounds, orderedLevels);
  if (range.status === "invalid") {
    return unresolved(intent, resolutionSource, range.reason, evidence);
  }

  if (intent.mode === "adaptive") {
    if (!capabilities.supportsAdaptive) {
      return unresolved(intent, resolutionSource, "adaptive-unsupported", evidence);
    }
    const selectedLevel = selectAdaptiveLevel(intent.target, range.levels, capabilities.defaultLevel);
    if (!selectedLevel) {
      return unresolved(intent, resolutionSource, "no-level-within-bounds", evidence);
    }
    return {
      status: "exact",
      requested: intent,
      selectedLevel,
      source: resolutionSource,
      capabilityEvidence: evidence,
    };
  }

  const preferredIndex = orderedLevels.indexOf(intent.preferredLevel);
  if (preferredIndex < 0) {
    return unresolved(intent, resolutionSource, "preferred-level-unsupported", evidence);
  }
  if (range.levels.includes(intent.preferredLevel)) {
    return {
      status: "exact",
      requested: intent,
      selectedLevel: intent.preferredLevel,
      source: resolutionSource,
      capabilityEvidence: evidence,
    };
  }
  if (intent.onUnsupported !== "allow-clamp" || range.levels.length === 0) {
    return unresolved(intent, resolutionSource, "preferred-level-outside-bounds", evidence);
  }
  const selectedLevel = preferredIndex < range.startIndex
    ? range.levels[0]
    : range.levels[range.levels.length - 1];
  return {
    status: "clamped",
    requested: intent,
    selectedLevel: selectedLevel!,
    source: resolutionSource,
    reason: "preferred-level-outside-bounds",
    capabilityEvidence: evidence,
  };
}

/** Admits a resolved policy at the execution boundary and returns an explicit native override level. */
export function admitDeliberationForExecution(
  resolution: DeliberationResolution | undefined,
): DeliberationLevelId | undefined {
  if (!resolution) {
    return undefined;
  }
  switch (resolution.status) {
    case "omitted":
    case "defaulted":
      return undefined;
    case "denied":
      throw new Error(`Denied deliberation cannot execute: ${resolution.reason}.`);
    case "exact":
    case "clamped":
      break;
  }
  if (!resolution.capabilityEvidence
    || !resolution.capabilityEvidence.sourceIdentity.trim()
    || !resolution.capabilityEvidence.sourceRevision.trim()) {
    throw new Error("Executable deliberation requires capability evidence identity and revision.");
  }
  return defineDeliberationLevelId(resolution.selectedLevel);
}

function unresolved(
  intent: DeliberationIntent,
  source: DeliberationSource,
  reason: DeliberationResolutionReason,
  capabilityEvidence?: DeliberationCapabilityEvidence,
): DeliberationResolution {
  const status = intent.onUnsupported === "omit" ? "omitted" : "denied";
  return {
    status,
    requested: intent,
    source,
    reason,
    ...(capabilityEvidence ? { capabilityEvidence } : {}),
  };
}

function validCapabilities(capabilities: ModelDeliberationCapabilities): boolean {
  if (!capabilities.provider.trim() || !capabilities.model.trim() || capabilities.levels.length === 0) {
    return false;
  }
  if (!capabilities.evidence.sourceIdentity.trim()
    || !capabilities.evidence.sourceRevision.trim()
    || Number.isNaN(Date.parse(capabilities.evidence.observedAt))) {
    return false;
  }
  const ids = capabilities.levels.map((level) => level.id);
  if (ids.some((id) => !PORTABLE_LEVEL_ID.test(id)) || new Set(ids).size !== ids.length) {
    return false;
  }
  return capabilities.defaultLevel === undefined || ids.includes(capabilities.defaultLevel);
}

type DeliberationRangeResolution =
  | { readonly status: "valid"; readonly levels: readonly DeliberationLevelId[]; readonly startIndex: number }
  | { readonly status: "invalid"; readonly reason: "bound-unsupported" | "invalid-bounds" };

function resolveRange(
  bounds: DeliberationBounds | undefined,
  levels: readonly DeliberationLevelId[],
): DeliberationRangeResolution {
  const minIndex = bounds?.min === undefined ? 0 : levels.indexOf(bounds.min);
  const maxIndex = bounds?.max === undefined ? levels.length - 1 : levels.indexOf(bounds.max);
  if (minIndex < 0 || maxIndex < 0) {
    return { status: "invalid", reason: "bound-unsupported" };
  }
  if (minIndex > maxIndex) {
    return { status: "invalid", reason: "invalid-bounds" };
  }
  return { status: "valid", levels: levels.slice(minIndex, maxIndex + 1), startIndex: minIndex };
}

function selectAdaptiveLevel(
  target: DeliberationTarget,
  levels: readonly DeliberationLevelId[],
  providerDefault: DeliberationLevelId | undefined,
): DeliberationLevelId | undefined {
  if (levels.length === 0) return undefined;
  if (target === "latency-first") return levels[0];
  if (target === "quality-first") return levels[levels.length - 1];
  if (providerDefault && levels.includes(providerDefault)) return providerDefault;
  return levels[Math.floor((levels.length - 1) / 2)];
}
