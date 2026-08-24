import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join, posix, resolve, win32 } from "node:path";
import { resolveKilnHomePath } from "../config/global-config/path.js";

export type ProjectStatePlatform = "posix" | "win32";

export interface ProjectStateRootOptions {
  /** Explicit Kiln home seam. Production callers leave this unset. */
  readonly kilnHome?: string;
  /** Pure identity/path normalization seam for Windows/POSIX tests. */
  readonly platform?: ProjectStatePlatform;
}

export interface ProjectStateBinding {
  /** Existing, canonical physical project root. */
  readonly canonicalRoot: string;
  /** Canonical operator Kiln home shared by CLI and Runtime composition. */
  readonly kilnHome: string;
  /** Opaque, versioned identity derived only from canonicalRoot. */
  readonly projectRuntimeId: `krp_${string}`;
  /** Operator-private root; never a repository-local path. */
  readonly projectStateRoot: string;
  readonly adoptionManifestPath: string;
  readonly configPath: string;
  readonly contextPath: string;
  readonly agentsPath: string;
  readonly instructionsPath: string;
  readonly skillsPath: string;
  readonly runtimePath: string;
  readonly sessionsPath: string;
  readonly cachePath: string;
  readonly backupsPath: string;
  readonly mutationsPath: string;
  readonly projectionsPath: string;
  readonly domainsPath: string;
  readonly evidencePath: string;
  readonly memoryPath: string;
  readonly feedbackPath: string;
  readonly benchmarksPath: string;
  readonly tmpPath: string;
}

const PROJECT_IDENTITY_DOMAIN = "kiln:project-root:v2\0";

/**
 * Normalize the path bytes that participate in project identity.
 *
 * The caller must provide an existing canonical root when using the binding
 * API. This pure helper is exported so Windows and POSIX normalization can be
 * tested without pretending one host filesystem is another.
 */
export function normalizeProjectRootIdentity(
  rootPath: string,
  platform: ProjectStatePlatform = process.platform === "win32" ? "win32" : "posix",
): string {
  const pathApi = platform === "win32" ? win32 : posix;
  const normalized = pathApi.normalize(rootPath).replaceAll("\\", "/");
  if (platform === "win32") {
    if (/^[a-zA-Z]:\/$/u.test(normalized)) return normalized.toLowerCase();
    const withoutTrailingSeparators = normalized.replace(/\/+$/u, "");
    return (withoutTrailingSeparators || "/").toLowerCase();
  }
  const withoutTrailingSeparators = normalized.replace(/\/+$/u, "");
  return withoutTrailingSeparators || "/";
}

/** Derive a stable opaque project identity from a canonical physical root. */
export function deriveProjectRuntimeId(
  canonicalRoot: string,
  platform: ProjectStatePlatform = process.platform === "win32" ? "win32" : "posix",
): `krp_${string}` {
  const digest = createHash("sha256")
    .update(PROJECT_IDENTITY_DOMAIN, "utf8")
    .update(normalizeProjectRootIdentity(canonicalRoot, platform), "utf8")
    .digest("hex");
  return `krp_${digest}`;
}

/**
 * Resolve the one private state namespace for an already-resolved project.
 * This function performs no writes. In particular, it never creates or
 * inspects `<project>/.kiln`.
 */
export function resolveProjectStateBinding(
  projectRoot: string,
  options: ProjectStateRootOptions = {},
): ProjectStateBinding {
  const canonicalRoot = resolveExistingDirectory(projectRoot);
  const platform = options.platform ?? (process.platform === "win32" ? "win32" : "posix");
  const projectRuntimeId = deriveProjectRuntimeId(canonicalRoot, platform);
  const kilnHome = resolveKilnHome(options.kilnHome ?? resolveKilnHomePath());
  const projectStateRoot = join(kilnHome, "projects", projectRuntimeId);
  const path = (name: string): string => join(projectStateRoot, name);

  return {
    canonicalRoot,
    kilnHome,
    projectRuntimeId,
    projectStateRoot,
    adoptionManifestPath: path("adoption.json"),
    configPath: path("config.yaml"),
    contextPath: path("context"),
    agentsPath: path("agents"),
    instructionsPath: path("instructions"),
    skillsPath: path("skills"),
    runtimePath: path("runtime"),
    sessionsPath: path("sessions"),
    cachePath: path("cache"),
    backupsPath: path("backups"),
    mutationsPath: path("mutations"),
    projectionsPath: path("projections"),
    domainsPath: path("domains"),
    evidencePath: path("evidence"),
    memoryPath: path("memory"),
    feedbackPath: path("feedback"),
    benchmarksPath: path("benchmarks"),
    tmpPath: path("tmp"),
  };
}

function resolveExistingDirectory(path: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new TypeError("Project root must be a non-empty path.");
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(path);
  } catch {
    throw new Error(`Project root does not exist: ${path}`);
  }
  try {
    if (!lstatSync(canonicalRoot).isDirectory()) {
      throw new Error(`Project root is not a directory: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Project root is not a directory:")) throw error;
    throw new Error(`Project root cannot be inspected: ${path}`);
  }
  return canonicalRoot;
}

function resolveKilnHome(path: string): string {
  const absolutePath = resolve(path);
  try {
    const canonicalPath = realpathSync(absolutePath);
    if (!lstatSync(canonicalPath).isDirectory()) throw new Error(`Kiln home is not a directory: ${path}`);
    return canonicalPath;
  } catch (error) {
    if (isMissingError(error)) return absolutePath;
    throw error;
  }
}

function isMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "ENOENT" ||
      (error as { readonly code?: unknown }).code === "ENOTDIR")
  );
}
