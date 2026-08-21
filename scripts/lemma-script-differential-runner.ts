import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDafnyDifferentialProgram,
  mutateDafnyTranslation,
  parseLemmaScriptObservationLines,
} from "./lemma-script-dafny-differential.js";
import {
  assessLemmaScriptMutation,
  evaluateLemmaScriptDifferentialOracle,
  LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION,
  type LemmaScriptDifferentialFacts,
  type LemmaScriptMutationAssessment,
  parseLemmaScriptCases,
} from "./lemma-script-differential-oracle.js";
import {
  type LemmaScriptProcessResult,
  type LemmaScriptProcessRunner,
  runLemmaScriptProcess,
  runLemmaScriptQualification,
} from "./lemma-script-qualification.js";

export interface LemmaScriptDifferentialRunnerInput {
  readonly sourcePath: string;
  readonly caseManifestPath: string;
  readonly lscScriptPath: string;
  readonly dafnyExecutable: string;
  readonly javaExecutable: string;
  readonly javacExecutable: string;
  readonly jarExecutable: string;
  readonly expectedLemmaScriptVersion: string;
  readonly expectedDafnyVersion: string;
  readonly expectedJavaVersion: string;
  readonly timeoutMs?: number;
}

export interface LemmaScriptDifferentialRunnerOptions {
  readonly processRunner?: LemmaScriptProcessRunner;
  readonly cleanupWorkspace?: (workspacePath: string) => Promise<void>;
}

interface DifferentialVersions {
  readonly lemmaScript: { readonly expected: string; readonly observed: string | null };
  readonly dafny: { readonly expected: string; readonly observed: string | null };
  readonly java: { readonly expected: string; readonly observed: string | null };
  readonly javac: string | null;
  readonly jar: string | null;
}

interface DifferentialDigests {
  readonly source?: string;
  readonly manifest?: string;
  readonly lemmaScriptExecutable?: string;
  readonly dafnyExecutable?: string;
  readonly javaExecutable?: string;
  readonly javacExecutable?: string;
  readonly jarExecutable?: string;
  readonly evaluator?: string;
  readonly generated?: string;
  readonly proof?: string;
  readonly cleanProgram?: string;
  readonly mutantProgram?: string;
}

interface DifferentialRunnerFacts {
  readonly versions: DifferentialVersions;
  readonly digests: DifferentialDigests;
  readonly differential: LemmaScriptDifferentialFacts;
}

interface DifferentialRunnerBase {
  readonly benchmarkReady: false;
  readonly facts: DifferentialRunnerFacts;
  readonly mutation: LemmaScriptMutationAssessment;
  readonly diagnostics: readonly string[];
}

export type LemmaScriptDifferentialRunnerResult =
  | (DifferentialRunnerBase & {
      readonly status: "equivalent";
      readonly semanticEquivalence: "equivalent_for_enumerated_domain";
    })
  | (DifferentialRunnerBase & {
      readonly status: "mismatch";
      readonly semanticEquivalence: "mismatch";
    })
  | (DifferentialRunnerBase & {
      readonly status: "invalid";
      readonly semanticEquivalence: "invalid";
    });

interface ValidatedInput extends LemmaScriptDifferentialRunnerInput {
  readonly timeoutMs: number;
  readonly javaBin: string;
}

interface InitialArtifacts {
  readonly source: Buffer;
  readonly manifest: Buffer;
  readonly toolBytes: ReadonlyMap<string, Buffer>;
  readonly digests: DifferentialDigests;
}

