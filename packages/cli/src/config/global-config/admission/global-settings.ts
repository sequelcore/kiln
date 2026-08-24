import { KilnYamlError } from "../../../kiln-yaml.js";
import type { KilnGlobalWebConfig } from "../../global-config-schema.js";
import {
  fieldNamesOf,
  isRecord,
  rejectUnknownFields,
  validateOptionalRecord,
  validateOptionalStringArray,
} from "./shared.js";

/** Root-owned leaf settings that do not delegate to another semantic contract. */
const GLOBAL_WEB_FIELDS = fieldNamesOf<KilnGlobalWebConfig>({
  enabled: true,
  netPolicy: true,
  allowedDomains: true,
  searchProvider: true,
  searchFallbackProviders: true,
  extractProvider: true,
});

export function validateGlobalWeb(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("web must be an object");
  }
  rejectUnknownFields(
    value,
    GLOBAL_WEB_FIELDS,
    "global web",
    "Global config owns web capability ceilings and provider connections.",
  );
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new KilnYamlError("web.enabled must be a boolean");
  }
  if (
    value.netPolicy !== undefined
    && !["none", "documentation", "package-managers", "full"].includes(String(value.netPolicy))
  ) {
    throw new KilnYamlError("web.netPolicy is invalid");
  }
  validateOptionalStringArray(value.allowedDomains, "web.allowedDomains");
  validateOptionalRecord(value, "searchProvider", "web.searchProvider");
  if (value.searchFallbackProviders !== undefined && !Array.isArray(value.searchFallbackProviders)) {
    throw new KilnYamlError("web.searchFallbackProviders must be an array");
  }
  if (Array.isArray(value.searchFallbackProviders)) {
    value.searchFallbackProviders.forEach((provider, index) => {
      if (!isRecord(provider)) {
        throw new KilnYamlError(`web.searchFallbackProviders[${index}] must be an object`);
      }
    });
  }
  validateOptionalRecord(value, "extractProvider", "web.extractProvider");
}

export function validatePermissionCeiling(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("permissionCeiling must be an object");
  rejectUnknownFields(value, ["approval", "sandbox"], "permissionCeiling");
  if (value.approval !== undefined
    && !["never", "on-request", "on-failure", "untrusted"].includes(String(value.approval))) {
    throw new KilnYamlError("permissionCeiling.approval is invalid");
  }
  if (value.sandbox !== undefined
    && !["read-only", "workspace-write", "danger-full-access"].includes(String(value.sandbox))) {
    throw new KilnYamlError("permissionCeiling.sandbox is invalid");
  }
}

export function validateSessionTurnBudget(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("sessionTurnBudget must be an object");
  rejectUnknownFields(value, ["tokenLimit", "action"], "sessionTurnBudget");
  if (!Number.isSafeInteger(value.tokenLimit) || (value.tokenLimit as number) <= 0) throw new KilnYamlError("sessionTurnBudget.tokenLimit must be a positive safe integer");
  if (value.action !== "stop") throw new KilnYamlError("sessionTurnBudget.action must be \"stop\"");
}

export function validateComponents(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("components must be an object");
  }
  if (value.include !== undefined) {
    if (!Array.isArray(value.include) || value.include.some((item) => typeof item !== "string")) {
      throw new KilnYamlError("components.include must be an array of strings");
    }
  }
}
