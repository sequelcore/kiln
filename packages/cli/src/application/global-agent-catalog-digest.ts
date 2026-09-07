import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";

const DOMAIN = "kiln:global-agent-catalog:v1\0";

/**
 * Captures the global Markdown agent sources consumed by `loadGlobalAgentDefinitions`.
 * Links are rejected rather than followed; unreadable Markdown is represented because
 * the loader skips it and that skip is part of the effective catalog.
 */
export function captureGlobalAgentCatalogDigest(directory: string): "absent" | `sha256:${string}` {
  const root = resolve(directory);
  let before: Stats;
  try {
    before = lstatSync(root);
  } catch (error) {
    if (isMissingError(error)) return "absent";
    throw error;
  }
  assertSafeDirectory(before, root);

  const first = captureRecords(root);
  const after = lstatSync(root);
  assertSafeDirectory(after, root);
  if (!sameStat(before, after)) {
    throw new Error(`Global agent catalog changed during revision capture: ${root}`);
  }

  const second = captureRecords(root);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(`Global agent catalog changed during revision capture: ${root}`);
  }

  return `sha256:${createHash("sha256")
    .update(DOMAIN, "utf8")
    .update(JSON.stringify(first), "utf8")
    .digest("hex")}`;
}

function captureRecords(directory: string): readonly (readonly [string, "content", string] | readonly [string, "unreadable"])[] {
  const entries = readdirSync(directory)
    .filter((entry) => entry.toLowerCase().endsWith(".md"))
    .sort(compareCodeUnits);
  return entries.map((entry) => captureEntry(directory, entry));
}

function captureEntry(directory: string, entry: string): readonly [string, "content", string] | readonly [string, "unreadable"] {
  const path = join(directory, entry);
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch (error) {
    if (isMissingError(error)) throw new Error(`Global agent catalog changed during revision capture: ${path}`);
    return [entry, "unreadable"];
  }
  if (before.isSymbolicLink() || (!before.isFile() && !before.isDirectory())) {
    throw new Error(`Unsafe global agent catalog entry: ${path}`);
  }
  if (!before.isFile()) return [entry, "unreadable"];

  try {
    const bytes = readFileSync(path);
    const after = lstatSync(path);
    if (!after.isFile() || after.isSymbolicLink() || !sameStat(before, after) || !bytes.equals(readFileSync(path))) {
      throw new Error(`Global agent catalog changed during revision capture: ${path}`);
    }
    return [entry, "content", createHash("sha256").update(bytes).digest("hex")];
  } catch (error) {
    if (isMissingError(error)) throw new Error(`Global agent catalog changed during revision capture: ${path}`);
    if (error instanceof Error && error.message.startsWith("Global agent catalog changed during revision capture:")) throw error;
    return [entry, "unreadable"];
  }
}

function assertSafeDirectory(stat: Stats, path: string): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe global agent catalog directory: ${path}`);
}

function sameStat(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function isMissingError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT" || (error as { readonly code?: unknown }).code === "ENOTDIR");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
