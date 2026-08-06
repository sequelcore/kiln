import { access } from "node:fs/promises";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}

export function uniqueNumbers(values: readonly number[]): readonly number[] {
  return Array.from(new Set(values));
}
