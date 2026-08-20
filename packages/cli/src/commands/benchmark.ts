import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BenchmarkBaselineRunner,
  KILN_BENCHMARK_PROFILES,
  KILN_EXTERNAL_BENCHMARK_TRACKS,
  FileArtifactResourceStore,
  createBenchmarkProfileScorers,
  evaluateBenchmarkReadiness,
  evaluateVerifiedEfficiencyPublicationReadiness,
  generateBenchmarkPublicReport,
  parseDatasetJsonl,
  projectAgentDojoDataset,
  projectBfclDataset,
  projectTauDataset,
  type BenchmarkBaselineResult,
  type BenchmarkEvidenceArtifact,
  type BenchmarkEvidenceArtifactKind,
  type BenchmarkItemExecutor,
  defineDeliberationLevelId,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import {
  BENCHMARK_EXECUTION_ENVELOPE,
  BENCHMARK_POLICY,
  BENCHMARK_WRITE_POLICY,
  createBenchmarkSessionExecutor,
  type BenchmarkSessionExecutorFlags,
} from "../application/benchmark-session-executor.js";
import {
  BACKEND_VERIFIER_ALLOWED_CHANGED_PATHS,
  BACKEND_VERIFIER_ID,
  BACKEND_VERIFIER_IMAGE,
  BACKEND_VERIFIER_VERSION,
} from "../application/benchmark-backend-verifier.js";
import { BACKEND_BENCHMARK_CASES } from "../application/benchmark-backend-cases.js";
import {
  FRONTEND_VERIFIER_ALLOWED_CHANGED_PATHS,
  FRONTEND_VERIFIER_ID,
  FRONTEND_VERIFIER_IMAGE,
  FRONTEND_VERIFIER_IMAGE_ID,
  FRONTEND_VERIFIER_SOURCE_DIGEST,
  FRONTEND_VERIFIER_VERSION,
} from "../application/benchmark-frontend-verifier.js";
import { FRONTEND_BENCHMARK_CASE_IDS } from "../application/benchmark-frontend-cases.js";
import { hashBenchmarkWorkspace, resolveBenchmarkWorkspace } from "../application/benchmark-workspace.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";

export interface BenchmarkCommandDependencies {
  readonly executeItem?: BenchmarkItemExecutor;
  readonly createExecuteItem?: (flags: BenchmarkSessionExecutorFlags) => BenchmarkItemExecutor;
  readonly now?: () => Date;
  readonly repositoryRoot?: string;
}

