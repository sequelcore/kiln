/**
 * `formal_verify` — run a deterministic verifier over an input artifact and
 * report the closed correctness facts it observed.
 *
 * This tool reports; it never accepts. It returns which correctness checks the
 * verifier discharged and returns failures in a repairable form, and that is
 * the whole of its authority. It deliberately takes no mapping from a check
 * to acceptance criterion: such a mapping is a claim about intent, and the
 * agent whose work is under verification must not be the party asserting which
 * requirement its proof satisfies. That mapping belongs to the adopted
 * bounded-work contract, and the work-governance boundary resolves it.
 *
 * Called outside a governed work item the tool still verifies. It simply
 * produces a result that satisfies no criterion, which is the correct outcome
 * rather than an error.
 *
 * It serves the `verify.formal` capability identity. Capability discovery,
 * implementation selection, and the cross-harness result contract are owned by
 * the Capability Fabric track; this is one implementation registered behind
 * that identity, not a second selection authority.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type CommandProcessRunner,
  correctnessEfforts,
  type DafnyProofEffort,
  type DafnyProofLog,
  type DevTool,
  type FormalVerificationCheck,
  type FormalVerificationOutcome,
  type FormalVerificationSubject,
  formalVerificationToolMetadata,
  getBuiltinEffectEnvelope,
  getSandboxContext,
  normalizeFormalProofSubjects,
  requireString,
  resolvePath,
  SpawnCommandProcessRunner,
  TOOL_SCHEMAS,
  type ToolInput,
  type ToolResult,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "@kilnai/core";
import { DafnyVerifier } from "./dafny-verifier.js";

/** Capability identity this tool implements. Owned by the Capability Fabric catalog. */
export const FORMAL_VERIFY_CAPABILITY = "verify.formal" as const;

const DEFAULT_TIMEOUT_MS = 120_000;

export interface FormalVerifyToolOptions {
  /** Absolute path to the verifier executable. Resolved by configuration, never searched for. */
  readonly executable: string;
  /**
   * Pinned verifier version, recorded in emitted evidence metadata. Resolved
   * by configuration alongside `executable`, never fabricated here: a run of
   * `dafny verify` does not report its own version on either the CSV log or
   * the JSON diagnostic stream, so this is the only honest source.
   */
  readonly verifierVersion: string;
  readonly runner?: CommandProcessRunner;
  readonly timeoutMs?: number;
}

