import {
  type CommunicationIntent,
  resolveCommunicationIntent,
  type VoiceConfig,
  validateVoiceConfig,
} from "@kilnai/core";
import { isOperatorThemeName, OPERATOR_THEME_DEFINITIONS_BY_ID } from "@kilnai/operator-appearance";
import { KilnYamlError } from "../../../kiln-yaml.js";
import type { KilnGlobalIdentity, KilnGlobalUiConfig } from "../../global-config-schema.js";
import {
  fieldNamesOf,
  isRecord,
  rejectUnknownFields,
  validateCanonicalId,
  validateOptionalNonEmptyString,
} from "./shared.js";

const IDENTITY_FIELDS = fieldNamesOf<KilnGlobalIdentity>({
  name: true,
  timezone: true,
});

export function validateIdentity(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("identity must be an object");
  }
  rejectUnknownFields(value, IDENTITY_FIELDS, "identity");
  validateOptionalNonEmptyString(value, "name", "identity.name");
  validateOptionalNonEmptyString(value, "timezone", "identity.timezone");
  if (typeof value.timezone === "string") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timezone.trim() }).format();
    } catch {
      throw new KilnYamlError("identity.timezone must be a valid IANA time zone");
    }
  }
}

export function validateOperatorVoice(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("operatorVoice must be an object");
  }
  const validationErrors = validateVoiceConfig(value as unknown as VoiceConfig);
  if (validationErrors.length > 0) {
    const first = validationErrors[0]!;
    throw new KilnYamlError(`operatorVoice.${first.field} ${first.message}`);
  }
}

const GLOBAL_UI_FIELDS = fieldNamesOf<KilnGlobalUiConfig>({
  appearance: true,
  targetSelection: true,
});

export function validateGlobalUi(value: unknown, targetCatalog: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("ui must be an object");
  }
  rejectUnknownFields(value, GLOBAL_UI_FIELDS, "ui");
  if (value.appearance !== undefined) {
    if (!isRecord(value.appearance)) throw new KilnYamlError("ui.appearance must be an object");
    rejectUnknownFields(value.appearance, ["mode", "themeByScheme"], "ui.appearance");
    if (value.appearance.mode !== "system" && value.appearance.mode !== "light" && value.appearance.mode !== "dark") {
      throw new KilnYamlError("ui.appearance.mode must be system, light, or dark");
    }
    if (!isRecord(value.appearance.themeByScheme)) {
      throw new KilnYamlError("ui.appearance.themeByScheme must be an object");
    }
    rejectUnknownFields(value.appearance.themeByScheme, ["light", "dark"], "ui.appearance.themeByScheme");
    validateBuiltInThemeForScheme(value.appearance.themeByScheme.light, "light");
    validateBuiltInThemeForScheme(value.appearance.themeByScheme.dark, "dark");
  }
  if (value.targetSelection === undefined) {
    return;
  }
  if (!isRecord(value.targetSelection)) {
    throw new KilnYamlError("ui.targetSelection must be an object");
  }
  const selection = value.targetSelection;
  const targetSelectionFields = new Set(["targetId", "accountOverrideId"]);
  for (const key of Object.keys(selection)) {
    if (!targetSelectionFields.has(key)) {
      throw new KilnYamlError(`Unknown ui.targetSelection field: ${key}`);
    }
  }
  validateCanonicalId(selection.targetId, "ui.targetSelection.targetId");
  if (!isRecord(targetCatalog) || !Array.isArray(targetCatalog.targets)) {
    throw new KilnYamlError("ui.targetSelection requires targetCatalog.targets");
  }
  const selectedTarget = targetCatalog.targets.find((target) => isRecord(target) && target.id === selection.targetId);
  if (!isRecord(selectedTarget)) {
    throw new KilnYamlError("ui.targetSelection.targetId references an unknown target");
  }
  if (selectedTarget.kind !== "direct") {
    throw new KilnYamlError("ui.targetSelection.targetId must reference a direct target");
  }
  if (selection.accountOverrideId !== undefined) {
    validateCanonicalId(selection.accountOverrideId, "ui.targetSelection.accountOverrideId");
    const routeSelection = selectedTarget.accountSelection;
    if (!isRecord(routeSelection) || routeSelection.mode !== "automatic") {
      throw new KilnYamlError("ui.targetSelection.accountOverrideId requires an automatic direct target");
    }
    if (!Array.isArray(targetCatalog.accountPolicies)) {
      throw new KilnYamlError("ui.targetSelection.accountOverrideId requires targetCatalog.accountPolicies");
    }
    const policy = targetCatalog.accountPolicies.find(
      (entry) => isRecord(entry) && entry.id === routeSelection.accountPolicyId,
    );
    if (
      !isRecord(policy) ||
      !Array.isArray(policy.accountIds) ||
      !policy.accountIds.includes(selection.accountOverrideId)
    ) {
      throw new KilnYamlError("ui.targetSelection.accountOverrideId is not eligible for the selected target");
    }
  }
}

function validateBuiltInThemeForScheme(value: unknown, scheme: "light" | "dark"): void {
  const path = `ui.appearance.themeByScheme.${scheme}`;
  if (!isOperatorThemeName(value)) {
    throw new KilnYamlError(`${path} must reference a built-in operator theme`);
  }
  if (!OPERATOR_THEME_DEFINITIONS_BY_ID[value].variants[scheme]) {
    throw new KilnYamlError(`${path} theme '${value}' has no ${scheme} variant`);
  }
}

export function validateCommunication(value: unknown, path: string, source: "global" | "project"): void {
  if (value === undefined) return;
  try {
    resolveCommunicationIntent([
      {
        source,
        intent: value as CommunicationIntent,
      },
    ]);
  } catch (error) {
    throw new KilnYamlError(`${path} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}