export async function benchmarkCommand(
  config: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
  dependencies: BenchmarkCommandDependencies = {},
): Promise<void> {
  switch (subcommand) {
    case "profiles":
      printJson(KILN_BENCHMARK_PROFILES);
      return;
    case "tracks":
      printJson(KILN_EXTERNAL_BENCHMARK_TRACKS);
      return;
    case "readiness":
      printJson(evaluateBenchmarkReadiness({
        baselines: readBaselines(args),
      }));
      return;
    case "report":
      writeBenchmarkReport(args);
      return;
    case "run-internal":
      await runInternalBenchmark(config, args, dependencies);
      return;
    case "prepare-verifiers":
      prepareBenchmarkVerifiers();
      return;
    case "project-bfcl":
      projectBfclCommand(args);
      return;
    case "project-agentdojo":
      projectAgentDojoCommand(args);
      return;
    case "project-tau":
      projectTauCommand(args);
      return;
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown benchmark command '${subcommand}'. Use profiles, tracks, readiness, report, run-internal, prepare-verifiers, project-bfcl, project-agentdojo, or project-tau.`);
  }
}

function printHelp(): void {
  console.log([
    "Usage:",
    "  kiln benchmark profiles",
    "  kiln benchmark tracks",
    "  kiln benchmark readiness --baseline <path>",
    "  kiln benchmark report --baseline <path> --output <path> [--publication-manifest <path>] [--repository-root <path>]",
    "  kiln benchmark run-internal --profile <id> [--dataset <path>] [--k <n>] [--output <path>] [--target <execution-target-id>] [--accounts <id,id,...>] [--deliberation-level <id> | --deliberation-level-sweep <ids>]",
    "  kiln benchmark prepare-verifiers",
    "  kiln benchmark project-bfcl --input <path> --output <path>",
    "  kiln benchmark project-agentdojo --input <path> --output <path>",
    "  kiln benchmark project-tau --input <path> --output <path>",
    "",
    "The readiness command expects a JSON file containing either an array of",
    "BenchmarkBaselineResult entries or an object with a baselines array.",
  ].join("\n"));
}

function writeBenchmarkReport(args: readonly string[]): void {
  const outputPath = readFlag(args, "--output");
  if (!outputPath) {
    throw new Error("benchmark report requires --output <path>.");
  }
  const publicationManifestPath = readFlag(args, "--publication-manifest");
  const repositoryRoot = resolveRepositoryRoot(readFlag(args, "--repository-root") ?? process.cwd());
  let publicationManifest: unknown;
  let publicationParseIssue: string | undefined;
  if (publicationManifestPath) {
    try {
      publicationManifest = JSON.parse(readFileSync(publicationManifestPath, "utf-8"));
    } catch {
      publicationParseIssue = "publication manifest must contain valid JSON";
    }
  }
  const evaluatedPublicationReadiness = publicationManifestPath
    ? evaluateVerifiedEfficiencyPublicationReadiness(
        publicationManifest,
        (path) => readRepositoryArtifact(repositoryRoot, path),
        (path, commit) => readRepositoryArtifactAtCommit(repositoryRoot, path, commit),
      )
    : undefined;
  const publicationReadiness = evaluatedPublicationReadiness && publicationParseIssue
    ? {
        ...evaluatedPublicationReadiness,
        issues: [publicationParseIssue, ...evaluatedPublicationReadiness.issues],
      }
    : evaluatedPublicationReadiness;
  const report = generateBenchmarkPublicReport({
    generatedAt: new Date().toISOString(),
    ...(publicationReadiness?.identity
      ? {
          kilnVersion: publicationReadiness.identity.kilnVersion,
          kilnCommit: publicationReadiness.identity.kilnCommit,
        }
      : {}),
    baselines: readBaselines(args),
    limitations: [
      "Generated from supplied Kiln baseline artifacts.",
      "External leaderboard submission requires benchmark-specific adapter validation.",
    ],
    publicationReadiness,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report.markdown, "utf-8");
  printJson({
    outputPath,
    baselineStatus: report.readiness.status,
    publicationStatus: report.publicationReadiness.status,
    publicClaimAllowed: report.publicationReadiness.publicClaimAllowed,
    issues: [...report.readiness.issues, ...report.publicationReadiness.issues],
  });
}

function readRepositoryArtifact(repositoryRoot: string | undefined, path: string): string | undefined {
  return readRepositoryGitArtifact(repositoryRoot, path, "HEAD");
}

function readRepositoryArtifactAtCommit(
  repositoryRoot: string | undefined,
  path: string,
  commit: string,
): string | undefined {
  if (!/^[a-f0-9]{40}$/u.test(commit)) return undefined;
  return readRepositoryGitArtifact(repositoryRoot, path, commit);
}

function resolveRepositoryRoot(path: string): string | undefined {
  try {
    const realRoot = realpathSync(resolve(path));
    const topLevel = execFileSync("git", ["-C", realRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return realpathSync(topLevel) === realRoot ? realRoot : undefined;
  } catch {
    return undefined;
  }
}

function readRepositoryGitArtifact(
  repositoryRoot: string | undefined,
  path: string,
  revision: string,
): string | undefined {
  const repositoryPath = normalizeRepositoryArtifactPath(path);
  if (!repositoryRoot || !repositoryPath) return undefined;
  try {
    const content = execFileSync("git", ["-C", repositoryRoot, "cat-file", "blob", `${revision}:${repositoryPath}`], {
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const decoded = content.toString("utf-8");
    return Buffer.from(decoded, "utf-8").equals(content) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function normalizeRepositoryArtifactPath(path: string): string | undefined {
  if (path.trim() === ""
    || path.includes("\0")
    || isAbsolute(path)
    || win32.isAbsolute(path)
    || path.startsWith("\\")
    || path.startsWith("//")) {
    return undefined;
  }
  const normalized = path.replace(/\\/gu, "/");
  const segments = normalized.split("/");
  if (segments.includes("..") || segments.some((segment) => segment === "" || segment === ".")) return undefined;
  return normalized;
}

function projectBfclCommand(args: readonly string[]): void {
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  if (!inputPath || !outputPath) {
    throw new Error("benchmark project-bfcl requires --input <path> and --output <path>.");
  }
  const projected = projectBfclDataset({
    datasetName: datasetNameFromPath(inputPath),
    content: readFileSync(inputPath, "utf-8"),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    projected.dataset.items.map((item) => JSON.stringify(item)).join("\n") + "\n",
    "utf-8",
  );
  printJson({
    outputPath,
    itemCount: projected.dataset.items.length,
    unsupportedRows: projected.unsupportedRows,
  });
}

function projectAgentDojoCommand(args: readonly string[]): void {
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  if (!inputPath || !outputPath) {
    throw new Error("benchmark project-agentdojo requires --input <path> and --output <path>.");
  }
  const projected = projectAgentDojoDataset({
    datasetName: datasetNameFromPath(inputPath),
    content: readFileSync(inputPath, "utf-8"),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    projected.dataset.items.map((item) => JSON.stringify(item)).join("\n") + "\n",
    "utf-8",
  );
  printJson({
    outputPath,
    itemCount: projected.dataset.items.length,
    unsupportedRows: projected.unsupportedRows,
  });
}

function projectTauCommand(args: readonly string[]): void {
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  if (!inputPath || !outputPath) {
    throw new Error("benchmark project-tau requires --input <path> and --output <path>.");
  }
  const projected = projectTauDataset({
    datasetName: datasetNameFromPath(inputPath),
    content: readFileSync(inputPath, "utf-8"),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    projected.dataset.items.map((item) => JSON.stringify(item)).join("\n") + "\n",
    "utf-8",
  );
  printJson({
    outputPath,
    itemCount: projected.dataset.items.length,
    unsupportedRows: projected.unsupportedRows,
  });
}

async function runInternalBenchmark(
  config: KilnAppConfig,
  args: readonly string[],
  dependencies: BenchmarkCommandDependencies,
): Promise<void> {
  const profileId = readFlag(args, "--profile");
  if (!profileId) {
    throw new Error("benchmark run-internal requires --profile <id>.");
  }
  const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === profileId);
  if (!profile) {
    throw new Error(`Unknown benchmark profile '${profileId}'.`);
  }
  const writeProfile = profile.id === "kiln-model-roster-backend-write"
    || profile.id === "kiln-model-roster-frontend-render"
    || profile.id === "kiln-formal-verification-pilot";
  const datasetPath = readFlag(args, "--dataset") ?? defaultDatasetPath(profile.id);
  const datasetContent = readFileSync(datasetPath, "utf-8");
  const dataset = parseDatasetJsonl(datasetNameFromPath(datasetPath), datasetContent);
  assertNoExecutorOwnedMetadata(dataset.items);
  const repositoryRoot = dependencies.repositoryRoot ?? resolveProjectRoot().rootPath;
  const workspaceFixtures = collectWorkspaceFixtureEvidence(repositoryRoot, dataset.items);
  const workspaceFixtureHashes = new Map(
    workspaceFixtures.map((fixture) => [fixture.path, fixture.sha256] as const),
  );
  const k = parsePositiveInteger(readFlag(args, "--k") ?? String(profile.minimumK), "--k");
  const outputPath = readFlag(args, "--output") ?? defaultOutputPath(profile.id, dependencies.now?.() ?? new Date());
  const artifactRoot = resolve(`${outputPath}.artifacts`);
  const deliberationMembers = readDeliberationLevelMembers(args);
  const artifactStore = new FileArtifactResourceStore({ rootDir: artifactRoot });
  const accountOverrideIds = readAccountPool(args);
  const benchmarkPairIds = [...new Set(dataset.items.map((item) => (
    typeof item.metadata?.pairId === "string" && item.metadata.pairId.trim().length > 0
      ? item.metadata.pairId.trim()
      : item.id
  )))];
  const runs = [];
  for (const deliberationLevel of deliberationMembers) {
    const executorFlags = readExecutorFlags(args, deliberationLevel, accountOverrideIds, benchmarkPairIds);
    const executor = dependencies.createExecuteItem?.(executorFlags)
      ?? dependencies.executeItem
      ?? createBenchmarkSessionExecutor({ appConfig: config, flags: executorFlags });
    const runner = new BenchmarkBaselineRunner({
      profile,
      dataset,
      datasetVersion: datasetVersionFromPath(datasetPath),
      k,
      configHash: computeConfigHash({
        profile,
        datasetName: dataset.name,
        datasetVersion: datasetVersionFromPath(datasetPath),
        datasetContentHash: hashContent(datasetContent),
        workspaceFixtures,
        benchmarkContext: workspaceFixtures.length > 0 ? {
          mode: writeProfile
            ? "sanitized-disposable-write-v2"
            : "sanitized-synthetic-v1",
          postRunFixtureVerification: true,
        } : { mode: "repository-worktree-v1" },
        k,
        authorityProfile: profile.authorityProfile,
        permissionPolicy: writeProfile
          ? BENCHMARK_WRITE_POLICY
          : BENCHMARK_POLICY,
        executionEnvelope: BENCHMARK_EXECUTION_ENVELOPE,
        ...(profile.id === "kiln-model-roster-backend-write" ? {
          strictToolProjection: ["read", "read_many", "grep", "glob", "tree", "stat", "write", "edit", "patch"],
          verifier: {
            id: BACKEND_VERIFIER_ID,
            version: BACKEND_VERIFIER_VERSION,
            image: BACKEND_VERIFIER_IMAGE,
            cases: Object.values(BACKEND_BENCHMARK_CASES).map((entry) => ({
              id: entry.id,
              hiddenTestDigest: entry.testDigest,
              testCount: entry.testCount,
            })),
            allowedChangedPaths: BACKEND_VERIFIER_ALLOWED_CHANGED_PATHS,
          },
        } : {}),
        ...(profile.id === "kiln-formal-verification-pilot" ? {
          pairedDesign: {
            arms: ["control", "treatment"],
            assignment: "same-preferred-account-with-explicit-failover",
            treatmentDifference: "formal_verify strict projection",
            primaryOutcome: "out-of-process hidden functional tests",
          },
          strictToolProjection: {
            control: ["read", "read_many", "grep", "glob", "tree", "stat", "write", "edit", "patch"],
            treatment: ["read", "read_many", "grep", "glob", "tree", "stat", "write", "edit", "patch", "formal_verify"],
          },
          verifier: {
            id: BACKEND_VERIFIER_ID,
            version: BACKEND_VERIFIER_VERSION,
            image: BACKEND_VERIFIER_IMAGE,
            cases: [
              "idempotent-reservation",
              "atomic-transfer",
              "default-deny-access",
              "bounded-retry",
            ].map((id) => {
              const entry = BACKEND_BENCHMARK_CASES[id as keyof typeof BACKEND_BENCHMARK_CASES];
              return { id: entry.id, hiddenTestDigest: entry.testDigest, testCount: entry.testCount };
            }),
            allowedChangedPaths: ["src/solution.mjs", "proof/model.dfy"],
          },
        } : {}),
        ...(profile.id === "kiln-model-roster-frontend-render" ? {
          strictToolProjection: ["read", "read_many", "grep", "glob", "tree", "stat", "write", "edit", "patch"],
          verifier: {
            id: FRONTEND_VERIFIER_ID,
            version: FRONTEND_VERIFIER_VERSION,
            image: FRONTEND_VERIFIER_IMAGE,
            imageId: FRONTEND_VERIFIER_IMAGE_ID,
            sourceDigest: FRONTEND_VERIFIER_SOURCE_DIGEST,
            allowedChangedPaths: FRONTEND_VERIFIER_ALLOWED_CHANGED_PATHS,
            viewport: { width: 1280, height: 720 },
            reducedMotion: "reduce",
            accessibilityEngine: "axe-core@4.12.1",
            cases: FRONTEND_BENCHMARK_CASE_IDS,
          },
        } : {}),
        targetId: executorFlags.targetId ?? "configured-default",
        accountOverrideIds: executorFlags.accountOverrideIds ?? [],
        accountAssignment: "paired-preferred-with-explicit-failover-v1",
        deliberationLevel: deliberationLevel ?? "provider-default",
        deliberationMode: deliberationMembers.length > 1
          ? "sweep"
          : deliberationLevel ? "fixed" : "provider-default",
        scorerNames: profile.requiredScorers,
      }),
      scorers: createBenchmarkProfileScorers(profile),
      artifactStore,
      executeItem: requireWorkspaceFixtureEvidence(
        requireDeliberationEvidence(executor, deliberationLevel),
        workspaceFixtureHashes,
      ),
    });
    const result = await runner.run();
    runs.push({ deliberationLevel: deliberationLevel ?? null, ...result });
  }
  const baselines = runs.map((run) => run.baseline);
  const singleRun = runs.length === 1 ? runs[0] : undefined;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    artifactRoot,
    baselines,
    runs,
    ...(singleRun ? {
      baseline: singleRun.baseline,
      consistency: singleRun.consistency,
      artifactUris: singleRun.artifactUris,
    } : {}),
  }, null, 2), "utf-8");
  printJson({
    outputPath,
    artifactRoot,
    ...(singleRun ? { baseline: singleRun.baseline } : { baselines }),
    readiness: evaluateBenchmarkReadiness({ baselines }),
  });
}

function prepareBenchmarkVerifiers(): void {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const frontendContext = resolve(currentDir, "..", "..", "verifiers", "frontend");
  execFileSync("docker", [
    "build",
    "--pull=false",
    "--provenance=false",
    "--sbom=false",
    "--tag",
    FRONTEND_VERIFIER_IMAGE,
    frontendContext,
  ], {
    stdio: "inherit",
    windowsHide: true,
  });
  const evidence = execFileSync("docker", [
    "image",
    "inspect",
    FRONTEND_VERIFIER_IMAGE,
    "--format",
    "{{.Id}}|{{index .Config.Labels \"io.kiln.verifier-source\"}}|{{index .Config.Labels \"org.opencontainers.image.version\"}}",
  ], { encoding: "utf8", windowsHide: true }).trim();
  const [imageId, sourceDigest, version] = evidence.split("|");
  if (imageId !== FRONTEND_VERIFIER_IMAGE_ID
    || sourceDigest !== FRONTEND_VERIFIER_SOURCE_DIGEST
    || version !== FRONTEND_VERIFIER_VERSION) {
    throw new Error("Prepared frontend verifier image did not match the admitted image ID, source digest, and version.");
  }
  printJson({
    status: "ready",
    frontend: {
      image: FRONTEND_VERIFIER_IMAGE,
      imageId,
      sourceDigest,
      version,
    },
    backend: {
      image: BACKEND_VERIFIER_IMAGE,
      verifierId: BACKEND_VERIFIER_ID,
      verifierVersion: BACKEND_VERIFIER_VERSION,
    },
  });
}

function collectWorkspaceFixtureEvidence(
  repositoryRoot: string,
  items: readonly { readonly metadata?: Readonly<Record<string, unknown>> }[],
): readonly { readonly path: string; readonly sha256: string }[] {
  const fixtures = new Map<string, string>();
  for (const item of items) {
    const declared = item.metadata?.workspaceFixture;
    if (declared === undefined) continue;
    const workspace = resolveBenchmarkWorkspace(repositoryRoot, declared);
    if (workspace.kind !== "synthetic-fixture" || !workspace.fixturePath) {
      throw new Error("Benchmark workspace fixture evidence could not be resolved.");
    }
    fixtures.set(workspace.fixturePath, hashBenchmarkWorkspace(workspace));
  }
  return [...fixtures.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([path, sha256]) => ({ path, sha256 }));
}

const EXECUTOR_OWNED_BENCHMARK_METADATA = new Set([
  "observedVerification",
  "formalVerificationObservations",
  "formalVerificationExpectedVersion",
  "accountId",
  "expectedAccountId",
  "scheduledAccountId",
  "accountFallbackCount",
  "workspaceChanges",
  "workspaceFixtureHash",
  "benchmarkWorkspaceKind",
  "benchmarkContextKind",
]);

function assertNoExecutorOwnedMetadata(
  items: readonly { readonly id: string; readonly metadata?: Readonly<Record<string, unknown>> }[],
): void {
  for (const item of items) {
    const reserved = Object.keys(item.metadata ?? {}).filter((key) => EXECUTOR_OWNED_BENCHMARK_METADATA.has(key));
    if (reserved.length > 0) {
      throw new Error(`Benchmark item '${item.id}' declares executor-owned metadata: ${reserved.join(", ")}`);
    }
  }
}

function requireWorkspaceFixtureEvidence(
  executor: BenchmarkItemExecutor,
  expectedHashes: ReadonlyMap<string, string>,
): BenchmarkItemExecutor {
  return async (input, context) => {
    const result = await executor(input, context);
    const declared = context.item.metadata?.workspaceFixture;
    if (declared === undefined) return result;
    if (typeof declared !== "string") {
      throw new Error("Benchmark item workspace fixture must be a string.");
    }
    const expectedHash = expectedHashes.get(declared);
    if (!expectedHash
      || result.metadata?.benchmarkWorkspaceKind !== "synthetic-fixture"
      || result.metadata.workspaceFixture !== declared
      || result.metadata.workspaceFixtureHash !== expectedHash) {
      throw new Error(`Benchmark executor did not prove synthetic workspace fixture '${declared}' at its configured hash.`);
    }
    return result;
  };
}

function requireDeliberationEvidence(
  executor: BenchmarkItemExecutor,
  deliberationLevel: string | undefined,
): BenchmarkItemExecutor {
  if (!deliberationLevel) return executor;
  return async (input, context) => {
    const result = await executor(input, context);
    const resolution = result.metadata?.deliberationResolution;
    if (!resolution || typeof resolution !== "object"
      || (resolution as { readonly status?: unknown }).status !== "exact"
      || (resolution as { readonly selectedLevel?: unknown }).selectedLevel !== deliberationLevel) {
      throw new Error(`Benchmark executor did not prove resolution of deliberation level '${deliberationLevel}'.`);
    }
    return result;
  };
}

function readBaselines(args: readonly string[]): readonly BenchmarkBaselineResult[] {
  const baselinePath = readFlag(args, "--baseline");
  if (!baselinePath) {
    throw new Error("benchmark readiness requires --baseline <path>.");
  }
  const parsed = JSON.parse(readFileSync(baselinePath, "utf-8")) as unknown;
  const baselines = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { readonly baselines?: unknown }).baselines)
      ? (parsed as { readonly baselines: readonly unknown[] }).baselines
      : undefined;
  if (!baselines) {
    throw new Error("benchmark baseline file must be an array or an object with a baselines array.");
  }
  return baselines.map(parseBaseline);
}

function parseBaseline(value: unknown): BenchmarkBaselineResult {
  if (!value || typeof value !== "object") {
    throw new Error("benchmark baseline entries must be objects.");
  }
  const record = value as Record<string, unknown>;
  return {
    profileId: requireString(record.profileId, "profileId"),
    profileVersion: requireString(record.profileVersion, "profileVersion"),
    datasetName: requireString(record.datasetName, "datasetName"),
    datasetItemCount: requireNumber(record.datasetItemCount, "datasetItemCount"),
    k: requireNumber(record.k, "k"),
    passRate: requireNumber(record.passRate, "passRate"),
    passRateInterval: requireProportionInterval(record.passRateInterval, "passRateInterval"),
    passAtK: requireNumber(record.passAtK, "passAtK"),
    passAtKInterval: requireProportionInterval(record.passAtKInterval, "passAtKInterval"),
    validTrialCount: requireNumber(record.validTrialCount, "validTrialCount"),
    invalidTrialCount: requireNumber(record.invalidTrialCount, "invalidTrialCount"),
    invalidTrialRate: requireNumber(record.invalidTrialRate, "invalidTrialRate"),
    incompleteItemIds: requireStringArray(record.incompleteItemIds, "incompleteItemIds"),
    scorers: requireStringArray(record.scorers, "scorers"),
    artifactUris: requireStringArray(record.artifactUris, "artifactUris"),
    evidenceArtifacts: requireEvidenceArtifacts(record.evidenceArtifacts),
    configHash: requireString(record.configHash, "configHash"),
    datasetVersion: requireString(record.datasetVersion, "datasetVersion"),
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`benchmark baseline field '${field}' must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`benchmark baseline field '${field}' must be a finite number.`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    throw new Error(`benchmark baseline field '${field}' must be an array of non-empty strings.`);
  }
  return value;
}

