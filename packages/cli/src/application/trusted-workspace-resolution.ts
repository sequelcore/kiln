import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import type { Stats } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type TrustedWorkspaceRejectionReason =
  | "invalid-cwd"
  | "missing-marker"
  | "ambiguous-adoption"
  | "unsafe-marker";

export type TrustedWorkspaceResolution =
  | {
      readonly status: "resolved";
      readonly canonicalRoot: string;
      readonly projectRuntimeId: string;
      readonly markerDigest: string;
    }
  | {
      readonly status: "rejected";
      readonly reason: TrustedWorkspaceRejectionReason;
    };

export interface TrustedProcessContext {
  cwd(): string;
}

const ADOPTION_MARKER = join(".kiln", "kiln.yaml");

/**
 * Resolve runtime authority exclusively from the native harness process CWD.
 * No model-, request-, environment-, or tool-supplied project root participates.
 */
export function resolveTrustedWorkspace(
  processContext: TrustedProcessContext = process,
): TrustedWorkspaceResolution {
  const canonicalCwd = resolveCanonicalDirectory(processContext);
  if (!canonicalCwd) return rejected("invalid-cwd");

  const adoptedRoots: string[] = [];
  let current = canonicalCwd;
  while (true) {
    const marker = inspectMarker(current);
    if (marker.status === "unsafe") return rejected("unsafe-marker");
    if (marker.status === "present") adoptedRoots.push(current);

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (adoptedRoots.length === 0) return rejected("missing-marker");
  if (adoptedRoots.length > 1) return rejected("ambiguous-adoption");

  const canonicalRoot = adoptedRoots[0]!;
  const marker = readStableMarker(canonicalRoot);
  if (!marker) return rejected("unsafe-marker");

  return {
    status: "resolved",
    canonicalRoot,
    projectRuntimeId: deriveProjectRuntimeId(canonicalRoot),
    markerDigest: deriveMarkerDigest(marker),
  };
}

function resolveCanonicalDirectory(processContext: TrustedProcessContext): string | undefined {
  try {
    const cwd = processContext.cwd();
    if (typeof cwd !== "string" || cwd.length === 0) return undefined;
    const canonicalCwd = realpathSync(cwd);
    return lstatSync(canonicalCwd).isDirectory() ? canonicalCwd : undefined;
  } catch {
    return undefined;
  }
}

type MarkerInspection = { readonly status: "absent" | "present" | "unsafe" };

function inspectMarker(root: string): MarkerInspection {
  const kilnDirectory = join(root, ".kiln");
  const kilnStat = tryLstat(kilnDirectory);
  if (kilnStat.status === "absent") return { status: "absent" };
  if (kilnStat.status === "error" || kilnStat.stat.isSymbolicLink() || !kilnStat.stat.isDirectory()) {
    return { status: "unsafe" };
  }

  const markerPath = join(root, ADOPTION_MARKER);
  const markerStat = tryLstat(markerPath);
  if (markerStat.status === "absent") return { status: "absent" };
  if (markerStat.status === "error" || markerStat.stat.isSymbolicLink() || !markerStat.stat.isFile()) {
    return { status: "unsafe" };
  }

  try {
    return samePath(realpathSync(markerPath), markerPath)
      ? { status: "present" }
      : { status: "unsafe" };
  } catch {
    return { status: "unsafe" };
  }
}

function readStableMarker(root: string): Buffer | undefined {
  const markerPath = join(root, ADOPTION_MARKER);
  try {
    const before = lstatSync(markerPath);
    if (!before.isFile() || before.isSymbolicLink()) return undefined;
    if (!samePath(realpathSync(markerPath), markerPath)) return undefined;

    const contents = readFileSync(markerPath);

    const after = lstatSync(markerPath);
    if (!after.isFile() || after.isSymbolicLink()) return undefined;
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) return undefined;
    if (!samePath(realpathSync(markerPath), markerPath)) return undefined;
    if (!contents.equals(readFileSync(markerPath))) return undefined;
    return contents;
  } catch {
    // Includes marker removal or replacement during resolution.
    return undefined;
  }
}

function deriveProjectRuntimeId(canonicalRoot: string): string {
  const digest = createHash("sha256")
    .update("kiln:project-runtime:v1\0", "utf8")
    .update(canonicalRoot, "utf8")
    .digest("hex");
  return `krp_${digest}`;
}

function deriveMarkerDigest(marker: Buffer): string {
  const digest = createHash("sha256")
    .update("kiln:adoption-marker:v1\0", "utf8")
    .update(marker)
    .digest("hex");
  return `sha256:${digest}`;
}

function samePath(left: string, right: string): boolean {
  return relative(resolve(left), resolve(right)) === "";
}

type LstatResult =
  | { readonly status: "present"; readonly stat: Stats }
  | { readonly status: "absent" }
  | { readonly status: "error" };

function tryLstat(path: string): LstatResult {
  try {
    return { status: "present", stat: lstatSync(path) };
  } catch (error) {
    return isMissingPathError(error) ? { status: "absent" } : { status: "error" };
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR");
}

function rejected(reason: TrustedWorkspaceRejectionReason): TrustedWorkspaceResolution {
  return { status: "rejected", reason };
}
