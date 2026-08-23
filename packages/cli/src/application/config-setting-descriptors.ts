import type {
  KilnConfigActivationClass,
  KilnConfigMutationScope,
  KilnConfigReconciliationTarget,
  KilnSettingsControl,
  KilnSettingsSectionId,
} from "@kilnai/gateway-contracts";
import { isOperatorThemeName } from "@kilnai/gateway-contracts";
import {
  PROJECT_CONFIG_FIELD_DESCRIPTORS,
  type ProjectConfigFieldDescriptor,
} from "../config/project-config-schema.js";
import {
  GLOBAL_CONFIG_FIELD_DESCRIPTORS,
  type GlobalConfigFieldDescriptor,
} from "../config/global-config-schema.js";

/**
 * The settable surface of one configuration key.
 *
 * This table owns only what a command surface needs: which keys can be set,
 * where they live in the document, which scopes admit them, and how an operator
 * string becomes a value. It deliberately does not own authority, activation, or
 * ownership. Those facts are read from the canonical family-schema
 * descriptors, so this file cannot drift into a second policy engine.
 */
export interface ConfigSettingDescriptor {
  readonly key: string;
  /** Canonical document path this key owns. */
  readonly path: readonly string[];
  readonly scopes: readonly KilnConfigMutationScope[];
  readonly value: ConfigSettingValueKind;
  readonly reconciliationTargets: readonly KilnConfigReconciliationTarget[];
  /** Optional curated presentation metadata; omitted entries derive from key/schema facts. */
  readonly section?: KilnSettingsSectionId;
  readonly label?: string;
  readonly description?: string;
  readonly searchTerms?: readonly string[];
  readonly control?: KilnSettingsControl;
}

/** Resolved governance facts for one key in one scope. */
export interface ConfigSettingGovernance {
  readonly authorityBearing: boolean;
  readonly activation: KilnConfigActivationClass;
  readonly owners: readonly string[];
}

/**
 * Resolves governance for a key in a scope.
 *
 * Keys defer to their canonical family schema descriptors, which carry
 * `x-kiln-authority-impact` and activation as schema metadata. A key with no
 * descriptor fails closed as authority-bearing rather than being assumed safe.
 */
export function configSettingGovernance(
  descriptor: ConfigSettingDescriptor,
  scope: KilnConfigMutationScope,
): ConfigSettingGovernance {
  const field = configFieldForSetting(descriptor, scope);
  if (!field) {
    return { authorityBearing: true, activation: "next-session", owners: [] };
  }
  return {
    authorityBearing: field.authorityImpact === "authority-bearing",
    activation: field.activation as KilnConfigActivationClass,
    owners: [field.semanticOwner],
  };
}

export type ConfigSettingFieldDescriptor = ProjectConfigFieldDescriptor | GlobalConfigFieldDescriptor;

/** Nearest canonical family-schema descriptor for one settable key and scope. */
export function configFieldForSetting(
  descriptor: ConfigSettingDescriptor,
  scope: KilnConfigMutationScope,
): ConfigSettingFieldDescriptor | undefined {
  const descriptors = scope === "global"
    ? GLOBAL_CONFIG_FIELD_DESCRIPTORS
    : PROJECT_CONFIG_FIELD_DESCRIPTORS;
  for (let depth = descriptor.path.length; depth > 0; depth -= 1) {
    const identity = `/${descriptor.path.slice(0, depth).join("/")}`;
    const found = descriptors.find((entry) => entry.identity === identity);
    if (found) return found;
  }
  return undefined;
}

export type ConfigSettingValueKind =
  | { readonly kind: "text" }
  | { readonly kind: "enum"; readonly allowed: readonly string[] }
  | { readonly kind: "boolean" }
  | { readonly kind: "number" }
  | { readonly kind: "string-list" }
  | { readonly kind: "string-list-record" }
  | { readonly kind: "json" }
  | { readonly kind: "timezone" }
  | { readonly kind: "operator-theme" };

export type ConfigSettingParse =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

export function configSettingDescriptor(key: string): ConfigSettingDescriptor | undefined {
  return CONFIG_SETTING_DESCRIPTORS.get(key);
}

/** Stable read-only enumeration used by the cross-surface settings projection. */
export function configSettingDescriptors(): readonly ConfigSettingDescriptor[] {
  return [...CONFIG_SETTING_DESCRIPTORS.values()];
}

export function configSettingKeys(): readonly string[] {
  return [...CONFIG_SETTING_DESCRIPTORS.keys()].sort();
}