function requireEvidenceArtifacts(value: unknown): readonly BenchmarkEvidenceArtifact[] {
  if (!Array.isArray(value)) {
    throw new Error("benchmark baseline field 'evidenceArtifacts' must be an array of evidence artifact records.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`benchmark baseline evidenceArtifacts[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    return {
      kind: requireEvidenceArtifactKind(record.kind, index),
      uri: requireString(record.uri, `evidenceArtifacts[${index}].uri`),
    };
  });
}

function requireEvidenceArtifactKind(value: unknown, index: number): BenchmarkEvidenceArtifactKind {
  const allowed: readonly BenchmarkEvidenceArtifactKind[] = [
    "result",
    "transcript",
    "tool-calls",
    "diagnostics",
    "usage",
    "route",
    "cost",
    "cache-topology",
    "diff",
    "verification",
  ];
  if (typeof value === "string" && allowed.includes(value as BenchmarkEvidenceArtifactKind)) {
    return value as BenchmarkEvidenceArtifactKind;
  }
  throw new Error(`benchmark baseline evidenceArtifacts[${index}].kind must be a supported evidence artifact kind.`);
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readExecutorFlags(
  args: readonly string[],
  deliberationLevel?: string,
  accountOverrideIds?: readonly string[],
  benchmarkPairIds?: readonly string[],
): BenchmarkSessionExecutorFlags {
  return {
    targetId: readFlag(args, "--target"),
    ...(accountOverrideIds && accountOverrideIds.length > 0 ? { accountOverrideIds } : {}),
    ...(benchmarkPairIds && benchmarkPairIds.length > 0 ? { benchmarkPairIds } : {}),
    skipGitRepoCheck: args.includes("--skip-git-repo-check"),
    deliberationLevel,
  };
}

function readAccountPool(args: readonly string[]): readonly string[] {
  const raw = readFlag(args, "--accounts");
  if (!raw) return [];
  if (!readFlag(args, "--target")) {
    throw new Error("account-balanced benchmarks require explicit --target identity.");
  }
  const accounts = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (accounts.length === 0) {
    throw new Error("--accounts requires at least one account id.");
  }
  if (new Set(accounts).size !== accounts.length) {
    throw new Error("--accounts must not contain duplicate account ids.");
  }
  return accounts;
}

function requireProportionInterval(
  value: unknown,
  field: string,
): { readonly confidence: 0.95; readonly lower: number; readonly upper: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`benchmark baseline field '${field}' must be an interval object.`);
  }
  const record = value as Record<string, unknown>;
  if (record.confidence !== 0.95) {
    throw new Error(`benchmark baseline field '${field}.confidence' must be 0.95.`);
  }
  return {
    confidence: 0.95,
    lower: requireNumber(record.lower, `${field}.lower`),
    upper: requireNumber(record.upper, `${field}.upper`),
  };
}

