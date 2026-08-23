import {
  KILN_SETTINGS_SCHEMA_REVISION,
  KILN_SETTINGS_SECTION_IDS,
  OPERATOR_THEME_LABELS,
  OPERATOR_THEME_NAMES,
  KilnSettingsSnapshotSchema,
  type KilnSettingsControl,
  type KilnSettingsEntry,
  type KilnSettingsSectionId,
  type KilnSettingsSnapshot,
} from "@kilnai/gateway-contracts";
import type { KilnConfigStatusSnapshot } from "@kilnai/gateway-contracts";
import {
  configSettingDescriptors,
  configSettingGovernance,
  configFieldForSetting,
  type ConfigSettingDescriptor,
} from "./config-setting-descriptors.js";
import { readConfigSourceDetail, readResolvedConfigDetail } from "./config-status.js";
import type { ConfigMutationProposalRecord } from "./config-mutation-store.js";

export interface ReadSettingsSnapshotOptions {
  /** Client-side query; canonical snapshots are never narrowed by default. */
  readonly query?: string;
  /** Client-side modified filter. */
  readonly modified?: boolean;
}

interface RawConfigState {
  readonly value: Record<string, unknown> | null;
  readonly revision: `sha256:${string}` | "absent";
}

/** Fails closed when the settings apply port is given another mutation domain's proposal. */
export function admitSettingsProposalRecord(
  record: ConfigMutationProposalRecord | null,
  proposalId: string,
): ConfigMutationProposalRecord {
  if (!record) throw new Error(`Settings proposal not found: ${proposalId}`);
  if (record.recordVersion !== 2) throw new Error(`Legacy settings proposal is retired: ${proposalId}`);
  if (record.proposal.operation !== "setting.set" && record.proposal.operation !== "setting.reset") {
    throw new Error(`Proposal ${proposalId} is not a settings mutation.`);
  }
  return record;
}

/**
 * Builds the shared settings projection from the existing settable descriptor
 * table and the canonical project schema's field metadata. No paths or raw
 * configuration documents are retained in the returned value.
 */
