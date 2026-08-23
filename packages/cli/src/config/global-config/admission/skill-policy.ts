import { KilnYamlError } from "../../../kiln-yaml.js";
import { validateSkillVisibilityConfig } from "../../skill-visibility.js";
import {
  isRecord,
  validateOptionalStringArray,
} from "./shared.js";

export function validateSkills(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("skills must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "builtin" && key !== "selection" && key !== "visibility" && key !== "externalCatalog") {
      throw new KilnYamlError(`Unknown skills field: ${key}`);
    }
  }
  if (value.builtin !== undefined) {
    if (!isRecord(value.builtin)) {
      throw new KilnYamlError("skills.builtin must be an object");
    }
    for (const key of Object.keys(value.builtin)) {
      if (key !== "enabled" && key !== "include" && key !== "exclude") {
        throw new KilnYamlError(`Unknown skills.builtin field: ${key}`);
      }
    }
    if (value.builtin.enabled !== undefined && typeof value.builtin.enabled !== "boolean") {
      throw new KilnYamlError("skills.builtin.enabled must be a boolean");
    }
    validateOptionalStringArray(value.builtin.include, "skills.builtin.include");
    validateOptionalStringArray(value.builtin.exclude, "skills.builtin.exclude");
  }
  if (value.selection !== undefined) {
    if (!isRecord(value.selection)) {
      throw new KilnYamlError("skills.selection must be an object");
    }
    for (const key of Object.keys(value.selection)) {
      if (key !== "mode") {
        throw new KilnYamlError(`Unknown skills.selection field: ${key}`);
      }
    }
    if (
      value.selection.mode !== undefined
      && value.selection.mode !== "advisory"
      && value.selection.mode !== "auto"
    ) {
      throw new KilnYamlError("skills.selection.mode must be advisory or auto");
    }
  }
  if (value.visibility !== undefined) {
    validateSkillVisibilityConfig(value.visibility);
  }
  if (value.externalCatalog !== undefined) validateExternalCatalogPolicy(value.externalCatalog);
}

function validateExternalCatalogPolicy(value: unknown): void {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.harnesses)) {
    throw new KilnYamlError("skills.externalCatalog must declare version: 1 and a harnesses object");
  }
  for (const key of Object.keys(value)) if (key !== "version" && key !== "harnesses") throw new KilnYamlError(`Unknown skills.externalCatalog field: ${key}`);
  for (const key of Object.keys(value.harnesses)) {
    if (key !== "codex" && key !== "claude" && key !== "opencode") throw new KilnYamlError(`Unknown skills.externalCatalog harness: ${key}`);
    if (key !== "codex") throw new KilnYamlError(`skills.externalCatalog.${key} is unsupported by this build`);
  }
  if (!isRecord(value.harnesses.codex) || !Array.isArray(value.harnesses.codex.keepImplicit)
    || typeof value.harnesses.codex.expectedFingerprint !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(value.harnesses.codex.expectedFingerprint)) {
    throw new KilnYamlError("skills.externalCatalog.harnesses.codex requires expectedFingerprint and keepImplicit array");
  }
  for (const key of Object.keys(value.harnesses.codex)) if (key !== "keepImplicit" && key !== "expectedFingerprint") throw new KilnYamlError(`Unknown skills.externalCatalog.harnesses.codex field: ${key}`);
  const sourceIds = new Set<string>();
  for (const decision of value.harnesses.codex.keepImplicit) {
    if (!isRecord(decision) || typeof decision.sourceId !== "string" || decision.sourceId.length === 0
      || typeof decision.packageDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(decision.packageDigest)) {
      throw new KilnYamlError("skills.externalCatalog.harnesses.codex.keepImplicit entries require sourceId and sha256 packageDigest");
    }
    for (const key of Object.keys(decision)) if (key !== "sourceId" && key !== "packageDigest") throw new KilnYamlError(`Unknown external catalog decision field: ${key}`);
    if (sourceIds.has(decision.sourceId)) throw new KilnYamlError(`Duplicate external catalog sourceId: ${decision.sourceId}`);
    sourceIds.add(decision.sourceId);
  }
}
