// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Computes the concrete working directory for a route profile's configured
// working-directory lease, and rebases write-authority allow/deny paths from
// the lease's source path onto that concrete directory. Used only when
// assembling a prepared invocation request's authority.workingDirectory.
import type { ManagedAgentAuthorityProfile, ManagedAgentWorkingDirectory } from "@kilnai/core";
import { posix, resolve, win32 } from "node:path";
import type { ManagedInvocationRouteProfile } from "./types.js";
import { sanitizeId } from "./input-parsing.js";

export function resolveManagedInvocationRouteAuthority(
  profile: ManagedInvocationRouteProfile,
  invocationId: string,
): Pick<ManagedAgentAuthorityProfile, "workingDirectory" | "writeAuthority"> {
  const workingDirectory = resolveManagedInvocationWorkingDirectory(profile, invocationId);
  return {
    workingDirectory,
    ...(profile.writeAuthority
      ? { writeAuthority: resolveManagedInvocationWriteAuthority(profile, workingDirectory) }
      : {}),
  };
}

function resolveManagedInvocationWorkingDirectory(
  profile: ManagedInvocationRouteProfile,
  invocationId: string,
): ManagedAgentWorkingDirectory {
  if (!profile.workingDirectoryLease || profile.workingDirectory.mode !== "isolated-worktree") {
    return profile.workingDirectory;
  }
  return {
    path: joinManagedInvocationLeasePath(profile.workingDirectoryLease.rootPath, sanitizeId(invocationId)),
    mode: "isolated-worktree",
  };
}

function resolveManagedInvocationWriteAuthority(
  profile: ManagedInvocationRouteProfile,
  workingDirectory: ManagedAgentWorkingDirectory,
): ManagedAgentAuthorityProfile["writeAuthority"] {
  const authority = profile.writeAuthority;
  if (!authority || !profile.workingDirectoryLease || workingDirectory.mode !== "isolated-worktree") {
    return authority;
  }
  return {
    ...authority,
    scope: {
      ...authority.scope,
      workspace: {
        ...authority.scope.workspace,
        allowedPaths: rebaseManagedInvocationLeasePaths(
          authority.scope.workspace.allowedPaths,
          profile.workingDirectoryLease.sourcePath,
          workingDirectory.path,
        ),
        deniedPaths: rebaseManagedInvocationLeasePaths(
          authority.scope.workspace.deniedPaths,
          profile.workingDirectoryLease.sourcePath,
          workingDirectory.path,
        ),
      },
    },
  };
}

function rebaseManagedInvocationLeasePaths(
  paths: readonly string[],
  sourceRootPath: string,
  targetRootPath: string,
): readonly string[] {
  return paths.map((path) => rebaseManagedInvocationLeasePath(path, sourceRootPath, targetRootPath));
}

function rebaseManagedInvocationLeasePath(
  path: string,
  sourceRootPath: string,
  targetRootPath: string,
): string {
  const normalizedPath = normalizeManagedInvocationPath(path);
  const normalizedSource = normalizeManagedInvocationPath(sourceRootPath);
  const normalizedTarget = normalizeManagedInvocationPath(targetRootPath);
  if (normalizedPath === normalizedSource) {
    return normalizedTarget;
  }
  const prefix = `${normalizedSource}/`;
  if (!normalizedPath.startsWith(prefix)) {
    return path;
  }
  return `${normalizedTarget}/${normalizedPath.slice(prefix.length)}`;
}

function normalizeManagedInvocationPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function joinManagedInvocationLeasePath(rootPath: string, childId: string): string {
  if (win32.isAbsolute(rootPath) || rootPath.includes("\\")) {
    return win32.join(rootPath, childId);
  }
  if (posix.isAbsolute(rootPath)) {
    return posix.join(rootPath, childId);
  }
  return resolve(rootPath, childId);
}
