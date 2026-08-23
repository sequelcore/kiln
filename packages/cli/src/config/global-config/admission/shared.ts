import { describeRunningCliBuild } from "../../../build-identity.js";
import { KilnYamlError } from "../../../kiln-yaml.js";

/** Keeps interface-backed allowlists coupled to their admitted types. */
export function fieldNamesOf<T>(fields: Record<keyof T, true>): readonly string[] {
  return Object.keys(fields);
}

export function validateOptionalNonEmptyString(record: Record<string, unknown>, key: string, path: string): void {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KilnYamlError(`${path} must be a non-empty string`);
  }
}

export function validateStringArray(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new KilnYamlError(`${path} must be an array of non-empty strings`);
  }
}

export function validateOptionalRecord(record: Record<string, unknown>, key: string, path: string): void {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
}

export function validateRecordField(config: Record<string, unknown>, field: string): void {
  const value = config[field];
  if (value !== undefined && !isRecord(value)) {
    throw new KilnYamlError(`${field} must be an object`);
  }
}

export function validateRequiredNonEmptyString(record: Record<string, unknown>, key: string, path: string): void {
  if (typeof record[key] !== "string" || record[key].trim().length === 0) {
    throw new KilnYamlError(`${path} must be a non-empty string`);
  }
}

export function validateRequiredHttpsUrlString(record: Record<string, unknown>, key: string, path: string): void {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KilnYamlError(`${path} must be a non-empty HTTPS URL string`);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new KilnYamlError(`${path} must be a non-empty HTTPS URL string`);
    }
  } catch {
    throw new KilnYamlError(`${path} must be a non-empty HTTPS URL string`);
  }
}

export function validateOptionalStringArray(value: unknown, path: string): void {
  if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0))) {
    throw new KilnYamlError(`${path} must be an array of non-empty strings`);
  }
}

export function validateOptionalWriteMode(value: unknown, path: string): void {
  if (value !== undefined && value !== "none" && value !== "propose" && value !== "apply-approved") {
    throw new KilnYamlError(`${path} must be "none", "propose", or "apply-approved"`);
  }
}

/** Single build-identified diagnostic owner for unknown semantic fields. */
export function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  hint?: string,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) {
      continue;
    }
    throw new KilnYamlError(
      `Unknown ${path} field: ${key}.${hint === undefined ? "" : ` ${hint}`}`
      + ` Validated by ${describeRunningCliBuild()};`
      + " if this field exists at HEAD, the running build predates it.",
    );
  }
}

export function validateCanonicalId(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new KilnYamlError(`${path} must be a canonical id`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
