import { lstatSync, realpathSync } from "node:fs";
import { relative } from "node:path";
import type { KilnGlobalConfig } from "./global-config.js";

export interface ResolvedFormalScreeningConfig {
  readonly privatePackagePath: string;
  readonly lemmaScriptPackageRoot: string;
  readonly lscScriptPath: string;
  readonly expectedLemmaScriptVersion: string;
  readonly dafnyExecutable: string;
  readonly expectedDafnyVersion: string;
}

export function resolveFormalScreeningConfig(
  globalConfig: KilnGlobalConfig | null | undefined,
): ResolvedFormalScreeningConfig {
  const formal = globalConfig?.verification?.formal;
  const screening = formal?.screening;
  if (!formal || !screening) {
    throw new Error("Formal screening requires global verification.formal.screening configuration.");
  }

  const privatePackagePath = requireDirectory(screening.packagePath, "Private screening package");
  const lemmaScriptPackageRoot = requireDirectory(
    screening.lemmaScript.packageRoot,
    "Configured LemmaScript package root",
  );
  const lscScriptPath = requireFile(screening.lemmaScript.entrypoint, "LemmaScript entrypoint");
  if (!isContainedPath(lemmaScriptPackageRoot, lscScriptPath)) {
    throw new Error("LemmaScript entrypoint must be contained by its configured package root.");
  }
  const dafnyExecutable = requireFile(formal.dafny.executable, "Configured Dafny executable");

  return {
    privatePackagePath,
    lemmaScriptPackageRoot,
    lscScriptPath,
    expectedLemmaScriptVersion: screening.lemmaScript.expectedVersion,
    dafnyExecutable,
    expectedDafnyVersion: formal.dafny.expectedVersion,
  };
}

function requireDirectory(path: string, label: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symbolic directory.`);
  }
  return realpathSync(path);
}

function requireFile(path: string, label: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symbolic file.`);
  }
  return realpathSync(path);
}

function isContainedPath(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path.length > 0 && path !== ".." && !path.startsWith(`..\\`) && !path.startsWith("../");
}