const CANONICAL_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const OBSERVED_VERSION = /\b((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\b/u;
const DEFAULT_TIMEOUT_MS = 30_000;
const EVALUATOR_PATH = fileURLToPath(new URL("./lemma-script-typescript-evaluator.ts", import.meta.url));
const DEFAULT_CLEANUP = async (workspacePath: string): Promise<void> => {
  await rm(workspacePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
};

export async function runLemmaScriptDifferential(
  input: LemmaScriptDifferentialRunnerInput,
  options: LemmaScriptDifferentialRunnerOptions = {},
): Promise<LemmaScriptDifferentialRunnerResult> {
  const initialVersions = versionsFrom(input);
  const validation = await validateInput(input);
  if (typeof validation === "string") return invalidResult(initialVersions, {}, [validation]);
  const processRunner = options.processRunner ?? runLemmaScriptProcess;

  let initial: InitialArtifacts;
  try {
    initial = await readInitialArtifacts(validation);
  } catch {
    return invalidResult(initialVersions, {}, ["Could not read an input artifact as a regular non-symlink file."]);
  }

  const qualification = await runLemmaScriptQualification(
    {
      sourcePath: validation.sourcePath,
      lscScriptPath: validation.lscScriptPath,
      dafnyExecutable: validation.dafnyExecutable,
      expectedLemmaScriptVersion: validation.expectedLemmaScriptVersion,
      expectedDafnyVersion: validation.expectedDafnyVersion,
      requiredFunctionNames: [LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION],
      timeoutMs: validation.timeoutMs,
    },
    { processRunner },
  );
  const qualifiedVersions: DifferentialVersions = {
    ...initialVersions,
    lemmaScript: qualification.facts.versions.lemmaScript,
    dafny: qualification.facts.versions.dafny,
  };
  if (qualification.kind !== "pipeline_passed") {
    return invalidResult(qualifiedVersions, initial.digests, ["LemmaScript qualification did not pass."]);
  }
  if (qualification.facts.digests.source !== initial.digests.source) {
    return invalidResult(qualifiedVersions, initial.digests, [
      "Qualification source digest did not match the observed source.",
    ]);
  }

  let workspacePath: string;
  try {
    workspacePath = await mkdtemp(join(tmpdir(), "kiln-lemma-script-differential-"));
  } catch {
    return invalidResult(qualifiedVersions, initial.digests, ["Could not create an isolated differential workspace."]);
  }

  let result: LemmaScriptDifferentialRunnerResult;
  try {
    result = await executeDifferential(
      validation,
      initial,
      qualifiedVersions,
      qualification.facts.digests.generated as string,
      workspacePath,
      processRunner,
    );
  } catch {
    result = invalidResult(qualifiedVersions, initial.digests, ["Differential execution failed closed."]);
  }

  try {
    await (options.cleanupWorkspace ?? DEFAULT_CLEANUP)(workspacePath);
  } catch {
    try {
      await DEFAULT_CLEANUP(workspacePath);
    } catch {
      // The typed failure remains the only public diagnostic.
    }
    return invalidResult(result.facts.versions, result.facts.digests, ["Differential workspace cleanup failed."]);
  }
  return result;
}

async function executeDifferential(
  input: ValidatedInput,
  initial: InitialArtifacts,
  versions: DifferentialVersions,
  qualifiedGeneratedDigest: string,
  workspacePath: string,
  processRunner: LemmaScriptProcessRunner,
): Promise<LemmaScriptDifferentialRunnerResult> {
  const stagedSource = join(workspacePath, basename(input.sourcePath));
  const stagedManifest = join(workspacePath, "cases.json");
  await writeFile(stagedSource, initial.source);
  await writeFile(stagedManifest, initial.manifest);

  const observedTools = await observeJavaTools(input, processRunner, workspacePath);
  const observedVersions: DifferentialVersions = {
    ...versions,
    java: { expected: input.expectedJavaVersion, observed: observedTools.java },
    javac: observedTools.javac,
    jar: observedTools.jar,
  };
  if (
    observedTools.java !== input.expectedJavaVersion ||
    observedTools.javac !== input.expectedJavaVersion ||
    observedTools.jar !== input.expectedJavaVersion
  ) {
    return invalidResult(observedVersions, initial.digests, [
      "Observed Java tool versions did not match the expected version.",
    ]);
  }

  const typescript = await processRunner({
    executable: process.execPath,
    args: [
      "run",
      EVALUATOR_PATH,
      `--source=${stagedSource}`,
      `--function=${LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION}`,
      `--manifest=${stagedManifest}`,
    ],
    cwd: workspacePath,
    timeoutMs: input.timeoutMs,
  });
  if (!successful(typescript)) {
    return invalidResult(observedVersions, initial.digests, [
      "The staged TypeScript evaluator did not execute successfully.",
    ]);
  }

  const generation = await processRunner({
    executable: process.execPath,
    args: [input.lscScriptPath, "gen", "--backend=dafny", stagedSource],
    cwd: workspacePath,
    timeoutMs: input.timeoutMs,
  });
  if (!successful(generation)) {
    return invalidResult(observedVersions, initial.digests, ["LemmaScript generation did not execute successfully."]);
  }

  const generatedPath = `${stagedSource.slice(0, -3)}.dfy.gen`;
  const proofPath = `${stagedSource.slice(0, -3)}.dfy`;
  const generated = await readRegularFile(generatedPath);
  const proof = await readRegularFile(proofPath);
  if (!generated.equals(proof)) {
    return invalidResult(observedVersions, initial.digests, ["Generated Dafny and proof bytes differed."]);
  }
  const generatedDigest = digest(generated);
  if (generatedDigest !== qualifiedGeneratedDigest) {
    return invalidResult(observedVersions, initial.digests, [
      "Repeated generation did not preserve the qualified Dafny digest.",
    ]);
  }

  const clean = buildDafnyDifferentialProgram(generated.toString("utf8"));
  if (clean.status === "invalid") {
    return invalidResult(
      observedVersions,
      withGenerated(initial.digests, generatedDigest),
      clean.diagnostics.map((d) => d.message),
    );
  }
  const cleanPath = join(workspacePath, "clean.dfy");
  await writeFile(cleanPath, clean.program);
  const cleanRun = await runDafnyProgram(input, cleanPath, workspacePath, processRunner);
  const cleanObservations = successful(cleanRun) ? parseLemmaScriptObservationLines(cleanRun.stdout) : undefined;
  if (cleanObservations === undefined || cleanObservations.status === "invalid") {
    return invalidResult(observedVersions, withPrograms(initial.digests, generated, clean.program), [
      "Clean Dafny execution did not produce exactly four valid observations.",
    ]);
  }

  const mutationSource = mutateDafnyTranslation(generated.toString("utf8"));
  if (mutationSource.status === "invalid") {
    return invalidResult(
      observedVersions,
      withPrograms(initial.digests, generated, clean.program),
      mutationSource.diagnostics.map((d) => d.message),
    );
  }
  const mutant = buildDafnyDifferentialProgram(mutationSource.source);
  if (mutant.status === "invalid") {
    return invalidResult(
      observedVersions,
      withPrograms(initial.digests, generated, clean.program),
      mutant.diagnostics.map((d) => d.message),
    );
  }
  const mutantPath = join(workspacePath, "mutant.dfy");
  await writeFile(mutantPath, mutant.program);
  const mutantRun = await runDafnyProgram(input, mutantPath, workspacePath, processRunner);
  const mutantParsed = successful(mutantRun) ? parseLemmaScriptObservationLines(mutantRun.stdout) : undefined;
  const parsedManifest = parseLemmaScriptCases(JSON.parse(initial.manifest.toString("utf8")) as unknown);
  if (parsedManifest.status === "invalid") {
    return invalidResult(observedVersions, withPrograms(initial.digests, generated, clean.program, mutant.program), [
      "The case manifest became invalid during differential execution.",
    ]);
  }
  const mutation = assessLemmaScriptMutation({
    cases: parsedManifest.value,
    observations:
      mutantParsed?.status === "valid"
        ? mutantParsed.observations.map(({ key, result }) => ({ key, value: result }))
        : [],
    execution: successful(mutantRun) && mutantParsed?.status === "valid" ? "executed" : "invalid",
  });
  const completeDigests = withPrograms(initial.digests, generated, clean.program, mutant.program);
  if (mutation.status !== "killed") {
    return invalidResult(
      observedVersions,
      completeDigests,
      ["The calibrated translation mutant was not validly killed."],
      mutation,
    );
  }

  const oracle = evaluateLemmaScriptDifferentialOracle({
    cases: parsedManifest.value,
    tsObservations: typescript.stdout,
    dafnyObservations: cleanObservations.observations.map(({ key, result }) => ({ key, value: result })),
  });
  const drift = await detectDrift(input, initial, stagedSource, stagedManifest);
  if (drift !== undefined) return invalidResult(observedVersions, completeDigests, [drift], mutation);
  if (oracle.status === "invalid") {
    return invalidResult(
      observedVersions,
      completeDigests,
      oracle.diagnostics.map((d) => d.message),
      mutation,
    );
  }
  const common = {
    benchmarkReady: false as const,
    facts: { versions: observedVersions, digests: completeDigests, differential: oracle.facts },
    mutation,
    diagnostics: oracle.diagnostics.map((diagnostic) => diagnostic.message),
  };
  if (oracle.status === "equivalent") {
    return { ...common, status: "equivalent", semanticEquivalence: "equivalent_for_enumerated_domain" };
  }
  return { ...common, status: "mismatch", semanticEquivalence: "mismatch" };
}

async function validateInput(input: LemmaScriptDifferentialRunnerInput): Promise<ValidatedInput | string> {
  if (typeof input !== "object" || input === null) return "Differential input must be an object.";
  const paths = [
    input.sourcePath,
    input.caseManifestPath,
    input.lscScriptPath,
    input.dafnyExecutable,
    input.javaExecutable,
    input.javacExecutable,
    input.jarExecutable,
  ];
  if (paths.some((path) => typeof path !== "string" || !isAbsolute(path)))
    return "All artifact paths must be absolute.";
  if (!input.sourcePath.toLowerCase().endsWith(".ts")) return "The candidate source must use the .ts extension.";
  if (
    !CANONICAL_VERSION.test(input.expectedLemmaScriptVersion) ||
    !CANONICAL_VERSION.test(input.expectedDafnyVersion) ||
    !CANONICAL_VERSION.test(input.expectedJavaVersion)
  ) {
    return "Expected tool versions must be canonical semantic versions.";
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return "The timeout must be a positive finite number.";
  const javaBin = dirname(input.javaExecutable);
  if (dirname(input.javacExecutable) !== javaBin || dirname(input.jarExecutable) !== javaBin) {
    return "Java, javac, and jar must share one bin directory.";
  }
  try {
    await Promise.all(paths.map(assertRegularNonSymlink));
    const bin = await lstat(javaBin);
    if (!bin.isDirectory() || bin.isSymbolicLink()) return "The Java bin path must be a regular non-symlink directory.";
  } catch {
    return "Every artifact must be a regular non-symlink file and Java tools must share a regular bin directory.";
  }
  return { ...input, timeoutMs, javaBin };
}

async function assertRegularNonSymlink(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not regular");
}

async function readRegularFile(path: string): Promise<Buffer> {
  await assertRegularNonSymlink(path);
  return readFile(path);
}

async function readInitialArtifacts(input: ValidatedInput): Promise<InitialArtifacts> {
  const source = await readRegularFile(input.sourcePath);
  const manifest = await readRegularFile(input.caseManifestPath);
  const parsed = parseLemmaScriptCases(JSON.parse(manifest.toString("utf8")) as unknown);
  if (parsed.status === "invalid") throw new Error("invalid manifest");
  const toolPaths = [
    input.lscScriptPath,
    input.dafnyExecutable,
    input.javaExecutable,
    input.javacExecutable,
    input.jarExecutable,
    process.execPath,
    EVALUATOR_PATH,
  ];
  const toolBytes = new Map<string, Buffer>();
  for (const path of toolPaths) toolBytes.set(path, await readRegularFile(path));
  return {
    source,
    manifest,
    toolBytes,
    digests: {
      source: digest(source),
      manifest: digest(manifest),
      lemmaScriptExecutable: digest(toolBytes.get(input.lscScriptPath) as Buffer),
      dafnyExecutable: digest(toolBytes.get(input.dafnyExecutable) as Buffer),
      javaExecutable: digest(toolBytes.get(input.javaExecutable) as Buffer),
      javacExecutable: digest(toolBytes.get(input.javacExecutable) as Buffer),
      jarExecutable: digest(toolBytes.get(input.jarExecutable) as Buffer),
      evaluator: digest(toolBytes.get(EVALUATOR_PATH) as Buffer),
    },
  };
}

async function observeJavaTools(
  input: ValidatedInput,
  runner: LemmaScriptProcessRunner,
  cwd: string,
): Promise<{ readonly java: string | null; readonly javac: string | null; readonly jar: string | null }> {
  const observe = async (executable: string): Promise<string | null> => {
    const result = await runner({ executable, args: ["--version"], cwd, timeoutMs: input.timeoutMs });
    if (!successful(result)) return null;
    return parseVersion(`${result.stdout}\n${result.stderr}`);
  };
  const [java, javac, jar] = await Promise.all([
    observe(input.javaExecutable),
    observe(input.javacExecutable),
    observe(input.jarExecutable),
  ]);
  return { java, javac, jar };
}

async function runDafnyProgram(
  input: ValidatedInput,
  programPath: string,
  cwd: string,
  runner: LemmaScriptProcessRunner,
): Promise<LemmaScriptProcessResult> {
  return runner({
    executable: input.dafnyExecutable,
    args: ["run", "--target", "java", "--no-verify", programPath],
    cwd,
    timeoutMs: input.timeoutMs,
    env: { ...process.env, PATH: `${input.javaBin}${delimiter}${process.env.PATH ?? ""}` },
  });
}

async function detectDrift(
  input: ValidatedInput,
  initial: InitialArtifacts,
  stagedSource: string,
  stagedManifest: string,
): Promise<string | undefined> {
  const originals = new Map<string, Buffer>([
    [input.sourcePath, initial.source],
    [input.caseManifestPath, initial.manifest],
    ...initial.toolBytes,
  ]);
  for (const [path, bytes] of originals) {
    try {
      if (digest(await readRegularFile(path)) !== digest(bytes))
        return "An observed artifact digest drifted during execution.";
    } catch {
      return "An observed artifact could not be re-read for endpoint digest verification.";
    }
  }
  if (digest(await readRegularFile(stagedSource)) !== digest(initial.source))
    return "The staged source digest drifted.";
  if (digest(await readRegularFile(stagedManifest)) !== digest(initial.manifest))
    return "The staged manifest digest drifted.";
  return undefined;
}

function parseVersion(output: string): string | null {
  return OBSERVED_VERSION.exec(output)?.[1] ?? null;
}

function successful(result: LemmaScriptProcessResult): boolean {
  return result.exitCode === 0 && result.signal === null && !result.timedOut;
}

function digest(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function versionsFrom(input: LemmaScriptDifferentialRunnerInput): DifferentialVersions {
  return {
    lemmaScript: { expected: input?.expectedLemmaScriptVersion ?? "", observed: null },
    dafny: { expected: input?.expectedDafnyVersion ?? "", observed: null },
    java: { expected: input?.expectedJavaVersion ?? "", observed: null },
    javac: null,
    jar: null,
  };
}

function emptyDifferentialFacts(): LemmaScriptDifferentialFacts {
  return { caseCount: 0, typescriptObservationCount: 0, dafnyObservationCount: 0, comparisons: [] };
}

function invalidMutation(): LemmaScriptMutationAssessment {
  return {
    status: "invalid",
    benchmarkReady: false,
    facts: { validObservationCount: 0, expectedCount: 0, differingKeys: [] },
    diagnostics: [{ code: "mutation-execution-invalid", message: "Mutation evidence is unavailable." }],
  };
}

function invalidResult(
  versions: DifferentialVersions,
  digests: DifferentialDigests,
  diagnostics: readonly string[],
  mutation: LemmaScriptMutationAssessment = invalidMutation(),
): LemmaScriptDifferentialRunnerResult {
  return {
    status: "invalid",
    semanticEquivalence: "invalid",
    benchmarkReady: false,
    facts: { versions, digests, differential: emptyDifferentialFacts() },
    mutation,
    diagnostics,
  };
}

function withGenerated(digests: DifferentialDigests, generatedDigest: string): DifferentialDigests {
  return { ...digests, generated: generatedDigest, proof: generatedDigest };
}

function withPrograms(
  digests: DifferentialDigests,
  generated: Uint8Array,
  clean: string,
  mutant?: string,
): DifferentialDigests {
  return {
    ...digests,
    generated: digest(generated),
    proof: digest(generated),
    cleanProgram: digest(clean),
    ...(mutant === undefined ? {} : { mutantProgram: digest(mutant) }),
  };
}