export function readSettingsSnapshot(
  snapshot: KilnConfigStatusSnapshot,
  options: ReadSettingsSnapshotOptions = {},
): KilnSettingsSnapshot {
  if (!snapshot.activationStatus) {
    throw new Error("Settings projection requires canonical activation status evidence.");
  }
  const sources = readConfigSourceDetail(snapshot);
  if (!sources) {
    throw new Error("Settings projection requires the request-local canonical config capture.");
  }
  const global = configState(sources.global.config, sources.global.revision);
  const project = configState(sources.project.config, sources.project.revision);
  const effective = readResolvedConfigDetail(snapshot);
  const effectiveHealth = snapshot.effectiveConfig?.health ?? "unknown";
  const descriptors = configSettingDescriptors();
  const revisions = {
    ...(global.revision === "absent" ? {} : { global: global.revision }),
    ...(project.revision === "absent" ? {} : { project: project.revision }),
    effective: KILN_SETTINGS_SCHEMA_REVISION,
  } as const;

  const allEntries = descriptors
    .map((descriptor) => projectSettingEntry({
      descriptor,
      effective: effective as Record<string, unknown> | undefined,
      global,
      project,
      health: effectiveHealth,
      revisions,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  const filteredEntries = filterEntries(allEntries, options);
  const sections = KILN_SETTINGS_SECTION_IDS.map((id) => ({
    id,
    label: sectionLabel(id),
    description: sectionDescription(id),
    entryKeys: filteredEntries.filter((entry) => entry.section === id).map((entry) => entry.key),
  }));

  return KilnSettingsSnapshotSchema.parse({
    schemaRevision: KILN_SETTINGS_SCHEMA_REVISION,
    generatedAt: snapshot.generatedAt,
    health: effectiveHealth,
    activationStatus: snapshot.activationStatus,
    sections,
    entries: filteredEntries,
    revisions,
    modifiedCount: filteredEntries.filter((entry) => entry.modified).length,
  });
}

function projectSettingEntry(input: {
  readonly descriptor: ConfigSettingDescriptor;
  readonly effective: Record<string, unknown> | undefined;
  readonly global: RawConfigState;
  readonly project: RawConfigState;
  readonly health: KilnSettingsEntry["health"];
  readonly revisions: KilnSettingsSnapshot["revisions"];
}): KilnSettingsEntry {
  const { descriptor } = input;
  const globalPresent = hasPath(input.global.value, descriptor.path);
  const projectPresent = hasPath(input.project.value, descriptor.path);
  const source = sourceFor(globalPresent, projectPresent);
  const writeTargets = descriptor.scopes.map((scope) => {
    const modified = scope === "project" ? projectPresent : globalPresent;
    const governance = configSettingGovernance(descriptor, scope);
    const field = configFieldForSetting(descriptor, scope);
    const rawValue = scope === "project"
      ? getPath(input.project.value ?? undefined, descriptor.path)
      : getPath(input.global.value ?? undefined, descriptor.path);
    return {
      scope,
      document: scope === "project" ? "project-config" as const : "global-config" as const,
      override: modified ? "overridden" as const : "inherited" as const,
      modified,
      ...(modified ? { current: projectPublicValue(rawValue, field?.sensitivity === "secret-reference") } : {}),
      owners: [...governance.owners],
      authorityImpact: governance.authorityBearing ? "unknown" as const : "none" as const,
      approvalRequired: governance.authorityBearing,
      activation: governance.activation,
    };
  });
  const preferredTarget = writeTargets.find((target) => target.scope === "project") ?? writeTargets[0];
  const preferredField = preferredTarget
    ? configFieldForSetting(descriptor, preferredTarget.scope)
    : undefined;
  const inherited = preferredTarget?.override !== "overridden";
  const modified = writeTargets.some((target) => target.modified);
  const resolvedValue = getPath(input.effective, descriptor.path);
  const effectiveValue = resolvedValue !== undefined
    ? resolvedValue
    : projectPresent
      ? getPath(input.project.value ?? undefined, descriptor.path)
      : globalPresent
        ? getPath(input.global.value ?? undefined, descriptor.path)
        : null;
  const section = descriptor.section ?? sectionForSetting(descriptor.key, descriptor.path);
  const identity = `/${descriptor.path.map(escapeJsonPointer).join("/")}`;
  const revisions = {
    ...(input.revisions.global === undefined ? {} : { global: input.revisions.global }),
    ...(input.revisions.project === undefined ? {} : { project: input.revisions.project }),
    effective: preferredField?.schemaRevision ?? input.revisions.effective,
  };

  return {
    key: descriptor.key,
    identity,
    section,
    label: descriptor.label ?? labelForKey(descriptor.key),
    description: descriptor.description
      ?? (preferredField && "description" in preferredField ? preferredField.description : undefined)
      ?? `Configure ${labelForKey(descriptor.key).toLowerCase()}.`,
    searchTerms: [...uniqueStrings([
      descriptor.key,
      ...descriptor.key.split(/[./]/u),
      section,
      ...(descriptor.searchTerms ?? []),
    ])],
    control: descriptor.control ?? controlForValue(descriptor),
    supportedScopes: [...descriptor.scopes],
    effective: projectPublicValue(effectiveValue, descriptor.scopes.some((scope) =>
      configFieldForSetting(descriptor, scope)?.sensitivity === "secret-reference")),
    source,
    override: inherited ? "inherited" : "overridden",
    inherited,
    modified,
    writeTargets,
    owners: preferredTarget?.owners ?? [],
    authorityImpact: preferredTarget?.authorityImpact ?? "unknown",
    approvalRequired: preferredTarget?.approvalRequired ?? true,
    activation: preferredTarget?.activation ?? "next-session",
    health: input.health,
    capabilities: { read: true, set: true, reset: true },
    revisions,
  };
}

function projectPublicValue(value: unknown, descriptorSensitive: boolean): KilnSettingsEntry["effective"] {
  if (descriptorSensitive || containsSecretLikeValue(value)) {
    return { redacted: { present: true } };
  }
  return { value: sanitizePublicValue(value) ?? null };
}

function controlForValue(descriptor: ConfigSettingDescriptor): KilnSettingsControl {
  switch (descriptor.value.kind) {
    case "text": return { kind: "text" };
    case "enum": return {
      kind: "select",
      options: descriptor.value.allowed.map((value) => ({ value, label: labelForKey(value) })),
    };
    case "boolean": return { kind: "toggle" };
    case "number": return { kind: "number" };
    case "string-list": return { kind: "list", itemKind: "text" };
    case "string-list-record":
    case "json": return { kind: "json" };
    case "timezone": return { kind: "timezone" };
    case "operator-theme": return {
      kind: "theme",
      options: OPERATOR_THEME_NAMES.map((value) => ({ value, label: OPERATOR_THEME_LABELS[value] })),
    };
  }
  throw new Error(`Unsupported settings control for ${descriptor.key}.`);
}

function sectionForSetting(key: string, path: readonly string[]): KilnSettingsSectionId {
  const root = path[0] ?? key.split(".")[0] ?? "";
  if (["permissions"].includes(root)) return "permissions";
  if (["interactiveUse"].includes(root)) return "tools";
  if (["workGovernance", "maxDepth", "parallelWorkers"].includes(root)) return "usage-and-limits";
  if (["skills", "activeInstructionProfiles"].includes(root)) return "agents";
  if (["provider", "providers", "engines", "targetCatalog"].includes(root)) return "providers";
  if (["model", "modelTaskSuitability"].includes(root)) return "models";
  return "general";
}

function sectionLabel(id: KilnSettingsSectionId): string {
  return id === "usage-and-limits" ? "Usage and Limits" : id.charAt(0).toUpperCase() + id.slice(1);
}

function sectionDescription(id: KilnSettingsSectionId): string {
  switch (id) {
    case "general": return "Identity, presentation, and project defaults.";
    case "providers": return "Provider connections and routing intent.";
    case "models": return "Model selection and model behavior.";
    case "permissions": return "Authority, approval, and sandbox policy.";
    case "tools": return "Interactive tools and their admitted boundaries.";
    case "usage-and-limits": return "Work limits and governance controls.";
    case "agents": return "Skills, agents, and instruction profiles.";
    case "health": return "Read-only configuration and projection health.";
    case "advanced": return "Descriptor-backed inspection and validation.";
  }
}

function filterEntries(
  entries: readonly KilnSettingsEntry[],
  options: ReadSettingsSnapshotOptions,
): readonly KilnSettingsEntry[] {
  const query = options.query?.trim().toLowerCase();
  return entries.filter((entry) => {
    if (options.modified !== undefined && entry.modified !== options.modified) return false;
    if (!query) return true;
    return [entry.key, entry.identity, entry.label, entry.description, ...entry.searchTerms]
      .some((candidate) => candidate.toLowerCase().includes(query));
  });
}

function configState(value: unknown, revision: `sha256:${string}` | "absent" | undefined): RawConfigState {
  return {
    value: isRecord(value) ? value : null,
    revision: revision ?? "absent",
  };
}

function sourceFor(globalPresent: boolean, projectPresent: boolean): "default" | "global" | "project" | "composed" {
  if (globalPresent && projectPresent) return "composed";
  if (projectPresent) return "project";
  if (globalPresent) return "global";
  return "default";
}

function getPath(value: Record<string, unknown> | undefined, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function hasPath(value: Record<string, unknown> | null, path: readonly string[]): boolean {
  return getPath(value ?? undefined, path) !== undefined;
}

function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === "string") return /(?:token|secret|password|api[_-]?key|credential|private[_-]?key)\s*[=:]/iu.test(value)
    || /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|private|tmp|var|workspace|mnt)(?:[\\/]|$))/u.test(value.trim());
  if (Array.isArray(value)) return value.some(containsSecretLikeValue);
  if (value && typeof value === "object") return Object.entries(value).some(([key, entry]) =>
    /(?:token|secret|password|api[_-]?key|credential|private[_-]?key)/iu.test(key) || containsSecretLikeValue(entry));
  return false;
}

function sanitizePublicValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((entry) => sanitizePublicValue(entry) ?? null);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
      const sanitized = sanitizePublicValue(entry);
      return sanitized === undefined ? [] : [[key, sanitized]];
    }));
  }
  return value;
}

function labelForKey(key: string): string {
  return key.split(/[./]/u).map((part) => part
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .trim()
    .replace(/^\w/u, (letter) => letter.toUpperCase())).join(" / ");
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
