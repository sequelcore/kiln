export function requireInputRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid input: ${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function requireInputArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid input: ${field} must be an array.`);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key) => expectedKeys.includes(key));
}

export function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  field: string,
  requiredKeys: readonly string[] = allowedKeys,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${field} has an invalid shape or extra field`);
  }
  if (requiredKeys.some((key) => !hasOwn(value, key))) {
    throw new Error(`${field} has an invalid shape or missing field`);
  }
}

export function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readTextArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? uniqueText(value.map(readText).filter((item): item is string => item !== undefined))
    : [];
}

export function uniqueText(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