export function parseConfigSettingValue(
  descriptor: ConfigSettingDescriptor,
  raw: string,
): ConfigSettingParse {
  const spec = descriptor.value;
  switch (spec.kind) {
    case "text":
      return { ok: true, value: raw };
    case "enum":
      return spec.allowed.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `Invalid ${descriptor.key}: ${raw}. Must be one of ${spec.allowed.join(", ")}.` };
    case "boolean":
      if (raw === "true") return { ok: true, value: true };
      if (raw === "false") return { ok: true, value: false };
      return { ok: false, message: `Invalid boolean value for ${descriptor.key}: ${raw}. Must be true or false.` };
    case "number": {
      const parsed = Number(raw);
      // Shape only: the canonical schema decides range and integrality.
      return Number.isFinite(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, message: `Invalid numeric value for ${descriptor.key}: ${raw}.` };
    }
    case "string-list":
      return { ok: true, value: splitList(raw) };
    case "string-list-record": {
      const parsed = parseJsonValue(raw, descriptor.key);
      if (!parsed.ok) return parsed;
      return normalizeStringListRecord(parsed.value, descriptor.key);
    }
    case "json":
      return parseJsonValue(raw, descriptor.key);
    case "timezone":
      return isSupportedTimeZone(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `Unknown IANA time zone '${raw}'.` };
    case "operator-theme":
      return isOperatorThemeName(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `Unknown operator theme '${raw}'.` };
  }
}

/** Normalizes the shared object-of-string-arrays shape identically across CLI and typed callers. */
export function normalizeStringListRecord(value: unknown, key: string): ConfigSettingParse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: `Invalid value for ${key}: expected an object of string arrays.` };
  }
  const out: Record<string, readonly string[]> = {};
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entryValue) || entryValue.some((item) => typeof item !== "string")) {
      return { ok: false, message: `Invalid value for ${key}: expected an object of string arrays.` };
    }
    const normalizedKey = entryKey.trim();
    const normalizedValue = splitList((entryValue as readonly string[]).join(","));
    if (normalizedKey && normalizedValue.length > 0) out[normalizedKey] = normalizedValue;
  }
  return { ok: true, value: out };
}

