import { KilnYamlError } from "../../../kiln-yaml.js";
import {
  isRecord,
  validateRequiredNonEmptyString,
} from "./shared.js";

export function validateModelTaskSuitability(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new KilnYamlError("modelTaskSuitability must be an array");
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      throw new KilnYamlError(`modelTaskSuitability[${index}] must be an object`);
    }
    validateRequiredNonEmptyString(entry, "provider", `modelTaskSuitability[${index}].provider`);
    validateRequiredNonEmptyString(entry, "model", `modelTaskSuitability[${index}].model`);
    validateRequiredNonEmptyString(entry, "reason", `modelTaskSuitability[${index}].reason`);
    if (!isModelTaskSuitabilityTask(entry.task)) {
      throw new KilnYamlError(`modelTaskSuitability[${index}].task is not supported`);
    }
    if (!isModelTaskSuitabilityLevel(entry.level)) {
      throw new KilnYamlError(`modelTaskSuitability[${index}].level must be "preferred", "capable", or "limited"`);
    }
  }
}

export function validateDeliberationPolicy(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("deliberationPolicy must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "default" && key !== "byTask" && key !== "byRoute") {
      throw new KilnYamlError(`Unknown deliberationPolicy field: ${key}`);
    }
  }
  if (value.default !== undefined) {
    validateDeliberationRule(value.default, "deliberationPolicy.default", false);
  }
  if (value.byTask !== undefined) {
    if (!isRecord(value.byTask)) {
      throw new KilnYamlError("deliberationPolicy.byTask must be an object");
    }
    for (const [task, rule] of Object.entries(value.byTask)) {
      if (!isModelTaskSuitabilityTask(task)) {
        throw new KilnYamlError(`deliberationPolicy.byTask.${task} is not a supported task`);
      }
      validateDeliberationRule(rule, `deliberationPolicy.byTask.${task}`, false);
    }
  }
  if (value.byRoute !== undefined) {
    if (!Array.isArray(value.byRoute)) {
      throw new KilnYamlError("deliberationPolicy.byRoute must be an array");
    }
    const identities = new Set<string>();
    for (let index = 0; index < value.byRoute.length; index += 1) {
      const path = `deliberationPolicy.byRoute[${index}]`;
      const rule = value.byRoute[index];
      validateDeliberationRule(rule, path, true);
      const route = rule as Record<string, unknown>;
      validateRequiredNonEmptyString(route, "provider", `${path}.provider`);
      validateRequiredNonEmptyString(route, "model", `${path}.model`);
      const identity = `${route.provider}/${route.model}`;
      if (identities.has(identity)) {
        throw new KilnYamlError(`${path} duplicates route ${identity}`);
      }
      identities.add(identity);
    }
  }
}

function validateDeliberationRule(value: unknown, path: string, route: boolean): void {
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  const allowed = new Set(["mode", "target", "preferredLevel", "bounds", "onUnsupported"]);
  if (route) {
    allowed.add("provider");
    allowed.add("model");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new KilnYamlError(`Unknown ${path} field: ${key}`);
    }
  }
  if (value.mode !== "provider-default" && value.mode !== "fixed" && value.mode !== "adaptive") {
    throw new KilnYamlError(`${path}.mode must be "provider-default", "fixed", or "adaptive"`);
  }
  if (value.onUnsupported !== undefined
    && value.onUnsupported !== "deny"
    && value.onUnsupported !== "omit"
    && value.onUnsupported !== "allow-clamp") {
    throw new KilnYamlError(`${path}.onUnsupported must be "deny", "omit", or "allow-clamp"`);
  }
  if (value.mode === "provider-default") {
    if (value.target !== undefined || value.preferredLevel !== undefined || value.bounds !== undefined) {
      throw new KilnYamlError(`${path} provider-default mode cannot set target, preferredLevel, or bounds`);
    }
    return;
  }
  if (value.mode === "fixed") {
    if (!isDeliberationLevelId(value.preferredLevel)) {
      throw new KilnYamlError(`${path}.preferredLevel is required when mode is fixed`);
    }
    if (value.target !== undefined) {
      throw new KilnYamlError(`${path} fixed mode cannot set target`);
    }
  } else {
    if (value.target !== "latency-first" && value.target !== "balanced" && value.target !== "quality-first") {
      throw new KilnYamlError(`${path}.target must be "latency-first", "balanced", or "quality-first"`);
    }
    if (value.preferredLevel !== undefined) {
      throw new KilnYamlError(`${path} adaptive mode cannot set preferredLevel`);
    }
  }
  if (value.bounds !== undefined) {
    if (!isRecord(value.bounds)) {
      throw new KilnYamlError(`${path}.bounds must be an object`);
    }
    for (const key of Object.keys(value.bounds)) {
      if (key !== "min" && key !== "max") {
        throw new KilnYamlError(`Unknown ${path}.bounds field: ${key}`);
      }
    }
    if (value.bounds.min !== undefined && !isDeliberationLevelId(value.bounds.min)) {
      throw new KilnYamlError(`${path}.bounds.min must be a portable deliberation level identifier`);
    }
    if (value.bounds.max !== undefined && !isDeliberationLevelId(value.bounds.max)) {
      throw new KilnYamlError(`${path}.bounds.max must be a portable deliberation level identifier`);
    }
  }
}

function isModelTaskSuitabilityTask(value: unknown): boolean {
  return value === "architecture-review"
    || value === "backend-coding"
    || value === "frontend-design"
    || value === "mechanical-edit"
    || value === "research"
    || value === "test-writing";
}

function isDeliberationLevelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value);
}

function isModelTaskSuitabilityLevel(value: unknown): boolean {
  return value === "preferred" || value === "capable" || value === "limited";
}
