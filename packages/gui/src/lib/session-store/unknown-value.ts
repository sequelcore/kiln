/**
 * Narrow-and-read primitives for values of unknown shape (parsed JSON frame
 * payloads, persisted localStorage records, event details). Pure, no store
 * dependency.
 */

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : null;
  }
  return null;
}

export function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringField<TName extends string>(
  name: TName,
  value: string | null,
): Record<TName, string> | Record<string, never> {
  return value ? { [name]: value } as Record<TName, string> : {};
}