function parseJsonValue(raw: string, key: string): ConfigSettingParse {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      message: `Invalid JSON value for ${key}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function splitList(raw: string): readonly string[] {
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const GLOBAL: readonly KilnConfigMutationScope[] = ["global"];
const PROJECT: readonly KilnConfigMutationScope[] = ["project"];
const BOTH: readonly KilnConfigMutationScope[] = ["project", "global"];

function descriptor(entry: ConfigSettingDescriptor): readonly [string, ConfigSettingDescriptor] {
  return [entry.key, entry];
}

const CONFIG_SETTING_DESCRIPTORS: ReadonlyMap<string, ConfigSettingDescriptor> = new Map([
  // Operator identity and presentation. Read fresh at each use, never cached
  // into a session or projection, so they govern immediately.
  descriptor({
    key: "ui.theme",
    path: ["ui", "theme"],
    scopes: GLOBAL,
    value: { kind: "operator-theme" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "identity.name",
    path: ["identity", "name"],
    scopes: GLOBAL,
    value: { kind: "text" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "identity.timezone",
    path: ["identity", "timezone"],
    scopes: GLOBAL,
    value: { kind: "timezone" },
    reconciliationTargets: [],
  }),

  // Instruction and skill material reaches harnesses through projections.
  descriptor({
    key: "activeInstructionProfiles",
    path: ["activeInstructionProfiles"],
    scopes: BOTH,
    value: { kind: "string-list" },
    reconciliationTargets: ["repo-shims"],
  }),
  descriptor({
    key: "skills.selection.mode",
    path: ["skills", "selection", "mode"],
    scopes: BOTH,
    value: { kind: "enum", allowed: ["advisory", "auto"] },
    reconciliationTargets: ["native-skills"],
  }),
  descriptor({
    key: "skills.builtin",
    path: ["skills", "builtin"],
    scopes: BOTH,
    value: { kind: "json" },
    section: "advanced",
    reconciliationTargets: ["native-skills"],
  }),
  descriptor({
    key: "skills.visibility.default",
    path: ["skills", "visibility", "default"],
    scopes: GLOBAL,
    value: { kind: "enum", allowed: ["implicit", "explicit-only", "disabled"] },
    reconciliationTargets: ["native-skills"],
  }),
  descriptor({
    key: "skills.visibility.overrides",
    path: ["skills", "visibility", "overrides"],
    scopes: GLOBAL,
    value: { kind: "json" },
    section: "advanced",
    reconciliationTargets: ["native-skills"],
  }),
  descriptor({
    key: "skills.externalCatalog",
    path: ["skills", "externalCatalog"],
    scopes: GLOBAL,
    value: { kind: "json" },
    section: "advanced",
    reconciliationTargets: ["native-skills"],
  }),

  // Work governance binds at the next turn boundary.
  descriptor({
    key: "workGovernance.defaultPosture",
    path: ["workGovernance", "defaultPosture"],
    scopes: BOTH,
    value: { kind: "enum", allowed: ["orchestrate", "direct"] },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "workGovernance.requireDelegationFor",
    path: ["workGovernance", "requireDelegationFor"],
    scopes: BOTH,
    value: { kind: "string-list" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "workGovernance.requiredEvidence",
    path: ["workGovernance", "requiredEvidence"],
    scopes: BOTH,
    value: { kind: "string-list" },
    reconciliationTargets: [],
  }),

  // Project scalars.
  descriptor({
    key: "domain",
    path: ["domain"],
    scopes: PROJECT,
    value: { kind: "text" },
    reconciliationTargets: ["repo-shims"],
  }),
  descriptor({
    key: "channels",
    path: ["channels"],
    scopes: PROJECT,
    value: { kind: "string-list" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "teamMode",
    path: ["teamMode"],
    scopes: PROJECT,
    value: { kind: "text" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "requireApproval",
    path: ["requireApproval"],
    scopes: PROJECT,
    value: { kind: "boolean" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "maxDepth",
    path: ["maxDepth"],
    scopes: PROJECT,
    value: { kind: "number" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "parallelWorkers",
    path: ["parallelWorkers"],
    scopes: PROJECT,
    value: { kind: "number" },
    reconciliationTargets: [],
  }),

  // Permission material. Every row is high or critical in the ledger, so each
  // change is treated as authority-affecting.
  descriptor({
    key: "permissions.approval",
    path: ["permissions", "approval"],
    scopes: PROJECT,
    value: { kind: "enum", allowed: ["never", "on-request", "on-failure", "untrusted"] },
    reconciliationTargets: ["repo-shims"],
  }),
  descriptor({
    key: "permissions.sandbox",
    path: ["permissions", "sandbox"],
    scopes: PROJECT,
    value: { kind: "enum", allowed: ["read-only", "workspace-write", "danger-full-access"] },
    reconciliationTargets: ["repo-shims"],
  }),
  descriptor({
    key: "permissions.safeDefaults",
    path: ["permissions", "safeDefaults"],
    scopes: PROJECT,
    value: { kind: "boolean" },
    reconciliationTargets: ["repo-shims"],
  }),
  descriptor({
    key: "permissions.auditLog",
    path: ["permissions", "auditLog"],
    scopes: PROJECT,
    value: { kind: "boolean" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "permissions.tools",
    path: ["permissions", "tools"],
    scopes: PROJECT,
    value: { kind: "json" },
    section: "advanced",
    reconciliationTargets: ["repo-shims"],
  }),
  descriptor({
    key: "permissions.commands",
    path: ["permissions", "commands"],
    scopes: PROJECT,
    value: { kind: "json" },
    section: "advanced",
    reconciliationTargets: ["repo-shims"],
  }),
  descriptor({
    key: "permissions.fileGovernance",
    path: ["permissions", "fileGovernance"],
    scopes: PROJECT,
    value: { kind: "json" },
    section: "advanced",
    reconciliationTargets: ["repo-shims"],
  }),
  descriptor({
    key: "permissions.dataFirewall",
    path: ["permissions", "dataFirewall"],
    scopes: PROJECT,
    value: { kind: "json" },
    section: "advanced",
    reconciliationTargets: [],
  }),
  descriptor({
    key: "permissions.agentScopes",
    path: ["permissions", "agentScopes"],
    scopes: PROJECT,
    value: { kind: "json" },
    section: "advanced",
    reconciliationTargets: [],
  }),

  // Interactive use grants reach outside the workspace.
  descriptor({
    key: "interactiveUse.enabled",
    path: ["interactiveUse", "enabled"],
    scopes: PROJECT,
    value: { kind: "boolean" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.allowedDomains",
    path: ["interactiveUse", "allowedDomains"],
    scopes: PROJECT,
    value: { kind: "string-list" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.allowedApplications",
    path: ["interactiveUse", "allowedApplications"],
    scopes: PROJECT,
    value: { kind: "string-list" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.applicationAliases",
    path: ["interactiveUse", "applicationAliases"],
    scopes: PROJECT,
    value: { kind: "string-list-record" },
    section: "advanced",
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.allowExternalBrowser",
    path: ["interactiveUse", "allowExternalBrowser"],
    scopes: PROJECT,
    value: { kind: "boolean" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.allowComputer",
    path: ["interactiveUse", "allowComputer"],
    scopes: PROJECT,
    value: { kind: "boolean" },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.browserProvider",
    path: ["interactiveUse", "browserProvider"],
    scopes: PROJECT,
    value: { kind: "enum", allowed: ["none", "playwright"] },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.computerProvider",
    path: ["interactiveUse", "computerProvider"],
    scopes: PROJECT,
    value: { kind: "enum", allowed: ["none", "windows", "windows-uia"] },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.browserEnvironment",
    path: ["interactiveUse", "browserEnvironment"],
    scopes: PROJECT,
    value: { kind: "enum", allowed: ["isolated-headless", "isolated-headed"] },
    reconciliationTargets: [],
  }),
  descriptor({
    key: "interactiveUse.computerEnvironment",
    path: ["interactiveUse", "computerEnvironment"],
    scopes: PROJECT,
    value: { kind: "enum", allowed: ["local-active-desktop"] },
    reconciliationTargets: [],
  }),
]);