export function createFormalVerifyTool(options: FormalVerifyToolOptions): DevTool {
  const schema = TOOL_SCHEMAS.formal_verify;
  return {
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
    ...(getBuiltinEffectEnvelope(schema.name) === undefined
      ? {}
      : { effectEnvelope: getBuiltinEffectEnvelope(schema.name) }),
    async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
      const file = requireString(input, "file");
      if (!file.ok) return file.result;
      const sandboxContext = getSandboxContext(sandbox);
      if (sandboxContext?.cwd === undefined) {
        return toErrorResult("formal verification requires sandbox.cwd to bind subject coverage");
      }
      let sandboxRoot: string;
      let repositoryRoot: string;
      try {
        const cwdPath = await realpath(sandboxContext.cwd);
        const cwdStat = await lstat(cwdPath);
        if (!cwdStat.isDirectory()) {
          return toErrorResult("formal verification sandbox.cwd must be a directory");
        }
        sandboxRoot = cwdPath;
        repositoryRoot = await resolveGitRepositoryRoot(sandboxRoot);
        if (!isWithin(repositoryRoot, sandboxRoot)) {
          return toErrorResult("formal verification sandbox.cwd must be inside its Git repository");
        }
      } catch (error) {
        return toErrorResult(`formal verification sandbox.cwd Git boundary unavailable: ${errorMessage(error)}`);
      }
      const absolute = resolvePath(file.value, sandbox);
      const denied = validateReadPath(absolute, sandbox);
      if (denied) return toErrorResult(denied);

      if (typeof options.verifierVersion !== "string" || options.verifierVersion.trim().length === 0) {
        return toErrorResult("formal verification verifier version is required");
      }

      let snapshotRoot: string | undefined;
      let snapshotFiles: readonly string[] = [];
      let result: ToolResult = toErrorResult("formal verification did not produce a result");
      try {
        snapshotRoot = await mkdtemp(join(tmpdir(), "kiln-formal-verify-"));
        const snapshot = await createVerificationSnapshot(absolute, snapshotRoot, sandbox, repositoryRoot, sandboxRoot);
        snapshotFiles = snapshot.files;

        const verifier = new DafnyVerifier(options.runner ?? new SpawnCommandProcessRunner(), {
          executable: options.executable,
          cwd: snapshotRoot,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        const run = await verifier.verify({
          file: snapshot.inputRelativePath,
          logFilePath: snapshot.logFileName,
        });

        if (run.status !== "completed") {
          // A run that did not complete proves nothing. Report it as an error so
          // an empty obligation set can never read as a clean verification, and
          // emit no metadata: nothing here would honestly claim a verification
          // happened.
          result = toErrorResult(`formal verification did not complete (${run.status}): ${run.failure ?? "no detail"}`);
        } else {
          let snapshotFailure: string | undefined;
          try {
            await assertSnapshotUnchanged(snapshot);
          } catch (error) {
            snapshotFailure = errorMessage(error);
          }
          if (snapshotFailure !== undefined) {
            result = toErrorResult(`formal verification snapshot invalid after verification: ${snapshotFailure}`);
          } else {
            const checks = [...correctnessEfforts(run.log)].sort(compareEfforts);
            if (checks.length === 0) {
              result = toErrorResult(
                "formal verification completed without a correctness check; no observation was emitted",
              );
            } else {
              const metadata = formalVerificationToolMetadata({
                verifier: { name: "dafny", version: options.verifierVersion },
                artifact: { contentDigest: snapshot.inputDigest },
                subjects: snapshot.subjects,
                checks: checks.map((effort) => toCheck(effort, run.log)),
              });
              result = toSuccessResult(renderRun(run.log), metadata);
            }
          }
        }
      } catch (error) {
        result = toErrorResult(`formal verification failed closed: ${errorMessage(error)}`);
      }

      if (snapshotRoot !== undefined) {
        try {
          await cleanupVerificationSnapshot(snapshotRoot, snapshotFiles);
        } catch (error) {
          // A leaked or partially cleaned snapshot is an infrastructure failure;
          // never return a successful observation when cleanup was not confirmed.
          return toErrorResult(`formal verification snapshot cleanup failed: ${errorMessage(error)}`);
        }
      }
      return result;
    },
  };
}

function toCheck(effort: DafnyProofEffort, log: DafnyProofLog): FormalVerificationCheck {
  const outcome = effortOutcome(effort);
  return {
    symbol: effort.symbol,
    check: "correctness",
    outcome,
    ...(outcome === "proved" ? {} : { detail: renderDiagnostics(log) }),
    durationMs: effort.durationMs,
    resourceCount: effort.resourceCount,
  };
}

function effortOutcome(effort: DafnyProofEffort): FormalVerificationOutcome {
  if (effort.outcome === "passed") return "proved";
  if (effort.outcome === "failed") return "refuted";
  return "unresolved";
}

function renderDiagnostics(log: DafnyProofLog): string {
  if (log.diagnostics.length === 0) return "verifier reported no diagnostic";
  return log.diagnostics
    .map((diagnostic) =>
      [
        `${displayDiagnosticFile(diagnostic.file)}:${diagnostic.line}:${diagnostic.character} ${redactDiagnosticText(diagnostic.message)}`,
        ...diagnostic.related.map(redactDiagnosticText),
      ].join(" | "),
    )
    .join(" ;; ");
}

function renderRun(log: DafnyProofLog): string {
  const efforts = correctnessEfforts(log);
  if (efforts.length === 0) {
    return [
      "No correctness checks were found.",
      "The verifier completed without discharging any correctness check, so nothing was observed.",
      "Check that the file declares verifiable properties.",
    ].join("\n");
  }
  const failed = efforts.filter((effort) => effort.outcome !== "passed");
  const lines = [
    `${efforts.length - failed.length}/${efforts.length} correctness checks discharged.`,
    "",
    ...efforts.map(renderEffort),
  ];
  if (log.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of log.diagnostics) {
      lines.push(`  ${diagnostic.file}:${diagnostic.line}:${diagnostic.character} ${diagnostic.message}`);
      for (const related of diagnostic.related) lines.push(`      ${related}`);
    }
  }
  lines.push(
    "",
    failed.length === 0
      ? "All declared obligations hold. This reports verifier output only; whether it satisfies an acceptance criterion is decided by work governance."
      : "Unproven checks must be repaired in the implementation or the specification before the work can be accepted.",
  );
  return lines.join("\n");
}

function renderEffort(effort: DafnyProofEffort): string {
  const mark = effort.outcome === "passed" ? "proved" : effort.outcome === "failed" ? "REFUTED" : "UNRESOLVED";
  return `  ${effort.symbol}: ${mark} (${effort.durationMs}ms, resource count ${effort.resourceCount})`;
}