function readDeliberationLevelMembers(args: readonly string[]): readonly (string | undefined)[] {
  const fixed = readFlag(args, "--deliberation-level");
  const sweep = readFlag(args, "--deliberation-level-sweep");
  if (fixed && sweep) {
    throw new Error("benchmark run-internal accepts either --deliberation-level or --deliberation-level-sweep, not both.");
  }
  const requested: readonly (string | undefined)[] = fixed ? [parseDeliberationLevel(fixed)] : sweep
    ? sweep.split(",").map((entry) => parseDeliberationLevel(entry.trim()))
    : [undefined];
  if (sweep && requested.length < 2) {
    throw new Error("--deliberation-level-sweep requires at least two comma-separated levels.");
  }
  if (new Set(requested).size !== requested.length) {
    throw new Error("--deliberation-level-sweep must not contain duplicate levels.");
  }
  if (requested[0] !== undefined && !readFlag(args, "--target")) {
    throw new Error("deliberation-level benchmarks require explicit --target identity.");
  }
  return requested;
}

function parseDeliberationLevel(value: string): string {
  return defineDeliberationLevelId(value);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function defaultDatasetPath(profileId: string): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === profileId);
  if (!profile) throw new Error(`Unknown benchmark profile '${profileId}'.`);
  const datasetVersion = profile.surface === "model-roster-backend-write"
    || profile.surface === "model-roster-frontend-render"
    ? profile.version
    : "1";
  return join(currentDir, "..", "..", "..", "core", "evals", "benchmark", `${profileId}-v${datasetVersion}.jsonl`);
}

function datasetNameFromPath(path: string): string {
  return path.replace(/\\/gu, "/").split("/").pop()?.replace(/\.jsonl$/u, "") ?? "benchmark-dataset";
}

function datasetVersionFromPath(path: string): string {
  const name = datasetNameFromPath(path);
  return name.match(/-v(\d+)$/u)?.[1] ?? "1";
}

function defaultOutputPath(profileId: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  return join(process.cwd(), ".kiln", "benchmarks", `${profileId}-${stamp}.json`);
}

function computeConfigHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function hashContent(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
