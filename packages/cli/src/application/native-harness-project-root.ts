import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type NativeHarnessProjectRootResolution =
  | { readonly status: "resolved"; readonly rootPath: string }
  | { readonly status: "missing" | "ambiguous" };

/** Resolve an explicit trusted-workspace root supplied by the native harness projection. */
export function resolveNativeHarnessProjectRoot(
  projectPath: string,
): NativeHarnessProjectRootResolution {
  try {
    const rootPath = realpathSync(projectPath);
    return lstatSync(rootPath).isDirectory()
      ? { status: "resolved", rootPath }
      : { status: "missing" };
  } catch {
    return { status: "missing" };
  }
}

/**
 * Resolves the repository that contains the source adapter, never the caller's
 * process CWD. The source layout is the project-local MCP contract declared in
 * .codex/config.toml, so an unrelated terminal cannot redirect inspection.
 */
export function discoverNativeHarnessProjectRoot(
  moduleUrl = import.meta.url,
): NativeHarnessProjectRootResolution {
  const sourceDirectory = dirname(fileURLToPath(moduleUrl));
  const rootPath = resolve(sourceDirectory, "../../../..");
  const packagePath = join(rootPath, "package.json");
  if (!existsSync(packagePath)) {
    return { status: "missing" };
  }

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      name?: unknown;
      workspaces?: unknown;
    };
    if (packageJson.name !== "kiln" || !declaresPackagesWorkspace(packageJson.workspaces)) {
      return { status: "ambiguous" };
    }
  } catch {
    return { status: "ambiguous" };
  }

  return { status: "resolved", rootPath };
}

function declaresPackagesWorkspace(workspaces: unknown): boolean {
  if (Array.isArray(workspaces)) return workspaces.includes("packages/*");
  return typeof workspaces === "object"
    && workspaces !== null
    && Array.isArray((workspaces as { packages?: unknown }).packages)
    && (workspaces as { packages: readonly unknown[] }).packages.includes("packages/*");
}
