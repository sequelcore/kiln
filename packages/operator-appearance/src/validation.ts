import { assertOperatorColor, operatorColorToHex } from "./colors.js";
import type {
  ColorScheme,
  OperatorAppearancePreference,
  OperatorThemeDefinition,
  OperatorThemePalette,
} from "./types.js";

const PALETTE_KEYS = [
  "appearance",
  "surface",
  "text",
  "control",
  "conversation",
  "sidebar",
  "toolbar",
  "terminal",
  "status",
] as const;
const SURFACE_KEYS = ["canvas", "chrome", "default", "raised", "overlay", "border", "input"] as const;
const TEXT_KEYS = ["default", "muted", "placeholder", "secondaryLabel", "iconMuted"] as const;
const CONTROL_KEYS = [
  "focus",
  "accent",
  "accentForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accentSurface",
  "accentSurfaceForeground",
] as const;
const MESSAGE_KEYS = ["surface", "foreground", "action", "actionForeground", "actionHover"] as const;
const CODE_KEYS = ["background", "foreground"] as const;
const SIDEBAR_KEYS = [
  "background",
  "foreground",
  "mutedForeground",
  "control",
  "hover",
  "active",
  "selected",
  "border",
] as const;
const TOOLBAR_KEYS = ["background", "foreground", "border", "control", "controlForeground", "hover"] as const;
const TERMINAL_KEYS = ["background", "foreground", "cursor", "selection", "scrollbar", "scrollbarHover"] as const;
const STATUS_KEYS = ["error", "warning", "update", "success", "info"] as const;
const STATUS_COLOR_KEYS = ["color", "foreground", "surface"] as const;

type UnknownRecord = Record<string, unknown>;

function property(value: UnknownRecord, key: string): unknown {
  return Reflect.get(value, key);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (actualKeys.some((key) => typeof key !== "string")) return false;
  if (actualKeys.length !== keys.length) return false;
  return keys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyAllowedKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.has(key));
}

function assertRecordWithKeys(value: unknown, keys: readonly string[], label: string): asserts value is UnknownRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) {
    throw new TypeError(`${label} has an unsupported shape.`);
  }
}

function assertRecordWithAllowedKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is UnknownRecord {
  if (!isPlainRecord(value) || !hasOnlyAllowedKeys(value, keys)) {
    throw new TypeError(`${label} has an unsupported shape.`);
  }
}

function assertColorRole(value: unknown, label: string): void {
  try {
    assertOperatorColor(value);
    operatorColorToHex(value);
  } catch (error) {
    if (error instanceof Error) {
      throw new TypeError(`${label} is invalid: ${error.message}`);
    }
    throw error;
  }
}

function assertColorRoles(value: unknown, keys: readonly string[], label: string): void {
  assertRecordWithKeys(value, keys, label);
  for (const key of keys) {
    assertColorRole(value[key], `${label}.${key}`);
  }
}

/** Validates one semantic palette at the boundary. */
export function assertOperatorThemePalette(
  value: unknown,
  expectedScheme?: ColorScheme,
): asserts value is OperatorThemePalette {
  assertRecordWithKeys(value, PALETTE_KEYS, "Operator theme palette");
  const appearance = property(value, "appearance");
  if (appearance !== "light" && appearance !== "dark") {
    throw new TypeError("Operator theme palette appearance must be light or dark.");
  }
  if (expectedScheme !== undefined && appearance !== expectedScheme) {
    throw new TypeError(`Operator theme palette appearance must match the ${expectedScheme} variant.`);
  }

  assertColorRoles(property(value, "surface"), SURFACE_KEYS, "Operator theme palette.surface");
  assertColorRoles(property(value, "text"), TEXT_KEYS, "Operator theme palette.text");
  assertColorRoles(property(value, "control"), CONTROL_KEYS, "Operator theme palette.control");

  const conversation = property(value, "conversation");
  assertRecordWithKeys(conversation, ["message", "code"], "Operator theme palette.conversation");
  assertColorRoles(property(conversation, "message"), MESSAGE_KEYS, "Operator theme palette.conversation.message");
  assertColorRoles(property(conversation, "code"), CODE_KEYS, "Operator theme palette.conversation.code");

  assertColorRoles(property(value, "sidebar"), SIDEBAR_KEYS, "Operator theme palette.sidebar");
  assertColorRoles(property(value, "toolbar"), TOOLBAR_KEYS, "Operator theme palette.toolbar");
  assertColorRoles(property(value, "terminal"), TERMINAL_KEYS, "Operator theme palette.terminal");

  const status = property(value, "status");
  assertRecordWithKeys(status, STATUS_KEYS, "Operator theme palette.status");
  for (const key of STATUS_KEYS) {
    assertColorRoles(status[key], STATUS_COLOR_KEYS, `Operator theme palette.status.${key}`);
  }
}

