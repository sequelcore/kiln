import { posix, win32 } from "node:path";

const WINDOWS_RESERVED_NAMES = new Set([
  "AUX",
  "CON",
  "NUL",
  "PRN",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

function pathApi(platform = process.platform): typeof posix {
  return platform === "win32" ? win32 : posix;
}

function pathApiForValues(platform: string, ...values: readonly string[]): typeof posix {
  return platform === "win32" || values.some((value) => /^[A-Za-z]:[\\/]/.test(value))
    ? win32
    : posix;
}

export function canonicalSkillKey(name: string, platform = process.platform): string {
  return platform === "win32" ? name.toLowerCase() : name;
}

/** A skill name must stay one component before it can become a target directory. */
export function isSafeProjectionPathComponent(name: string, platform = process.platform): boolean {
  if (!name || name === "." || name === ".." || name !== name.trim()) return false;
  if (/[\\/\u0000-\u001f<>:\"|?*]/.test(name)) return false;
  const paths = pathApi(platform);
  if (paths.isAbsolute(name) || paths.basename(name) !== name) return false;
  if (/[ .]$/.test(name)) return false;
  const baseName = (name.replace(/[. ]+$/g, "").split(".", 1)[0] ?? "").toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(baseName)) return false;
  return true;
}

export function isSafeProjectionRelativePath(path: string, platform = process.platform): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  const components = path.replaceAll("\\", "/").split("/");
  return components.every((component) => isSafeProjectionPathComponent(component, platform));
}

export function resolveProjectionPathWithin(
  root: string,
  candidate: string,
  platform = process.platform,
): string | undefined {
  const paths = pathApiForValues(platform, root, candidate);
  const resolvedRoot = paths.resolve(root);
  const resolvedCandidate = paths.resolve(candidate);
  const relativePath = paths.relative(resolvedRoot, resolvedCandidate);
  return relativePath !== ""
    && !relativePath.startsWith("..")
    && !paths.isAbsolute(relativePath)
    ? candidate
    : undefined;
}

export function normalizeProjectionPath(path: string, platform = process.platform): string {
  const paths = pathApiForValues(platform, path);
  const normalized = paths.normalize(path);
  return paths === win32 ? normalized.toLowerCase() : normalized;
}
