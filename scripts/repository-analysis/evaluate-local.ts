import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { captureWorkspaceIdentity, digest } from "./snapshot.js";

const root = resolve(import.meta.dirname, "../..");
const directory = realpathSync(mkdtempSync(join(tmpdir(), "kiln-local-reference-eval-")));
const identity = captureWorkspaceIdentity(root);
const implementationFiles = [
  "scripts/repository-analysis/local-reference-workflow.ts",
  "scripts/repository-analysis/evaluate-local.ts",
  "scripts/repository-analysis/reference-projection.ts",
  "scripts/repository-analysis/reference-adapter.ts",
  "scripts/repository-analysis/project-capture.ts",
  "scripts/repository-analysis/snapshot.ts",
  "packages/cli/src/application/project-state-root.ts",
  "packages/runtime/src/artifacts/file-artifact-resource-store.ts",
];
const implementationHashes = implementationFiles.map((path) => ({
  path,
  hash: digest(readFileSync(resolve(root, path))),
}));
const observations: { command: string; exitCode: number | null; output: unknown; stderr: string }[] = [];
function run(command: string, args: readonly string[]): Record<string, unknown> {
  const child = spawnSync(
    process.execPath,
    ["run", resolve(import.meta.dirname, "local-reference-workflow.ts"), command, ...args],
    {
      cwd: root,
      env: { ...process.env, XDG_CONFIG_HOME: directory },
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2097152,
      windowsHide: true,
    },
  );
  let output: unknown;
  try {
    output = JSON.parse(child.stdout);
  } catch {
    output = child.stdout;
  }
  observations.push({ command, exitCode: child.status, output, stderr: child.stderr });
  if (child.error || child.status !== 0) throw child.error ?? new Error(`command-failed:${command}`);
  if (typeof output !== "object" || output === null || Array.isArray(output)) throw new Error("invalid-command-output");
  return output as Record<string, unknown>;
}
let passed = false;
let failure: string | undefined;
try {
  const saved = run("save", [
    "packages/operator-appearance/tsconfig.test.json",
    "packages/operator-appearance/tests/operator-appearance.test.ts",
    "19",
    "3",
  ]);
  if (typeof saved["handle"] !== "string" || typeof saved["hash"] !== "string")
    throw new Error("missing-saved-identity");
  const args = [saved["handle"], saved["hash"]];
  const checked = run("check", args);
  const read = run("read", args);
  const artifact = read["artifact"];
  const exactHash = digest(JSON.stringify(artifact)) === saved["hash"];
  passed =
    saved["status"] === "current" && checked["status"] === "current" && read["status"] === "historical" && exactHash;
} catch (error) {
  failure = error instanceof Error ? error.message : "local-workflow-failed";
} finally {
  if (
    realpathSync(directory) !== directory ||
    !directory.startsWith(join(realpathSync(tmpdir()), "kiln-local-reference-eval-"))
  )
    throw new Error("invalid-cleanup-root");
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  JSON.stringify(
    {
      schema: "repository-analysis-local-development-v1",
      verdict: "diagnostic-only",
      createdAt: new Date().toISOString(),
      protocolDigest: digest(readFileSync(resolve(root, "docs/research/active/repository-analysis-local-protocol.md"))),
      implementationHashes,
      implementationDigest: digest(JSON.stringify(implementationHashes)),
      revision: identity.revision,
      dirtyStateDigest: identity.dirtyStateDigest,
      runtime: process.versions,
      platform: process.platform,
      passed,
      ...(failure ? { failure } : {}),
      observations,
      limitations: [
        "one real-project smoke, not held out",
        "current means at check time only",
        "reanalysis required for freshness; no token/cost claim",
        "temporary private home removed; handles no longer resolve",
        "no production registration or Gateway integration",
      ],
    },
    null,
    2,
  ),
);