function basenameOf(path: string): string {
  const segments = path.split(/[\\/]/u);
  return segments[segments.length - 1] ?? "verification";
}

async function digestFile(path: string): Promise<string> {
  const content = await readFile(path);
  return digestBytes(content);
}

function digestBytes(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

interface GitTreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly objectId: string;
}

interface GitCandidateSnapshot {
  readonly repositoryRoot: string;
  readonly entries: ReadonlyMap<string, GitTreeEntry>;
}

async function resolveGitRepositoryRoot(cwd: string): Promise<string> {
  const output = await runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);
  const rootValue = output.toString("utf8").trim();
  if (rootValue.length === 0) throw new Error("git rev-parse returned an empty repository root");
  const root = await realpath(rootValue);
  if (!isWithin(root, cwd)) throw new Error("sandbox.cwd is outside the Git repository");
  await runGitCommand(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  return root;
}

async function createGitCandidateSnapshot(repositoryRoot: string): Promise<GitCandidateSnapshot> {
  const indexDirectory = await mkdtemp(join(tmpdir(), "kiln-formal-git-index-"));
  const indexPath = join(indexDirectory, "index");
  try {
    const firstTreeObjectId = await materializeGitTree(repositoryRoot, indexPath);
    const secondTreeObjectId = await materializeGitTree(repositoryRoot, indexPath);
    if (firstTreeObjectId !== secondTreeObjectId) {
      throw new Error("Git candidate materialization was unstable");
    }
    const listing = await runGitCommand(repositoryRoot, ["ls-tree", "-r", "-z", "--full-tree", secondTreeObjectId]);
    const entries = parseGitTreeEntries(listing);
    if ([...entries.values()].some((entry) => entry.type === "commit" || entry.mode === "160000")) {
      throw new Error("Git candidate contains a submodule gitlink; explicit capture is required");
    }
    return {
      repositoryRoot,
      entries,
    };
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}

async function materializeGitTree(repositoryRoot: string, indexPath: string): Promise<string> {
  await runGitCommand(repositoryRoot, ["read-tree", "HEAD"], indexPath);
  await runGitCommand(repositoryRoot, ["add", "--all", "--", "."], indexPath);
  const output = await runGitCommand(repositoryRoot, ["write-tree"], indexPath);
  const treeObjectId = output.toString("utf8").trim();
  if (!/^[0-9a-f]{40,64}$/u.test(treeObjectId)) {
    throw new Error("git write-tree returned an invalid tree object id");
  }
  return treeObjectId;
}

function parseGitTreeEntries(output: Buffer): ReadonlyMap<string, GitTreeEntry> {
  const entries = new Map<string, GitTreeEntry>();
  for (const rawEntry of output.toString("utf8").split("\0")) {
    if (rawEntry.length === 0) continue;
    const separator = rawEntry.indexOf("\t");
    if (separator < 0) throw new Error("git ls-tree returned a malformed entry");
    const [mode, type, objectId] = rawEntry.slice(0, separator).split(" ");
    const path = rawEntry.slice(separator + 1);
    if (mode === undefined || type === undefined || objectId === undefined || path.length === 0) {
      throw new Error("git ls-tree returned a malformed entry");
    }
    if (entries.has(path)) throw new Error(`git candidate contains duplicate path ${path}`);
    entries.set(path, { mode, type, objectId });
  }
  return entries;
}

async function readGitCandidateContent(candidate: GitCandidateSnapshot, path: string): Promise<Buffer> {
  const candidatePath = candidateRelativePath(candidate.repositoryRoot, path);
  const entry = candidate.entries.get(candidatePath);
  if (entry === undefined) {
    throw new Error(`formal verification candidate does not contain ${candidatePath}`);
  }
  if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
    throw new Error(`formal verification candidate path ${candidatePath} is not a regular blob`);
  }
  return runGitCommand(candidate.repositoryRoot, ["cat-file", "blob", entry.objectId]);
}

function candidateRelativePath(repositoryRoot: string, path: string): string {
  const candidatePath = relative(repositoryRoot, resolve(path));
  if (candidatePath.length === 0 || candidatePath.startsWith("..") || isAbsolute(candidatePath)) {
    throw new Error(`formal verification path is outside the Git repository: ${path}`);
  }
  return toPosixPath(candidatePath);
}

