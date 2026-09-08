import { Value } from "@sinclair/typebox/value";
import { externalSkillCatalogPolicySchema } from "../../external-skill-policy.js";
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
  if (!Value.Check(externalSkillCatalogPolicySchema, value)) {
    const error = Value.Errors(externalSkillCatalogPolicySchema, value).First();
    throw new KilnYamlError(`Invalid skills.externalCatalog${error?.path ?? ""}: ${error?.message ?? "invalid policy"}`);
  }
  const sourceIds = new Set<string>();
  for (const decision of value.harnesses.codex.keepImplicit) {
    if (sourceIds.has(decision.sourceId)) throw new KilnYamlError(`Duplicate external catalog sourceId: ${decision.sourceId}`);
    sourceIds.add(decision.sourceId);
  }
}