/** Validates and narrows a complete theme definition. */
export function assertOperatorThemeDefinition(value: unknown): asserts value is OperatorThemeDefinition {
  assertRecordWithKeys(value, ["schemaVersion", "id", "label", "variants"], "Operator theme definition");
  if (property(value, "schemaVersion") !== 1) {
    throw new TypeError("Operator theme definition schemaVersion must be 1.");
  }
  const id = property(value, "id");
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new TypeError("Operator theme definition id must be a non-empty string.");
  }
  const label = property(value, "label");
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new TypeError("Operator theme definition label must be a non-empty string.");
  }
  const variantsRecord = property(value, "variants");
  assertRecordWithAllowedKeys(variantsRecord, ["light", "dark"], "Operator theme definition variants");
  const variants = ["light", "dark"] as const;
  let variantCount = 0;
  for (const scheme of variants) {
    if (Object.hasOwn(variantsRecord, scheme)) {
      variantCount += 1;
      assertOperatorThemePalette(variantsRecord[scheme], scheme);
    }
  }
  if (variantCount === 0) {
    throw new TypeError("Operator theme definition must provide at least one light or dark variant.");
  }
}

/** Returns true only for a complete, supported theme definition. */
export function isOperatorThemeDefinition(value: unknown): value is OperatorThemeDefinition {
  try {
    assertOperatorThemeDefinition(value);
    return true;
  } catch {
    return false;
  }
}

/** Validates and returns a theme definition for use by pure policy functions. */
export function validateOperatorThemeDefinition(value: unknown): OperatorThemeDefinition {
  assertOperatorThemeDefinition(value);
  return value;
}

/** Alias for callers that treat validation as parsing an untrusted value. */
export function parseOperatorThemeDefinition(value: unknown): OperatorThemeDefinition {
  return validateOperatorThemeDefinition(value);
}

/** Validates and narrows one appearance preference at the boundary. */
export function assertOperatorAppearancePreference(value: unknown): asserts value is OperatorAppearancePreference {
  assertRecordWithKeys(value, ["mode", "themeByScheme"], "Operator appearance preference");
  const mode = property(value, "mode");
  if (mode !== "system" && mode !== "light" && mode !== "dark") {
    throw new TypeError("Operator appearance preference mode must be system, light, or dark.");
  }
  const themesByScheme = property(value, "themeByScheme");
  assertRecordWithKeys(themesByScheme, ["light", "dark"], "Operator appearance preference themeByScheme");
  for (const scheme of ["light", "dark"] as const) {
    const themeId = themesByScheme[scheme];
    if (typeof themeId !== "string" || themeId.trim().length === 0) {
      throw new TypeError(`Operator appearance preference themeByScheme.${scheme} must be a non-empty string.`);
    }
  }
}

/** Returns true only for a complete, supported appearance preference. */
export function isOperatorAppearancePreference(value: unknown): value is OperatorAppearancePreference {
  try {
    assertOperatorAppearancePreference(value);
    return true;
  } catch {
    return false;
  }
}

/** Validates and returns an appearance preference for use by pure policy functions. */
export function validateOperatorAppearancePreference(value: unknown): OperatorAppearancePreference {
  assertOperatorAppearancePreference(value);
  return value;
}

/** Alias for callers that treat validation as parsing an untrusted value. */
export function parseOperatorAppearancePreference(value: unknown): OperatorAppearancePreference {
  return validateOperatorAppearancePreference(value);
}