function runGitCommand(cwd: string, args: readonly string[], indexPath?: string): Promise<Buffer> {
  return new Promise((resolveCommand, rejectCommand) => {
    const environment = indexPath === undefined ? process.env : { ...process.env, GIT_INDEX_FILE: indexPath };
    execFile(
      "git",
      [...args],
      {
        cwd,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
        env: environment,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          rejectCommand(new Error(`git ${args.join(" ")} failed: ${errorMessage(error)}`));
          return;
        }
        resolveCommand(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

interface VerificationSnapshot {
  readonly inputPath: string;
  readonly inputRelativePath: string;
  readonly inputDigest: string;
  readonly logFileName: string;
  readonly files: readonly string[];
  readonly fileDigests: ReadonlyMap<string, string>;
  readonly subjects: readonly FormalVerificationSubject[];
}

async function createVerificationSnapshot(
  inputPath: string,
  snapshotRoot: string,
  sandbox: unknown,
  repositoryRoot: string,
  sandboxRoot: string,
): Promise<VerificationSnapshot> {
  const candidate = await createGitCandidateSnapshot(repositoryRoot);
  const files = await collectSnapshotFiles(inputPath, sandbox, repositoryRoot, sandboxRoot, candidate);
  const originalRoot = commonPathRoot([...files.keys()]);
  const subjects = normalizeFormalProofSubjects(
    [...files.entries()].map(([originalPath, content]) => ({
      path: candidateRelativePath(repositoryRoot, originalPath),
      contentDigest: digestBytes(content),
    })),
  );
  const snapshotPaths: string[] = [];
  const snapshotDigests = new Map<string, string>();
  let snapshotInputPath = "";

  for (const [originalPath, content] of files) {
    const relativePath = relative(originalRoot, originalPath);
    if (relativePath.length === 0 || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`formal verification dependency cannot be represented in an isolated snapshot: ${originalPath}`);
    }
    const snapshotPath = resolve(snapshotRoot, relativePath);
    if (!isWithin(snapshotRoot, snapshotPath)) {
      throw new Error(`formal verification dependency escapes the isolated snapshot: ${originalPath}`);
    }
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, content, { mode: 0o444 });
    await chmod(snapshotPath, 0o444);
    snapshotPaths.push(snapshotPath);
    snapshotDigests.set(snapshotPath, digestBytes(content));
    if (resolve(originalPath) === resolve(inputPath)) snapshotInputPath = snapshotPath;
  }

  if (snapshotInputPath.length === 0) {
    throw new Error("formal verification snapshot did not contain the input artifact");
  }
  const inputDigest = digestBytes(files.get(resolve(inputPath))!);
  if ((await digestFile(snapshotInputPath)) !== inputDigest) {
    throw new Error("formal verification snapshot input differs from the captured bytes");
  }
  return {
    inputPath: snapshotInputPath,
    inputRelativePath: relative(snapshotRoot, snapshotInputPath),
    inputDigest,
    logFileName: `verification-${randomUUID()}.csv`,
    files: snapshotPaths,
    fileDigests: snapshotDigests,
    subjects,
  };
}

function toPosixPath(path: string): string {
  return sep === "\\" ? path.replaceAll("\\", "/") : path;
}

async function assertSnapshotUnchanged(snapshot: VerificationSnapshot): Promise<void> {
  for (const [path, expectedDigest] of snapshot.fileDigests) {
    let actualDigest: string;
    try {
      actualDigest = await digestFile(path);
    } catch (error) {
      throw new Error(`snapshot file unreadable (${path}): ${errorMessage(error)}`);
    }
    if (actualDigest !== expectedDigest) {
      throw new Error(`snapshot changed during verification (${path})`);
    }
  }
}

async function collectSnapshotFiles(
  inputPath: string,
  sandbox: unknown,
  repositoryRoot: string,
  sandboxRoot: string,
  candidate: GitCandidateSnapshot,
): Promise<ReadonlyMap<string, Buffer>> {
  const pending = [resolve(inputPath)];
  const files = new Map<string, Buffer>();
  while (pending.length > 0) {
    const currentPath = pending.pop()!;
    if (files.has(currentPath)) continue;
    await validateSnapshotReadPath(currentPath, sandbox, repositoryRoot, sandboxRoot);
    const content = await readGitCandidateContent(candidate, currentPath);
    files.set(currentPath, content);
    for (const dependency of localDependencies(currentPath, content)) pending.push(dependency);
  }
  return files;
}

/**
 * Validate both the lexical path and the physical path before following a
 * dependency. The sandbox validator is lexical by design; realpath closes the
 * symlink/junction gap without changing the dependency closure semantics.
 */
async function validateSnapshotReadPath(
  path: string,
  sandbox: unknown,
  repositoryRoot: string,
  sandboxRoot: string,
): Promise<void> {
  const lexicalPath = resolve(path);
  if (!isWithin(sandboxRoot, lexicalPath)) {
    throw new Error(`formal verification dependency read denied (${lexicalPath}): outside sandbox.cwd`);
  }
  if (!isWithin(repositoryRoot, lexicalPath)) {
    throw new Error(`formal verification dependency read denied (${lexicalPath}): outside Git repository`);
  }
  const denied = validateReadPath(lexicalPath, sandbox);
  if (denied) {
    throw new Error(`formal verification dependency read denied (${lexicalPath}): ${denied}`);
  }

  let physicalPath: string;
  try {
    const lexicalStat = await lstat(lexicalPath);
    if (lexicalStat.isSymbolicLink()) {
      throw new Error("symbolic links are not supported as formal verification subjects");
    }
    physicalPath = await realpath(lexicalPath);
  } catch (error) {
    throw new Error(`formal verification input/dependency unreadable (${lexicalPath}): ${errorMessage(error)}`);
  }

  if (!isWithin(sandboxRoot, physicalPath)) {
    throw new Error(
      `formal verification dependency read denied (${lexicalPath} -> ${physicalPath}): outside sandbox.cwd`,
    );
  }
  if (!isWithin(repositoryRoot, physicalPath)) {
    throw new Error(
      `formal verification dependency read denied (${lexicalPath} -> ${physicalPath}): outside Git repository`,
    );
  }
  const physicalDenied = validateReadPath(physicalPath, sandbox);
  if (physicalDenied) {
    throw new Error(
      `formal verification dependency read denied (${lexicalPath} -> ${physicalPath}): ${physicalDenied}`,
    );
  }
  const physicalStat = await lstat(physicalPath);
  if (!physicalStat.isFile()) {
    throw new Error(`formal verification input/dependency is not a regular file (${lexicalPath})`);
  }
}

function localDependencies(currentPath: string, content: Uint8Array): readonly string[] {
  const source = Buffer.from(content).toString("utf8");
  const dependencies: string[] = [];
  const dependencyPattern = /\b(?:include|import)\s+(?:opened\s+)?(?:"([^"]+)"|'([^']+)')/gu;
  for (const match of source.matchAll(dependencyPattern)) {
    const reference = match[1] ?? match[2];
    if (reference === undefined || reference.length === 0) {
      throw new Error(`formal verification input has an invalid include in ${currentPath}`);
    }
    if (isAbsolute(reference)) {
      throw new Error(`formal verification input uses an unsupported absolute include: ${reference}`);
    }
    dependencies.push(resolve(dirname(currentPath), reference));
  }
  const includeCount = [...source.matchAll(/\binclude\b/gu)].length;
  if (includeCount !== dependencies.length) {
    throw new Error(`formal verification input has an unsupported include form: ${currentPath}`);
  }
  return dependencies;
}

function commonPathRoot(paths: readonly string[]): string {
  const first = paths[0];
  if (first === undefined) throw new Error("formal verification snapshot has no files");
  let root = dirname(first);
  for (const path of paths.slice(1)) {
    while (!isWithin(root, path)) {
      const parent = dirname(root);
      if (parent === root) throw new Error(`formal verification files have no common snapshot root: ${path}`);
      root = parent;
    }
  }
  return root;
}

function isWithin(root: string, path: string): boolean {
  const candidate = relative(root, path);
  return candidate.length === 0 || (!candidate.startsWith("..") && !isAbsolute(candidate));
}

async function cleanupVerificationSnapshot(snapshotRoot: string, snapshotFiles: readonly string[]): Promise<void> {
  let firstError: unknown;
  for (const path of snapshotFiles) {
    try {
      await chmod(path, 0o600);
    } catch (error) {
      if (!isNotFoundError(error) && firstError === undefined) firstError = error;
    }
  }
  try {
    await rm(snapshotRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  } catch (error) {
    if (firstError === undefined) firstError = error;
  }
  if (firstError !== undefined) throw firstError;
}

function compareEfforts(left: DafnyProofEffort, right: DafnyProofEffort): number {
  if (left.symbol < right.symbol) return -1;
  if (left.symbol > right.symbol) return 1;
  return left.check < right.check ? -1 : left.check > right.check ? 1 : 0;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function displayDiagnosticFile(path: string): string {
  return path.length === 0 ? "<unknown>" : basenameOf(path);
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\s|;]+/gu, "<path>")
    .replace(/(^|[\s(])\/(?:[^/\s|;]+\/)+[^/\s|;]*/gu, "$1<path>");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
