import { win32 as pathWin32 } from "node:path";

export function normalizeLeasePath(value: string): string {
  const normalized = pathWin32.normalize(value.replace(/\//gu, "\\")).replace(/\\/gu, "/");
  return normalized.replace(/\/+$/u, "").toLowerCase();
}

export function samePath(left: string, right: string): boolean {
  return normalizeLeasePath(left) === normalizeLeasePath(right);
}

export function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeLeasePath(left);
  const normalizedRight = normalizeLeasePath(right);
  return normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`);
}
