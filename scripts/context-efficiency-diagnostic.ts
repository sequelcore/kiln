import { projectContextEfficiencyProviderEvidence, hasSettledContextEfficiencyProviderEvidence } from "./context-efficiency-provider-evidence.js";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  createAccountUsageInspectionService,
  type AccountUsageInspectionEntry,
} from "../packages/cli/src/application/account-usage-inspection.js";
import { readRuntimeConfigurationRevision } from "../packages/cli/src/application/runtime-configuration-revision.js";
import {
  readGlobalConfig,
  readGlobalExecutionTargetAuthority,
} from "../packages/cli/src/config/global-config.js";
import {
  createContextEfficiencyReportIntegrity,
  digestContextEfficiencySchedule,
  type ContextEfficiencyFrozenReportIdentity,
} from "./context-efficiency-report-integrity.js";
import {
  evaluateContextEfficiencyTrialBudget,
  sumContextEfficiencyObservedUsage,
  type ContextEfficiencyPhysicalRequestUsage,
} from "./context-efficiency-trial-budget.js";
import {
  evaluateContextEfficiencyTaskOracle,
  hasUnsettledManagedChildInvocation,
  type ContextEfficiencyTaskOracleEvidence,
} from "./context-efficiency-task-oracles.js";
import {
  digestContextEfficiencyCanonicalValue as digestCanonicalValue,
  digestContextEfficiencyProtocol,
  freezeContextEfficiencyProtocol,
} from "./context-efficiency-protocol.js";
import { resolveProjectStateBinding } from "../packages/cli/src/application/project-state-root.js";

const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "systemHash",
  "messageHash",
  "toolSchemaHash",
  "stablePrefixHash",
  "finalPromptHash",
  "rawPrompt",
  "rawMessages",
  "rawToolSchema",
  "rawToolResult",
  "credential",
]);
const execFileAsync = promisify(execFile);
const REQUIRED_SOURCE_CONTRACT_PATHS = [
  "packages/cli/src/application/canonical-run-session-dispatcher.ts",
  "packages/cli/src/wrapper/permission-policy-authorizer.ts",
  "packages/core/src/context/effective-prompt-observation.ts",
  "packages/runtime/src/gateway/effective-prompt-observation-mapper.ts",
] as const;

export interface ContextEfficiencyCollectedTrial {
  readonly taskId: string;
  readonly condition: "cold" | "immediate_warm" | "long_session";
  readonly repetition: number;
  readonly attempt?: number;
  readonly validity?: "valid" | "invalid";
  readonly invalidReason?: ContextEfficiencyInvalidReason;
  readonly invalidDiagnostic?: ContextEfficiencyInvalidDiagnostic;
  readonly output?: unknown;
  readonly dispatchEvidence?: "not_dispatched" | "observed" | "unknown";
  readonly reservedMaximumProviderRequests?: number;
}

export type ContextEfficiencyInvalidReason =
  | "infrastructure_failure"
  | "route_identity_mismatch"
  | "collector_failure"
  | "canonical_transcript_unavailable";

export type ContextEfficiencyInvalidDiagnostic =
  | "execution_target_evidence_unavailable"
  | "execution_target_route_unavailable"
  | "session_preparation_failed"
  | "authority_admission_failed"
  | "account_admission_failed"
  | "execution_envelope_invalid"
  | "credential_unavailable"
  | "unstructured_command_failure"
  | "unclassified_predispatch_failure";

export class ContextEfficiencyInvalidTrialError extends Error {
  override readonly name = "ContextEfficiencyInvalidTrialError";
  readonly dispatchEvidence: "not_dispatched" | "observed" | "unknown";
  readonly output?: unknown;

  constructor(
    readonly reason: ContextEfficiencyInvalidReason,
    message: string,
    readonly diagnostic?: ContextEfficiencyInvalidDiagnostic,
    options?: ErrorOptions & {
      readonly dispatchEvidence?: "not_dispatched" | "observed" | "unknown";
      readonly output?: unknown;
    },
  ) {
    super(message, options);
    this.dispatchEvidence = options?.dispatchEvidence ?? "unknown";
    this.output = options?.output;
  }
}

export interface ContextEfficiencyScheduledTrial {
  readonly taskId: string;
  readonly executionStrategy: string;
  readonly condition: "cold" | "immediate_warm" | "long_session";
  readonly repetition: number;
  readonly invalidRetryLimit: number;
  readonly timeoutMs: number;
  readonly budgets: {
    readonly maximumProviderRequests: number;
    readonly maximumToolCalls: number;
    readonly maximumManagedChildren: number;
    readonly maximumCumulativeInputTokens: number;
    readonly maximumCumulativeOutputTokens: number;
  };
}

export interface ContextEfficiencyStrategyResult {
  readonly output: unknown;
  readonly continuationSessionId?: string;
}

export interface ContextEfficiencyStrategyDispatcher {
  runCli(input: {
    readonly trial: ContextEfficiencyScheduledTrial;
    readonly task: Readonly<Record<string, unknown>>;
    readonly continuationSessionId?: string;
  }): Promise<ContextEfficiencyStrategyResult>;
  runConversation(input: {
    readonly trial: ContextEfficiencyScheduledTrial;
    readonly task: Readonly<Record<string, unknown>>;
    readonly checkpoint?: (output: unknown) => Promise<void>;
  }): Promise<ContextEfficiencyStrategyResult>;
  runInternalBenchmark(input: {
    readonly trial: ContextEfficiencyScheduledTrial;
    readonly task: Readonly<Record<string, unknown>>;
  }): Promise<ContextEfficiencyStrategyResult>;
}

export interface ContextEfficiencyCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ContextEfficiencyCommandRunner {
  run(input: {
    readonly command: readonly string[];
    readonly cwd: string;
    readonly timeoutMs: number;
  }): Promise<ContextEfficiencyCommandResult>;
}

export interface ProductionContextEfficiencyDispatcher extends ContextEfficiencyStrategyDispatcher {
  cleanup(): Promise<void>;
}

export function buildCliRunCommand(input: {
  readonly repositoryRoot: string;
  readonly identity: Readonly<Record<string, unknown>>;
  readonly trial: ContextEfficiencyScheduledTrial;
  readonly task: Readonly<Record<string, unknown>>;
  readonly continuationSessionId?: string;
  readonly generatedFixturePath?: string;
  readonly executionEnvelopePath?: string;
  readonly disableTools?: boolean;
  readonly disableMcp?: boolean;
}): readonly string[] {
  const taskInput = requireString(input.task.input, "task input");
  const authority = requireString(input.task.authority, "task authority");
  const targetId = requireString(input.identity.targetId, "target identity");
  const deliberationLevel = requireString(input.identity.deliberationLevel, "deliberation level");
  const prompt = input.generatedFixturePath
    ? `${taskInput}\nThe generated fixture directory for this trial is ${input.generatedFixturePath}.`
    : taskInput;
  return [
    "bun",
    "packages/cli/src/index.ts",
    "run",
    prompt,
    "--target",
    targetId,
    "--output",
    "json",
    "--deliberation-level",
    deliberationLevel,
    "--authority",
    authority,
    ...(input.continuationSessionId
      ? ["--continue-session", input.continuationSessionId]
      : []),
    ...(input.generatedFixturePath ? ["--add-dir", input.generatedFixturePath] : []),
    ...(input.executionEnvelopePath ? ["--execution-envelope", input.executionEnvelopePath] : []),
    ...(input.disableTools ? ["--disable-tools"] : []),
    ...(input.disableMcp ? ["--disable-mcp"] : []),
  ];
}

export function buildInternalBenchmarkCommand(input: {
  readonly identity: Readonly<Record<string, unknown>>;
  readonly trial: ContextEfficiencyScheduledTrial;
  readonly task: Readonly<Record<string, unknown>>;
  readonly executionEnvelopePath?: string;
}): readonly string[] {
  const oracle = input.task.oracle;
  if (!isRecord(oracle)) throw new Error("Internal benchmark task oracle is missing.");
  const dataset = requireString(oracle.dataset, "internal benchmark dataset");
  const profile = input.trial.executionStrategy === "internal_benchmark_isolated_fixture"
    ? "kiln-managed-coding-agent"
    : input.trial.executionStrategy === "internal_benchmark_managed_child"
      ? "kiln-managed-child-agent"
      : undefined;
  if (!profile) throw new Error(`Unsupported internal benchmark strategy '${input.trial.executionStrategy}'.`);
  const plusAccountIds = readDeclaredPlusAccountIds(input.identity);
  return [
    "bun",
    "packages/cli/src/index.ts",
    "benchmark",
    "run-internal",
    "--profile",
    profile,
    "--dataset",
    dataset,
    "--k",
    "1",
    "--max-invalid-attempts",
    "0",
    "--target",
    requireString(input.identity.targetId, "target identity"),
    "--accounts",
    plusAccountIds.join(","),
    "--deliberation-level",
    requireString(input.identity.deliberationLevel, "deliberation level"),
    ...(input.executionEnvelopePath ? ["--execution-envelope", input.executionEnvelopePath] : []),
  ];
}

export function createBunContextEfficiencyCommandRunner(): ContextEfficiencyCommandRunner {
  return {
    async run(input) {
      const process = Bun.spawn([...input.command], {
        cwd: input.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const timeout = setTimeout(() => process.kill(), input.timeoutMs);
      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          process.exited,
          new Response(process.stdout).text(),
          new Response(process.stderr).text(),
        ]);
        return { exitCode, stdout, stderr };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function computeGitWorktreeFingerprint(repositoryRoot: string): Promise<string> {
  const diff = await runGitForFingerprint(repositoryRoot, ["diff", "--binary", "--no-ext-diff", "HEAD"]);
  const untrackedOutput = await runGitForFingerprint(
    repositoryRoot,
    ["ls-files", "--others", "--exclude-standard", "-z"],
  );
  const hash = createHash("sha256").update(diff, "utf8");
  for (const path of untrackedOutput.split("\0").filter(Boolean).sort()) {
    const target = resolve(repositoryRoot, path);
    const targetRelative = relative(repositoryRoot, target);
    if (targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
      throw new Error(`Git reported an untracked path outside the repository: ${path}`);
    }
    hash.update(`\0${path}\0`, "utf8").update(await readFile(target));
  }
  return `sha256:${hash.digest("hex")}`;
}

async function runGitForFingerprint(repositoryRoot: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new Error(`Unable to fingerprint benchmark worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function classifyPredispatchFailure(value: unknown): ContextEfficiencyInvalidDiagnostic {
  if (!isRecord(value) || value.schemaVersion !== "kiln.run.output.v1") {
    return "unstructured_command_failure";
  }
  const diagnostics = isRecord(value) && isRecord(value.diagnostics) ? value.diagnostics : undefined;
  const lastError = typeof diagnostics?.lastError === "string" ? diagnostics.lastError.toLowerCase() : "";
  if (lastError.includes("execution target") && (lastError.includes("evidence") || lastError.includes("stale"))) {
    return "execution_target_evidence_unavailable";
  }
  if (lastError.includes("execution target") || lastError.includes("configured route")) {
    return "execution_target_route_unavailable";
  }
  if (lastError.includes("failed to prepare session")) return "session_preparation_failed";
  if (lastError.includes("eligible account") || lastError.includes("account capacity")) {
    return "account_admission_failed";
  }
  if (lastError.includes("authority") || lastError.includes("admission")) return "authority_admission_failed";
  if (lastError.includes("executionenvelope") || lastError.includes("execution envelope")) {
    return "execution_envelope_invalid";
  }
  if (lastError.includes("credential") || lastError.includes("authentication")) return "credential_unavailable";
  return "unclassified_predispatch_failure";
}

export function createProductionContextEfficiencyDispatcher(input: {
  readonly repositoryRoot: string;
  readonly manifest: unknown;
  readonly commandRunner?: ContextEfficiencyCommandRunner;
  readonly worktreeFingerprint?: () => Promise<string>;
  readonly now?: () => number;
}): ProductionContextEfficiencyDispatcher {
  const repositoryRoot = resolve(input.repositoryRoot);
  const identity = readManifestIdentity(input.manifest);
  const commandRunner = input.commandRunner ?? createBunContextEfficiencyCommandRunner();
  const worktreeFingerprint = input.worktreeFingerprint
    ?? (() => computeGitWorktreeFingerprint(repositoryRoot));
  const now = input.now ?? (() => Math.floor(performance.now()));
  let generatedFixtureRoot: string | undefined;
  let generatedFixtureChecksum: string | undefined;
  const generatedFixturePaths = new Map<string, string>();
  const executionEnvelopePaths = new Map<string, string>();

  const runCommand = async (
    command: readonly string[],
    timeoutMs: number,
    acceptRunEnvelopeOnFailure = false,
  ): Promise<unknown> => {
    const result = await commandRunner.run({ command, cwd: repositoryRoot, timeoutMs });
    let parsed: unknown;
    try {
      parsed = parseJsonOutput(result.stdout, "diagnostic command");
    } catch (error) {
      if (result.exitCode === 0) {
        throw new ContextEfficiencyInvalidTrialError(
          "collector_failure",
          "Diagnostic command returned an invalid success envelope.",
          undefined,
          { cause: error },
        );
      }
    }
    if (result.exitCode !== 0) {
      if (acceptRunEnvelopeOnFailure && isRecord(parsed) && parsed.schemaVersion === "kiln.run.output.v1") {
        const telemetry = isRecord(parsed.telemetry) ? parsed.telemetry : undefined;
        if (Array.isArray(telemetry?.providerRequests) && telemetry.providerRequests.length > 0) {
          return parsed;
        }
        throw new ContextEfficiencyInvalidTrialError(
          "infrastructure_failure",
          "Diagnostic command failed before canonical provider dispatch.",
          classifyPredispatchFailure(parsed),
          { dispatchEvidence: "not_dispatched" },
        );
      }
      const diagnostic = result.stderr.trim() || result.stdout.trim() || "no diagnostic output";
      throw new ContextEfficiencyInvalidTrialError(
        "infrastructure_failure",
        `Diagnostic command exited ${result.exitCode}: ${diagnostic}`,
        classifyPredispatchFailure(parsed),
      );
    }
    return parsed;
  };

  const runCliEnvelope = async (
    trial: ContextEfficiencyScheduledTrial,
    task: Readonly<Record<string, unknown>>,
    continuationSessionId?: string,
    generatedFixturePath?: string,
  ): Promise<RunEnvelope> => {
    const executionEnvelopePath = await resolveExecutionEnvelopePath(trial, task);
    const oracle = requireRecord(task.oracle, "task oracle");
    const beforeWorktree = await worktreeFingerprint();
    const output = await runCommand(buildCliRunCommand({
      repositoryRoot,
      identity,
      trial,
      task,
      ...(continuationSessionId ? { continuationSessionId } : {}),
      ...(generatedFixturePath ? { generatedFixturePath } : {}),
      executionEnvelopePath,
      disableTools: oracle.maximumToolCalls === 0,
      disableMcp: true,
    }), trial.timeoutMs, true);
    let envelope: RunEnvelope;
    try {
      envelope = validateContextEfficiencyRunEnvelope(output);
    } catch (error) {
      throw new ContextEfficiencyInvalidTrialError(
        "collector_failure",
        "Diagnostic command output lacks canonical collection evidence.",
        undefined,
        { cause: error },
      );
    }
    if (!hasSettledContextEfficiencyProviderEvidence(envelope.telemetry.providerRequests ?? [])) {
      throw new ContextEfficiencyInvalidTrialError("collector_failure", "Provider dispatch settlement remains unknown.", undefined,
        { output: envelope, dispatchEvidence: "unknown" });
    }
    assertFrozenRunIdentity(envelope, identity);
    const afterWorktree = await worktreeFingerprint();
    return {
      ...envelope,
      diagnostics: {
        ...envelope.diagnostics,
        workspaceUnchanged: beforeWorktree === afterWorktree,
      },
    };
  };

  return {
    async runCli({ trial, task, continuationSessionId }) {
      const generatedFixturePath = trial.executionStrategy === "cli_run_generated_fixture"
        ? await resolveGeneratedFixturePath()
        : undefined;
      const envelope = await runCliEnvelope(trial, task, continuationSessionId, generatedFixturePath);
      return {
        output: applyTrialBudgetEvaluation(withTaskEvaluation({ ...envelope,
          oracleEvidence: {
            ...(envelope.oracleEvidence ?? {}),
            ...(generatedFixturePath === undefined ? {} : {
              answerVerified: envelope.answer?.trim() === generatedFixtureChecksum,
            }),
          },
        }, task, repositoryRoot), trial),
        continuationSessionId: envelope.telemetry.sessionId,
      };
    },

    async runConversation({ trial, task, checkpoint }) {
      const oracle = requireRecord(task.oracle, "conversation oracle");
      const scriptPath = resolve(repositoryRoot, requireString(oracle.scriptFixture, "conversation script fixture"));
      const script = parseJsonOutput(await readFile(scriptPath, "utf8"), "conversation script fixture");
      if (!isRecord(script) || !Array.isArray(script.turns) || script.turns.length !== 8
        || script.turns.length > trial.budgets.maximumProviderRequests || oracle.maximumToolCalls !== 0) {
        throw new ContextEfficiencyInvalidTrialError(
          "collector_failure", "Conversation requires eight no-tool turns with a physical allocation for each.",
          undefined, { dispatchEvidence: "not_dispatched" },
        );
      }
      let continuationSessionId: string | undefined;
      const envelopes: RunEnvelope[] = [];
      const startedAt = now();
      let stopped = false;
      for (const rawTurn of script.turns) {
        const decision = evaluateContextEfficiencyTrialBudget({
          limits: { timeoutMs: trial.timeoutMs, ...trial.budgets },
          elapsedMs: now() - startedAt,
          toolCallCount: envelopes.reduce((sum, envelope) => sum + envelope.telemetry.toolCallCount, 0),
          managedChildCount: envelopes.reduce((sum, envelope) => sum + envelope.telemetry.managedChildCount, 0),
          failed: envelopes.some((envelope) => !envelope.telemetry.sessionSucceeded),
          physicalRequests: readPhysicalUsage(envelopes),
        });
        if (decision.kind === "stop") { stopped = true; break; }
        const turn = requireRecord(rawTurn, "conversation turn");
        let envelope: RunEnvelope;
        try {
          envelope = await runCliEnvelope(
            {
              ...trial,
              timeoutMs: decision.allocation.remainingElapsedMs,
              budgets: { ...trial.budgets,
                maximumCumulativeInputTokens: decision.allocation.remainingInputTokens,
                maximumCumulativeOutputTokens: decision.allocation.remainingOutputTokens,
              },
            },
            { ...task, input: requireString(turn.message, "conversation turn message") },
            continuationSessionId,
          );
        } catch (error) {
          if (envelopes.length === 0) throw error;
          throw new ContextEfficiencyInvalidTrialError(
            error instanceof ContextEfficiencyInvalidTrialError ? error.reason : "infrastructure_failure",
            "Conversation interrupted; prior completed turns retained and remaining settlement is unknown.",
            error instanceof ContextEfficiencyInvalidTrialError ? error.diagnostic : undefined,
            { cause: error, output: mergeConversationEnvelopes(envelopes), dispatchEvidence: "unknown" },
          );
        }
        continuationSessionId = envelope.telemetry.sessionId;
        envelopes.push(envelope);
        await checkpoint?.(mergeConversationEnvelopes(envelopes));
        if (!envelope.telemetry.sessionSucceeded || envelope.telemetry.toolCallCount !== 0
          || envelope.telemetry.managedChildCount !== 0) { stopped = true; break; }
      }
      if (envelopes.length === 0) {
        throw new ContextEfficiencyInvalidTrialError(
          "infrastructure_failure", "Conversation allocation exhausted before dispatch.", undefined,
          { dispatchEvidence: "not_dispatched" },
        );
      }
      const merged = mergeConversationEnvelopes(envelopes);
      const completed = !stopped && envelopes.length === script.turns.length;
      const output = applyTrialBudgetEvaluation(
        withTaskEvaluation({
          ...merged,
          telemetry: { ...merged.telemetry, durationMs: now() - startedAt,
            sessionSucceeded: completed && merged.telemetry.sessionSucceeded },
          diagnostics: { ...merged.diagnostics,
            lastError: completed ? merged.diagnostics.lastError : "Conversation stopped at a trial-wide tripwire." },
        }, task, repositoryRoot),
        trial,
      );
      return { output, ...(continuationSessionId ? { continuationSessionId } : {}) };
    },

    async runInternalBenchmark({ trial, task }) {
      const executionEnvelopePath = await resolveExecutionEnvelopePath(trial, task);
      const summary = await runCommand(buildInternalBenchmarkCommand({
        identity,
        trial,
        task,
        executionEnvelopePath,
      }), trial.timeoutMs);
      const summaryRecord = requireRecord(summary, "internal benchmark command output");
      const outputPath = resolve(requireString(summaryRecord.outputPath, "internal benchmark output path"));
      let projected: RunEnvelope;
      try {
        const artifact = parseJsonOutput(await readFile(outputPath, "utf8"), "internal benchmark output artifact");
        projected = projectInternalBenchmarkEnvelope(artifact);
      } catch (error) {
        throw new ContextEfficiencyInvalidTrialError(
          "collector_failure",
          "Internal benchmark artifact lacks canonical collection evidence.",
          undefined,
          { cause: error },
        );
      }
      if (!hasSettledContextEfficiencyProviderEvidence(projected.telemetry.providerRequests ?? [])) {
        throw new ContextEfficiencyInvalidTrialError("collector_failure", "Provider dispatch settlement remains unknown.", undefined,
          { output: projected, dispatchEvidence: "unknown" });
      }
      assertFrozenRunIdentity(projected, identity);
      if (hasUnsettledManagedChildInvocation(projected.oracleEvidence?.managedInvocations)) {
        throw new ContextEfficiencyInvalidTrialError(
          "collector_failure", "Managed child settlement remains unknown; halt collection.", undefined,
          { output: projected, dispatchEvidence: "unknown" },
        );
      }
      if (projected.canonicalTrialStatus !== "valid") {
        throw new ContextEfficiencyInvalidTrialError(
          "infrastructure_failure", "Canonical benchmark trial was invalid.", undefined,
          { output: projected, dispatchEvidence: projected.telemetry.providerRequests?.length ? "observed" : "not_dispatched" },
        );
      }
      const envelope = applyTrialBudgetEvaluation(withTaskEvaluation(projected, task, repositoryRoot), trial);
      return { output: envelope, continuationSessionId: envelope.telemetry.sessionId };
    },

    async cleanup() {
      if (generatedFixtureRoot) {
        await rm(generatedFixtureRoot, { recursive: true, force: true });
        generatedFixtureRoot = undefined;
        generatedFixturePaths.clear();
        executionEnvelopePaths.clear();
      }
    },
  };

  async function resolveGeneratedFixturePath(): Promise<string> {
    const key = "tool-result-generation-v1";
    const existing = generatedFixturePaths.get(key);
    if (existing) return existing;
    const fixtureManifestPath = join(
      repositoryRoot,
      "packages/core/evals/fixtures/context-efficiency-post-fix-v1/tool-result-generation.json",
    );
    const fixtureManifest = requireRecord(
      parseJsonOutput(await readFile(fixtureManifestPath, "utf8"), "generated fixture manifest"),
      "generated fixture manifest",
    );
    generatedFixtureRoot ??= await mkdtemp(join(tmpdir(), "kiln-context-efficiency-"));
    const fixturePath = join(generatedFixtureRoot, key);
    await mkdir(fixturePath, { recursive: true });
    const shardCount = requirePositiveInteger(fixtureManifest.shardCount, "generated fixture shard count");
    const linesPerShard = requirePositiveInteger(fixtureManifest.linesPerShard, "generated fixture lines per shard");
    const chunks: string[] = [];
    for (let shard = 1; shard <= shardCount; shard += 1) {
      let content = "";
      for (let line = 1; line <= linesPerShard; line += 1) {
        content += `shard-${String(shard).padStart(2, "0")}:line-${String(line).padStart(4, "0")}:${requireString(identity.toolFixtureSeed, "frozen tool fixture seed")}\n`;
      }
      chunks.push(content);
      await writeFile(join(fixturePath, `shard-${String(shard).padStart(2, "0")}.txt`), content, "utf8");
    }
    const concatenated = chunks.join("");
    const digest = `sha256:${createHash("sha256").update(concatenated).digest("hex")}`;
    generatedFixtureChecksum = digest;
    await writeFile(join(fixturePath, "manifest.json"), `${JSON.stringify({
      schemaVersion: "kiln-post-fix-tool-fixture-v1",
      shardCount, linesPerShard,
      checksumAlgorithm: "SHA-256 of UTF-8 shard contents concatenated in ascending filename order",
    }, null, 2)}\n`, "utf8");
    generatedFixturePaths.set(key, fixturePath);
    return fixturePath;
  }

  async function resolveExecutionEnvelopePath(
    trial: ContextEfficiencyScheduledTrial,
    task: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const oracle = requireRecord(task.oracle, "task oracle");
    const providerRequests = oracle.kind === "scripted_conversation_recall"
      ? 1
      : trial.budgets.maximumProviderRequests;
    const key = JSON.stringify({ timeoutMs: trial.timeoutMs, budgets: trial.budgets, providerRequests });
    const existing = executionEnvelopePaths.get(key);
    if (existing) return existing;
    generatedFixtureRoot ??= await mkdtemp(join(tmpdir(), "kiln-context-efficiency-"));
    const path = join(generatedFixtureRoot, `execution-envelope-${executionEnvelopePaths.size + 1}.json`);
    const limits = {
      providerRequests,
      toolRounds: trial.budgets.maximumToolCalls,
      toolCalls: trial.budgets.maximumToolCalls,
      cumulativeInputTokens: trial.budgets.maximumCumulativeInputTokens,
      elapsedMs: trial.timeoutMs,
      activeMs: trial.timeoutMs,
      recoveryAttempts: 1,
      consecutiveNoProgressSteps: 3,
    };
    const policyId = "kiln.context-efficiency-diagnostic.v1";
    const envelope = {
      physicalProviderRequests: providerRequests,
      convergence: {
        policyId,
        configurationHash: digestCanonicalValue({ policyId, ...limits }),
        ...limits,
      },
    };
    await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    executionEnvelopePaths.set(key, path);
    return path;
  }
}

interface RunEnvelope {
  readonly schemaVersion: "kiln.run.output.v1";
  readonly answer?: string;
  readonly oracleEvidence?: ContextEfficiencyTaskOracleEvidence;
  readonly canonicalTrialStatus?: string;
  readonly telemetry: {
    readonly sessionId: string;
    readonly sessionSucceeded: boolean;
    readonly provider?: string;
    readonly model?: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly toolCallCount: number;
    readonly managedChildCount: number;
    readonly durationMs: number;
    readonly providerRequests?: readonly Record<string, unknown>[];
    readonly readToolEvidence?: ContextEfficiencyTaskOracleEvidence["readToolEvidence"];
  };
  readonly diagnostics: {
    readonly lastError: string | null;
    readonly oraclePassed?: boolean;
    readonly authorityPassed?: boolean;
    readonly requestedAuthority?: string;
    readonly workspaceUnchanged?: boolean;
    readonly oracleReasonCodes?: readonly string[];
  };
}

export function validateContextEfficiencyRunEnvelope(value: unknown): RunEnvelope {
  if (!isRecord(value) || value.schemaVersion !== "kiln.run.output.v1") {
    throw new Error("Expected one kiln.run.output.v1 envelope.");
  }
  const telemetry = value.telemetry;
  const diagnostics = value.diagnostics;
  if (!isRecord(telemetry) || !isRecord(diagnostics)) {
    throw new Error("Run output is missing telemetry or diagnostics.");
  }
  if (typeof telemetry.sessionId !== "string"
    || typeof telemetry.sessionSucceeded !== "boolean"
    || typeof telemetry.inputTokens !== "number"
    || typeof telemetry.outputTokens !== "number"
    || typeof telemetry.toolCallCount !== "number"
    || typeof telemetry.managedChildCount !== "number"
    || typeof telemetry.durationMs !== "number") {
    throw new Error("Run output telemetry identity or totals are invalid.");
  }
  if (!Array.isArray(telemetry.providerRequests) || telemetry.providerRequests.length === 0) {
    throw new Error("Canonical provider-request observations are required for a diagnostic trial.");
  }
  for (const request of telemetry.providerRequests) {
    validateProviderRequest(request);
  }
  rejectForbiddenEvidenceKeys(value);
  return value as unknown as RunEnvelope;
}

export function collectContextEfficiencyTrials(trials: readonly ContextEfficiencyCollectedTrial[]) {
  const projectedTrials: ProjectedDiagnosticTrial[] = trials.map((trial) => {
    const validity = trial.validity ?? "valid";
    const identity = {
      taskId: trial.taskId,
      condition: trial.condition,
      repetition: trial.repetition,
      attempt: trial.attempt ?? 1,
      ...(trial.dispatchEvidence ? { dispatchEvidence: trial.dispatchEvidence } : {}),
      ...(trial.reservedMaximumProviderRequests === undefined
        ? {} : { reservedMaximumProviderRequests: trial.reservedMaximumProviderRequests }),
    };
    if (validity === "invalid") {
      return {
        ...identity,
        validity,
        invalidReason: trial.invalidReason ?? "infrastructure_failure",
        ...(trial.invalidDiagnostic ? { invalidDiagnostic: trial.invalidDiagnostic } : {}),
        ...(trial.output === undefined ? {} : {
          run: projectContentFreeRunEvidence(validateContextEfficiencyRunEnvelope(trial.output)),
        }),
      };
    }
    return {
      ...identity,
      validity,
      run: projectContentFreeRunEvidence(validateContextEfficiencyRunEnvelope(trial.output)),
    };
  });
  return {
    schemaVersion: "kiln-context-efficiency-post-fix-collection-v1" as const,
    verdict: "diagnostic-only" as const,
    trials: projectedTrials,
    cells: summarizeDiagnosticCells(projectedTrials),
  };
}

export function bindContextEfficiencyReport(
  manifest: unknown,
  trials: readonly ContextEfficiencyCollectedTrial[],
) {
  const record = requireRecord(manifest, "frozen manifest");
  const identity = readManifestIdentity(manifest);
  const design = requireRecord(record.design, "frozen design");
  const schedule = {
    entries: buildContextEfficiencySchedule(manifest).map(({ taskId, condition, repetition, budgets }) => ({
      taskId, condition, repetition, maximumProviderRequests: budgets.maximumProviderRequests,
    })),
    invalidRetryLimitPerCell: requireNonNegativeNumber(design.invalidRetriesPerCell, "invalid retry limit"),
  };
  const binding: ContextEfficiencyFrozenReportIdentity = {
    manifestSchemaVersion: requireString(record.schemaVersion, "manifest version"),
    startingCommit: requireString(identity.startingCommit, "source revision"),
    frozenManifestDigest: digestCanonicalValue(manifest),
    sourceContractDigest: requireString(identity.sourceContractDigest, "source digest"),
    inputContractDigest: requireString(identity.inputContractDigest, "input digest"),
    protocolContractDigest: requireString(identity.protocolContractDigest, "protocol digest"),
    configurationRevisionId: requireString(identity.configurationRevisionId, "configuration revision"),
    toolProjectionRecipeDigest: requireString(identity.toolProjectionRecipeDigest, "tool projection recipe digest"),
    executionIdentityDigest: digestCanonicalValue(identity),
    scheduleDigest: digestContextEfficiencySchedule(schedule),
    targetId: requireString(identity.targetId, "target identity"),
    providerId: requireString(identity.providerId, "provider identity"),
    modelId: requireString(identity.modelId, "model identity"),
    deliberationLevel: requireString(identity.deliberationLevel, "deliberation identity"),
  };
  const integrity = createContextEfficiencyReportIntegrity({
    identity: binding,
    schedule,
    attempts: trials.map((trial) => ({
      taskId: trial.taskId,
      condition: trial.condition,
      repetition: trial.repetition,
      attempt: trial.attempt ?? 1,
      validity: trial.validity ?? "valid",
      physicalRequestEvidence: trial.dispatchEvidence === "unknown" ? {
        state: "unknown" as const,
        observedPhysicalRequestCount: trial.output === undefined ? 0
          : validateContextEfficiencyRunEnvelope(trial.output).telemetry.providerRequests?.length ?? 0,
        reservedMaximumProviderRequests: requirePositiveInteger(
          trial.reservedMaximumProviderRequests, "unknown attempt reserved request allocation",
        ),
      } : trial.output !== undefined ? {
        state: "observed" as const,
        physicalRequestCount: validateContextEfficiencyRunEnvelope(trial.output).telemetry.providerRequests?.length ?? 0,
      } : trial.dispatchEvidence === "not_dispatched" ? {
        state: "observed" as const,
        physicalRequestCount: 0,
      } : {
        state: "unknown" as const,
        reservedMaximumProviderRequests: requirePositiveInteger(
          trial.reservedMaximumProviderRequests, "unknown attempt reserved request allocation",
        ),
      },
    })),
  });
  return { ...collectContextEfficiencyTrials(trials), integrity };
}

async function checkpointContextEfficiencyReport(
  outputPath: string,
  manifest: unknown,
  trials: readonly ContextEfficiencyCollectedTrial[],
): Promise<void> {
  const report = bindContextEfficiencyReport(manifest, trials);
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  const pending = `${target}.pending`;
  await writeFile(pending, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(pending, target);
}

function projectContentFreeRunEvidence(run: RunEnvelope) {
  const usage = sumContextEfficiencyObservedUsage(readPhysicalUsage([run]));
  return {
    schemaVersion: run.schemaVersion,
    telemetry: {
      sessionId: run.telemetry.sessionId,
      sessionSucceeded: run.telemetry.sessionSucceeded,
      ...(run.telemetry.provider ? { provider: run.telemetry.provider } : {}),
      ...(run.telemetry.model ? { model: run.telemetry.model } : {}),
      inputTokens: usage.kind === "observed" ? usage.inputTokens : null,
      outputTokens: usage.kind === "observed" ? usage.outputTokens : null,
      tokenUsageCompleteness: usage.kind,
      toolCallCount: run.telemetry.toolCallCount,
      managedChildCount: run.telemetry.managedChildCount,
      durationMs: run.telemetry.durationMs,
      providerRequests: (run.telemetry.providerRequests ?? []).map(projectContextEfficiencyProviderEvidence),
    },
    diagnostics: {
      failed: run.diagnostics.lastError !== null,
      oracle: run.diagnostics.oraclePassed === undefined
        ? "unknown" as const
        : run.diagnostics.oraclePassed ? "passed" as const : "failed" as const,
      ...(run.diagnostics.requestedAuthority
        ? { requestedAuthority: run.diagnostics.requestedAuthority }
        : {}),
      authority: run.diagnostics.authorityPassed === undefined
        ? "unknown" as const
        : run.diagnostics.authorityPassed ? "passed" as const : "failed" as const,
      ...(run.diagnostics.oracleReasonCodes ? { oracleReasonCodes: run.diagnostics.oracleReasonCodes } : {}),
    },
  };
}

type ContentFreeRunEvidence = ReturnType<typeof projectContentFreeRunEvidence>;

type ProjectedDiagnosticTrial = {
  readonly taskId: string;
  readonly condition: ContextEfficiencyCollectedTrial["condition"];
  readonly repetition: number;
  readonly attempt: number;
} & (
  | {
      readonly validity: "invalid";
      readonly invalidReason: ContextEfficiencyInvalidReason;
    }
  | {
      readonly validity: "valid";
      readonly run: ContentFreeRunEvidence;
    }
);

const AGGREGATE_METRIC_NAMES = [
  "inputTokens",
  "outputTokens",
  "durationMs",
  "providerRequestCount",
  "toolCallCount",
  "managedChildCount",
  "physicalRequestBytes",
  "systemBytes",
  "messageBytes",
  "toolSchemaBytes",
  "cacheReadTokens",
  "cacheWriteTokens",
  "retryCount",
  "compactionCount",
] as const;

type AggregateMetricName = typeof AGGREGATE_METRIC_NAMES[number];

function summarizeDiagnosticCells(trials: readonly ProjectedDiagnosticTrial[]) {
  const cells = new Map<string, ProjectedDiagnosticTrial[]>();
  for (const trial of trials) {
    const key = `${trial.taskId}\0${trial.condition}`;
    const existing = cells.get(key) ?? [];
    existing.push(trial);
    cells.set(key, existing);
  }
  return [...cells.values()].map((cellTrials) => {
    const first = cellTrials[0]!;
    const validTrials = cellTrials.filter((trial): trial is Extract<ProjectedDiagnosticTrial, { validity: "valid" }> =>
      trial.validity === "valid");
    const metricRows = validTrials.map((trial) => extractAggregateMetrics(trial.run));
    return {
      taskId: first.taskId,
      condition: first.condition,
      repetitionCount: new Set(cellTrials.map((trial) => trial.repetition)).size,
      attemptCount: cellTrials.length,
      sampleCount: validTrials.length,
      failureCount: validTrials.filter((trial) =>
        !trial.run.telemetry.sessionSucceeded
        || trial.run.diagnostics.failed
        || trial.run.diagnostics.oracle === "failed"
        || trial.run.diagnostics.authority === "failed").length,
      invalidCount: cellTrials.length - validTrials.length,
      unsupportedCount: 0,
      metrics: Object.fromEntries(AGGREGATE_METRIC_NAMES.map((name) => [
        name,
        summarizeMetric(metricRows.map((row) => row[name])),
      ])) as Record<AggregateMetricName, ReturnType<typeof summarizeMetric>>,
    };
  });
}

function extractAggregateMetrics(run: ContentFreeRunEvidence): Record<AggregateMetricName, number | undefined> {
  const requests = run.telemetry.providerRequests;
  return {
    inputTokens: run.telemetry.inputTokens ?? undefined,
    outputTokens: run.telemetry.outputTokens ?? undefined,
    durationMs: run.telemetry.durationMs,
    providerRequestCount: requests.length,
    toolCallCount: run.telemetry.toolCallCount,
    managedChildCount: run.telemetry.managedChildCount,
    physicalRequestBytes: sumPhysicalRegionBytes(requests),
    systemBytes: sumPhysicalRegionBytes(requests, "system"),
    messageBytes: sumPhysicalRegionBytes(requests, "messages"),
    toolSchemaBytes: sumPhysicalRegionBytes(requests, "tool_schema"),
    cacheReadTokens: sumObservedUsageTokens(requests, "cacheRead"),
    cacheWriteTokens: sumObservedUsageTokens(requests, "cacheWrite"),
    retryCount: countObservedDispatches(requests, "retry"),
    compactionCount: undefined,
  };
}

function sumPhysicalRegionBytes(
  requests: ContentFreeRunEvidence["telemetry"]["providerRequests"],
  source?: "system" | "messages" | "tool_schema",
): number | undefined {
  let total = 0;
  for (const request of requests) {
    if (!Array.isArray(request.physicalRegions)) return undefined;
    for (const rawRegion of request.physicalRegions) {
      if (!isRecord(rawRegion) || typeof rawRegion.bytes !== "number") return undefined;
      if (source === undefined || rawRegion.source === source) total += rawRegion.bytes;
    }
  }
  return total;
}

function sumObservedUsageTokens(
  requests: ContentFreeRunEvidence["telemetry"]["providerRequests"],
  field: "cacheRead" | "cacheWrite",
): number | undefined {
  let total = 0;
  for (const request of requests) {
    const usage = request.usage;
    const quantity = usage[field];
    if (quantity.measurement === "unknown") return undefined;
    total += quantity.tokens;
  }
  return total;
}

function countObservedDispatches(
  requests: ContentFreeRunEvidence["telemetry"]["providerRequests"],
  field: "retry",
): number | undefined {
  let count = 0;
  for (const request of requests) {
    const dispatch = request.dispatch;
    if (!isRecord(dispatch) || !isRecord(dispatch[field]) || dispatch[field].state !== "observed"
      || typeof dispatch[field].value !== "boolean") return undefined;
    if (dispatch[field].value) count += 1;
  }
  return count;
}

function summarizeMetric(values: readonly (number | undefined)[]) {
  const observed = values.filter((value): value is number => value !== undefined).sort((left, right) => left - right);
  if (observed.length === 0) {
    return { observedCount: 0, unknownCount: values.length, median: null, p95NearestRank: null };
  }
  const middle = Math.floor(observed.length / 2);
  const median = observed.length % 2 === 0
    ? (observed[middle - 1]! + observed[middle]!) / 2
    : observed[middle]!;
  const p95Index = Math.max(0, Math.ceil(observed.length * 0.95) - 1);
  return {
    observedCount: observed.length,
    unknownCount: values.length - observed.length,
    median,
    p95NearestRank: observed[p95Index]!,
  };
}

export function buildContextEfficiencySchedule(manifest: unknown): readonly ContextEfficiencyScheduledTrial[] {
  if (!isRecord(manifest) || manifest.schemaVersion !== "kiln-context-efficiency-post-fix-manifest-v1") {
    throw new Error("Expected the context-efficiency diagnostic v1 manifest.");
  }
  const design = manifest.design;
  if (!isRecord(design)
    || !Number.isSafeInteger(design.repetitionsPerCell)
    || !Number.isSafeInteger(design.invalidRetriesPerCell)
    || !Number.isSafeInteger(design.timeoutMs)
    || !isRecord(design.budgetsPerTrial)
    || !Array.isArray(manifest.tasks)) {
    throw new Error("Diagnostic manifest design is incomplete.");
  }
  const repetitions = design.repetitionsPerCell as number;
  const invalidRetryLimit = design.invalidRetriesPerCell as number;
  const timeoutMs = design.timeoutMs as number;
  if (repetitions < 1 || timeoutMs < 1 || (invalidRetryLimit !== 0 && invalidRetryLimit !== 1)
    || manifest.tasks.length === 0) throw new Error("Diagnostic schedule limits must be positive with at most one invalid retry per cell.");
  const budgets = readBudgets(design.budgetsPerTrial);
  const schedule: ContextEfficiencyScheduledTrial[] = [];
  const taskIds = new Set<string>();
  let cellCount = 0;
  for (const rawTask of manifest.tasks) {
    if (!isRecord(rawTask)
      || typeof rawTask.id !== "string"
      || typeof rawTask.executionStrategy !== "string"
      || !Array.isArray(rawTask.conditions)) {
      throw new Error("Diagnostic task identity or execution strategy is invalid.");
    }
    if (rawTask.id.trim().length === 0 || taskIds.has(rawTask.id)
      || rawTask.conditions.length === 0 || new Set(rawTask.conditions).size !== rawTask.conditions.length) {
      throw new Error("Diagnostic task identities and conditions must be unique and non-empty.");
    }
    taskIds.add(rawTask.id);
    cellCount += rawTask.conditions.length;
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const condition of rawTask.conditions) {
        if (condition !== "cold" && condition !== "immediate_warm" && condition !== "long_session") {
          throw new Error(`Unknown diagnostic condition '${String(condition)}'.`);
        }
        schedule.push({
          taskId: rawTask.id,
          executionStrategy: rawTask.executionStrategy,
          condition,
          repetition,
          invalidRetryLimit,
          timeoutMs,
          budgets,
        });
      }
    }
  }
  const maximumAttempts = schedule.length + cellCount * invalidRetryLimit;
  const declaredPhysicalProviderRequestCap = design.maximumPhysicalProviderRequestsForCollection;
  const maximumPhysicalProviderRequestsForCollection = declaredPhysicalProviderRequestCap === undefined
    ? maximumAttempts * budgets.maximumProviderRequests
    : declaredPhysicalProviderRequestCap;
  if (typeof maximumPhysicalProviderRequestsForCollection !== "number"
    || !Number.isSafeInteger(maximumPhysicalProviderRequestsForCollection)
    || maximumPhysicalProviderRequestsForCollection < 1
    || maximumPhysicalProviderRequestsForCollection > maximumAttempts * budgets.maximumProviderRequests) {
    throw new Error("Frozen collection physical-provider-request ceiling must be a positive allocation no greater than the schedule worst case.");
  }
  if ((design.maximumScheduledTrialsIncludingInvalidRetries !== undefined
      && design.maximumScheduledTrialsIncludingInvalidRetries !== maximumAttempts)
    || (design.maximumProviderRequestsAcrossScheduledTrials !== undefined
      && design.maximumProviderRequestsAcrossScheduledTrials !== maximumAttempts * budgets.maximumProviderRequests)) {
    throw new Error("Frozen cohort ceilings do not reconcile with its schedule and per-trial allocations.");
  }
  return schedule;
}

export async function dispatchContextEfficiencySchedule(input: {
  readonly manifest: unknown;
  readonly dispatcher: ContextEfficiencyStrategyDispatcher;
  readonly providerQuotaAuthorized: boolean;
  readonly checkpoint?: (trials: readonly ContextEfficiencyCollectedTrial[]) => Promise<void>;
  readonly verifyIdentity?: () => Promise<void>;
}): Promise<readonly ContextEfficiencyCollectedTrial[]> {
  if (!input.providerQuotaAuthorized) {
    throw new Error("Live diagnostic dispatch requires explicit provider-quota authority.");
  }
  if (!isRecord(input.manifest) || !Array.isArray(input.manifest.tasks)) {
    throw new Error("Diagnostic manifest tasks are unavailable.");
  }
  const taskById = new Map(input.manifest.tasks.map((task) => {
    if (!isRecord(task) || typeof task.id !== "string") {
      throw new Error("Diagnostic task identity is invalid.");
    }
    return [task.id, task] as const;
  }));
  const schedule = buildContextEfficiencySchedule(input.manifest);
  const collectionPhysicalProviderRequestCap = readCollectionPhysicalProviderRequestCap(input.manifest, schedule);
  const coldSessionByTaskRepeat = new Map<string, string>();
  const coldPartitionByTaskRepeat = new Map<string, string>();
  const invalidRetryUsedByCell = new Set<string>();
  const collected: ContextEfficiencyCollectedTrial[] = [];
  for (const trial of schedule) {
    const task = taskById.get(trial.taskId);
    if (!task) throw new Error(`Scheduled task '${trial.taskId}' is absent from the manifest.`);
    const pairKey = `${trial.taskId}:${trial.repetition}`;
    const cellKey = `${trial.taskId}:${trial.condition}`;
    const retryAvailable = trial.invalidRetryLimit > 0 && !invalidRetryUsedByCell.has(cellKey);
    const maximumAttempts = retryAvailable ? 2 : 1;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const observedPhysicalProviderRequests = countSettledPhysicalProviderRequests(collected);
      if (observedPhysicalProviderRequests === undefined
        || observedPhysicalProviderRequests + trial.budgets.maximumProviderRequests > collectionPhysicalProviderRequestCap) {
        await input.checkpoint?.([...collected]);
        return collected;
      }
      await input.verifyIdentity?.();
      let result: ContextEfficiencyStrategyResult | undefined;
      // Reserve before dispatch. A killed collector leaves a conservative
      // unknown attempt on disk, never a report that appears not to have run.
      await input.checkpoint?.([...collected, {
        taskId: trial.taskId, condition: trial.condition, repetition: trial.repetition,
        attempt, validity: "invalid", invalidReason: "infrastructure_failure",
        dispatchEvidence: "unknown", reservedMaximumProviderRequests: trial.budgets.maximumProviderRequests,
      }]);
      try {
        if (trial.executionStrategy === "cli_run" || trial.executionStrategy === "cli_run_generated_fixture") {
          const continuationSessionId = trial.condition === "immediate_warm"
            ? coldSessionByTaskRepeat.get(pairKey)
            : undefined;
          if (trial.condition === "immediate_warm" && !continuationSessionId) {
            throw new ContextEfficiencyInvalidTrialError(
              "canonical_transcript_unavailable",
              `Warm trial '${pairKey}' has no completed cold-session identity.`,
              undefined,
              { dispatchEvidence: "not_dispatched" },
            );
          }
          result = await input.dispatcher.runCli({ trial, task, ...(continuationSessionId ? { continuationSessionId } : {}) });
        } else if (trial.executionStrategy === "cli_continuation") {
          result = await input.dispatcher.runConversation({ trial, task,
            checkpoint: async (output) => input.checkpoint?.([...collected, {
              taskId: trial.taskId, condition: trial.condition, repetition: trial.repetition,
              attempt, validity: "invalid", invalidReason: "infrastructure_failure",
              dispatchEvidence: "unknown", reservedMaximumProviderRequests: trial.budgets.maximumProviderRequests,
              output,
            }]),
          });
        } else if (trial.executionStrategy.startsWith("internal_benchmark")) {
          result = await input.dispatcher.runInternalBenchmark({ trial, task });
        } else {
          throw new Error(`Unsupported diagnostic execution strategy '${trial.executionStrategy}'.`);
        }
        try {
          await input.verifyIdentity?.();
        } catch (cause) {
          throw new ContextEfficiencyInvalidTrialError("collector_failure", "Frozen identity changed during dispatch.", undefined,
            { cause, output: result.output, dispatchEvidence: "unknown" });
        }
        if (trial.condition === "cold") {
          if (!result.continuationSessionId) {
            throw new Error(`Cold CLI trial '${pairKey}' did not return a continuation session identity.`);
          }
          coldSessionByTaskRepeat.set(pairKey, result.continuationSessionId);
          coldPartitionByTaskRepeat.set(pairKey, readCachePartitionSignature(result.output));
        } else if (trial.condition === "immediate_warm") {
          const coldPartition = coldPartitionByTaskRepeat.get(pairKey);
          const warmPartition = readCachePartitionSignature(result.output);
          if (!coldPartition || coldPartition !== warmPartition) {
            throw new ContextEfficiencyInvalidTrialError(
              "collector_failure",
              `Warm trial '${pairKey}' did not preserve the cold trial's observed cache partition.`,
            );
          }
        }
        collected.push({
          taskId: trial.taskId,
          condition: trial.condition,
          repetition: trial.repetition,
          attempt,
          validity: "valid",
          output: result.output,
          dispatchEvidence: "observed",
        });
      } catch (caught) {
        let error = caught;
        try {
          await input.verifyIdentity?.();
        } catch (cause) {
          error = new ContextEfficiencyInvalidTrialError("collector_failure", "Frozen identity changed around failed dispatch.", undefined,
            { cause, output: result?.output ?? (caught instanceof ContextEfficiencyInvalidTrialError ? caught.output : undefined), dispatchEvidence: "unknown" });
        }
        const observedOutput = result?.output
          ?? (error instanceof ContextEfficiencyInvalidTrialError ? error.output : undefined);
        const dispatchEvidence = error instanceof ContextEfficiencyInvalidTrialError ? error.dispatchEvidence
          : result !== undefined ? "observed" : "unknown";
        collected.push({
          taskId: trial.taskId,
          condition: trial.condition,
          repetition: trial.repetition,
          attempt,
          validity: "invalid",
          invalidReason: error instanceof ContextEfficiencyInvalidTrialError
            ? error.reason
            : "infrastructure_failure",
          ...(error instanceof ContextEfficiencyInvalidTrialError && error.diagnostic
            ? { invalidDiagnostic: error.diagnostic }
            : {}),
          dispatchEvidence,
          ...(observedOutput === undefined ? {} : { output: observedOutput }),
          ...(dispatchEvidence === "unknown"
            ? { reservedMaximumProviderRequests: trial.budgets.maximumProviderRequests }
            : {}),
        });
        // A missing terminal envelope cannot prove that no provider attempt or
        // child is still running. Preserve the row and halt instead of retrying.
        if (dispatchEvidence === "unknown") {
          await input.checkpoint?.([...collected]);
          return collected;
        }
        if (attempt === 1 && retryAvailable) invalidRetryUsedByCell.add(cellKey);
      }
      // Persistence failures must escape; they are not failed model attempts.
      await input.checkpoint?.([...collected]);
      if (collected.at(-1)?.validity === "valid") break;
    }
  }
  return collected;
}

function readCollectionPhysicalProviderRequestCap(
  manifest: unknown,
  schedule: readonly ContextEfficiencyScheduledTrial[],
): number {
  const design = isRecord(manifest) && isRecord(manifest.design) ? manifest.design : undefined;
  if (!design || schedule.length === 0) throw new Error("Frozen collection design is unavailable.");
  const maximumAttempts = schedule.length
    + new Set(schedule.map((trial) => `${trial.taskId}\0${trial.condition}`)).size * schedule[0]!.invalidRetryLimit;
  const scheduleWorstCase = maximumAttempts * schedule[0]!.budgets.maximumProviderRequests;
  const declaredCap = design.maximumPhysicalProviderRequestsForCollection;
  const cap = declaredCap === undefined ? scheduleWorstCase : declaredCap;
  if (typeof cap !== "number" || !Number.isSafeInteger(cap) || cap < 1 || cap > scheduleWorstCase) {
    throw new Error("Frozen collection physical-provider-request ceiling is invalid.");
  }
  return cap;
}

/**
 * Counts every retained settled physical request, including a failed attempt's
 * parent and managed-child observations. Duplicate or unsettled evidence is
 * not safe to budget around and therefore stops the cohort before dispatch.
 */
function countSettledPhysicalProviderRequests(
  trials: readonly ContextEfficiencyCollectedTrial[],
): number | undefined {
  const physicalRequestIds = new Set<string>();
  for (const trial of trials) {
    if (trial.output === undefined) continue;
    let run: RunEnvelope;
    try {
      run = validateContextEfficiencyRunEnvelope(trial.output);
    } catch {
      return undefined;
    }
    const requests = run.telemetry.providerRequests ?? [];
    if (!hasSettledContextEfficiencyProviderEvidence(requests)) return undefined;
    for (const request of requests) {
      let projected;
      try {
        projected = projectContextEfficiencyProviderEvidence(request);
      } catch {
        return undefined;
      }
      const attempt = projected.dispatch.attempt;
      if (attempt.state !== "observed") return undefined;
      const lineage = projected.managedInvocation;
      const physicalRequestId = JSON.stringify([
        trial.taskId,
        trial.condition,
        trial.repetition,
        trial.attempt ?? 1,
        run.telemetry.sessionId,
        projected.collectorTurnIndex ?? 0,
        lineage?.invocationId ?? "parent",
        lineage?.childSessionId ?? null,
        lineage?.childTurnId ?? null,
        projected.requestIndex,
        attempt.value,
      ]);
      if (physicalRequestIds.has(physicalRequestId)) return undefined;
      physicalRequestIds.add(physicalRequestId);
    }
  }
  return physicalRequestIds.size;
}

function readCachePartitionSignature(output: unknown): string {
  const run = validateContextEfficiencyRunEnvelope(output);
  const observations = (run.telemetry.providerRequests ?? []).map((rawRequest) =>
    requireRecord(rawRequest, "provider-request observation"));
  const lineageIndexes = new Map<string, number>();
  const partitionHashesByLineage = new Map<string, Set<string>>();
  for (const observation of observations) {
    const managedInvocation = observation.managedInvocation === undefined
      ? undefined
      : requireRecord(observation.managedInvocation, "managed provider-request lineage");
    const lineageIdentity = managedInvocation === undefined
      ? "top-level"
      : [
          managedInvocation.invocationId,
          managedInvocation.childSessionId,
          managedInvocation.childTurnId,
        ].map(String).join(":");
    let lineage = "top-level";
    if (managedInvocation !== undefined) {
      let lineageIndex = lineageIndexes.get(lineageIdentity);
      if (lineageIndex === undefined) {
        lineageIndex = lineageIndexes.size;
        lineageIndexes.set(lineageIdentity, lineageIndex);
      }
      lineage = `managed-child:${lineageIndex}`;
    }
    const cache = requireRecord(observation.cache, "provider-request cache evidence");
    const identity = requireRecord(cache.partitionIdentity, "provider-request cache partition identity");
    if (identity.state !== "observed" || typeof identity.hash !== "string") {
      throw new ContextEfficiencyInvalidTrialError(
        "collector_failure",
        "Cold/warm comparison requires an observed cache-partition identity.",
      );
    }
    const hashes = partitionHashesByLineage.get(lineage) ?? new Set<string>();
    hashes.add(identity.hash);
    partitionHashesByLineage.set(lineage, hashes);
  }
  if (partitionHashesByLineage.size === 0) {
    throw new ContextEfficiencyInvalidTrialError(
      "collector_failure",
      "Cold/warm comparison requires at least one provider-request observation.",
    );
  }
  return digestCanonicalValue(
    [...partitionHashesByLineage.entries()].map(([lineage, hashes]) => ({
      lineage,
      hashes: [...hashes].sort(),
    })),
  );
}

export async function dispatchContextEfficiencyPredispatchProbe(input: {
  readonly manifest: unknown;
  readonly dispatcher: ContextEfficiencyStrategyDispatcher;
  readonly providerQuotaAuthorized: boolean;
}): Promise<readonly ContextEfficiencyCollectedTrial[]> {
  if (!isRecord(input.manifest) || !Array.isArray(input.manifest.tasks) || !isRecord(input.manifest.design)) {
    throw new Error("Diagnostic probe requires the frozen manifest.");
  }
  const task = input.manifest.tasks.find((candidate) => isRecord(candidate) && candidate.id === "trivial_exact");
  if (!isRecord(task)) throw new Error("Diagnostic probe requires the frozen trivial_exact task.");
  const budgets = requireRecord(input.manifest.design.budgetsPerTrial, "diagnostic probe budgets");
  const probeManifest = {
    ...input.manifest,
    design: {
      ...input.manifest.design,
      repetitionsPerCell: 1,
      invalidRetriesPerCell: 0,
      maximumScheduledTrialsIncludingInvalidRetries: 1,
      maximumProviderRequestsAcrossScheduledTrials: 1,
      maximumPhysicalProviderRequestsForCollection: 1,
      budgetsPerTrial: { ...budgets, maximumProviderRequests: 1 },
    },
    tasks: [{ ...task, conditions: ["cold"] }],
  };
  return dispatchContextEfficiencySchedule({
    manifest: probeManifest,
    dispatcher: input.dispatcher,
    providerQuotaAuthorized: input.providerQuotaAuthorized,
  });
}

function validateProviderRequest(value: unknown): void {
  if (!isRecord(value)
    || value.version !== "v1"
    || typeof value.requestIndex !== "number"
    || typeof value.providerId !== "string"
    || typeof value.modelId !== "string"
    || !isRecord(value.deliberation)
    || !isRecord(value.authority)
    || !isRecord(value.dispatch)
    || !isRecord(value.usage)
    || !Array.isArray(value.physicalRegions)
    || !isRecord(value.reconciliation)
    || !isRecord(value.capacity)
    || !isRecord(value.cache)) {
    throw new Error("Provider-request observation is incomplete.");
  }
}

function assertFrozenRunIdentity(
  run: RunEnvelope,
  identity: Readonly<Record<string, unknown>>,
): void {
  const expectedProvider = requireString(identity.providerId, "frozen provider identity");
  const expectedModel = requireString(identity.modelId, "frozen model identity");
  const expectedDeliberation = requireString(identity.deliberationLevel, "frozen deliberation level");
  if ((run.telemetry.provider !== undefined && run.telemetry.provider !== expectedProvider)
    || (run.telemetry.model !== undefined && run.telemetry.model !== expectedModel)) {
    throw new ContextEfficiencyInvalidTrialError(
      "route_identity_mismatch",
      "Diagnostic run route differs from the frozen provider/model identity.",
      undefined,
      { output: run, dispatchEvidence: "observed" },
    );
  }
  for (const rawRequest of run.telemetry.providerRequests ?? []) {
    const request = requireRecord(rawRequest, "provider-request observation");
    if (request.providerId !== expectedProvider || request.modelId !== expectedModel) {
      throw new ContextEfficiencyInvalidTrialError(
        "route_identity_mismatch",
        "Provider-request observation differs from the frozen provider/model identity.",
        undefined,
        { output: run, dispatchEvidence: "observed" },
      );
    }
    const deliberation = requireRecord(request.deliberation, "provider-request deliberation evidence");
    if (deliberation.state !== "observed" || deliberation.selectedLevel !== expectedDeliberation) {
      throw new ContextEfficiencyInvalidTrialError(
        "route_identity_mismatch",
        "Provider-request observation differs from the frozen deliberation identity.",
        undefined,
        { output: run, dispatchEvidence: "observed" },
      );
    }
    const dispatch = requireRecord(request.dispatch, "provider-request dispatch evidence");
    const fallback = requireRecord(dispatch.fallback, "provider-request fallback evidence");
    if (fallback.state === "observed" && fallback.value === true) {
      throw new ContextEfficiencyInvalidTrialError(
        "route_identity_mismatch",
        "Fixed-route diagnostic trial observed provider fallback.",
        undefined,
        { output: run, dispatchEvidence: "observed" },
      );
    }
  }
}

function rejectForbiddenEvidenceKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectForbiddenEvidenceKeys);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_EVIDENCE_KEYS.has(key)) {
      throw new Error(`Forbidden private correlation field '${key}' reached diagnostic evidence.`);
    }
    rejectForbiddenEvidenceKeys(child);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function parseJsonOutput(value: string, label: string): unknown {
  try {
    return JSON.parse(value.trim()) as unknown;
  } catch (error) {
    throw new Error(`${label} did not produce valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readManifestIdentity(manifest: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(manifest) || manifest.schemaVersion !== "kiln-context-efficiency-post-fix-manifest-v1") {
    throw new Error("Expected the context-efficiency diagnostic v1 manifest.");
  }
  return requireRecord(manifest.identity, "diagnostic manifest identity");
}

export function verifyContextEfficiencySourceContract(input: {
  readonly repositoryRoot: string;
  readonly manifest: unknown;
  readonly headCommit: string;
  readonly bunVersion: string;
  readonly configurationRevisionId: string;
}): void {
  const repositoryRoot = resolve(input.repositoryRoot);
  const identity = readManifestIdentity(input.manifest);
  if (input.headCommit.trim() !== requireString(identity.startingCommit, "frozen starting commit")) {
    throw new Error("Current HEAD differs from the frozen diagnostic starting commit.");
  }
  if (input.bunVersion.trim() !== requireString(identity.bunVersion, "frozen Bun version")) {
    throw new Error("Current Bun version differs from the frozen diagnostic identity.");
  }
  if (input.configurationRevisionId.trim()
    !== requireString(identity.configurationRevisionId, "frozen configuration revision")) {
    throw new Error(
      `Current configuration revision differs from the frozen diagnostic identity: expected ${String(identity.configurationRevisionId)}, observed ${input.configurationRevisionId.trim()}.`,
    );
  }
  const sourceContractPaths = readStringArray(identity.sourceContractPaths, "frozen source-contract paths");
  const missingRequiredPaths = REQUIRED_SOURCE_CONTRACT_PATHS.filter((path) => !sourceContractPaths.includes(path));
  if (missingRequiredPaths.length > 0) {
    throw new Error(`Frozen source contract is incomplete; missing: ${missingRequiredPaths.join(", ")}.`);
  }
  verifyFileContract({
    repositoryRoot,
    rawPaths: sourceContractPaths,
    expectedDigest: identity.sourceContractDigest,
    label: "source",
  });
  verifyFileContract({
    repositoryRoot,
    rawPaths: identity.inputContractPaths,
    expectedDigest: identity.inputContractDigest,
    label: "input",
  });
  verifyFileContract({ repositoryRoot, rawPaths: identity.compiledContractPaths,
    expectedDigest: identity.compiledContractDigest, label: "compiled" });
  const observedProtocolDigest = digestContextEfficiencyProtocol(input.manifest);
  const expectedProtocolDigest = requireString(identity.protocolContractDigest, "frozen protocol-contract digest");
  if (observedProtocolDigest !== expectedProtocolDigest) {
    throw new Error(
      `Current diagnostic protocol differs from the frozen protocol contract: expected ${expectedProtocolDigest}, observed ${observedProtocolDigest}.`,
    );
  }
}

function verifyFileContract(input: {
  readonly repositoryRoot: string;
  readonly rawPaths: unknown;
  readonly expectedDigest: unknown;
  readonly label: "source" | "input" | "compiled";
}): void {
  const observedDigest = computeContextEfficiencyFileContract(input);
  const expectedDigest = requireString(input.expectedDigest, `frozen ${input.label}-contract digest`);
  if (observedDigest !== expectedDigest) {
    throw new Error(
      `Current ${input.label} files differ from the frozen ${input.label} contract: expected ${expectedDigest}, observed ${observedDigest}.`,
    );
  }
}

function computeContextEfficiencyFileContract(input: {
  readonly repositoryRoot: string;
  readonly rawPaths: unknown;
  readonly label: "source" | "input" | "compiled";
}): string {
  const rawPaths = input.rawPaths;
  if (!Array.isArray(rawPaths) || rawPaths.length === 0 || rawPaths.some((path) => typeof path !== "string")) {
    throw new Error(`Frozen ${input.label}-contract paths must be a non-empty string array.`);
  }
  const paths = rawPaths as readonly string[];
  if (new Set(paths).size !== paths.length) throw new Error(`Frozen ${input.label}-contract paths contain duplicates.`);
  const rows = [...paths].sort().map((path) => {
    const target = resolve(input.repositoryRoot, path);
    const targetRelative = relative(input.repositoryRoot, target);
    if (isAbsolute(path) || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
      throw new Error(`Frozen ${input.label}-contract path '${path}' escapes the repository root.`);
    }
    const content = readFileSync(target);
    const blobId = createHash("sha1")
      .update(`blob ${content.byteLength}\0`, "utf8")
      .update(content)
      .digest("hex");
    return `${path} ${blobId}`;
  });
  return `sha256:${createHash("sha256").update(rows.join("\n"), "utf8").digest("hex")}`;
}

function applyTrialBudgetEvaluation(
  run: RunEnvelope,
  trial: ContextEfficiencyScheduledTrial,
): RunEnvelope {
  const usage = sumContextEfficiencyObservedUsage(readPhysicalUsage([run]));
  const failures = [
    usage.kind === "unknown" ? "physical-request token usage unknown" : undefined,
    run.telemetry.providerRequests!.length > trial.budgets.maximumProviderRequests
      ? `provider requests ${run.telemetry.providerRequests!.length}/${trial.budgets.maximumProviderRequests}`
      : undefined,
    run.telemetry.toolCallCount > trial.budgets.maximumToolCalls
      ? `tool calls ${run.telemetry.toolCallCount}/${trial.budgets.maximumToolCalls}`
      : undefined,
    run.telemetry.managedChildCount > trial.budgets.maximumManagedChildren
      ? `managed children ${run.telemetry.managedChildCount}/${trial.budgets.maximumManagedChildren}`
      : undefined,
    usage.kind === "observed" && usage.inputTokens > trial.budgets.maximumCumulativeInputTokens
      ? `input tokens ${usage.inputTokens}/${trial.budgets.maximumCumulativeInputTokens}`
      : undefined,
    usage.kind === "observed" && usage.outputTokens > trial.budgets.maximumCumulativeOutputTokens
      ? `output tokens ${usage.outputTokens}/${trial.budgets.maximumCumulativeOutputTokens}`
      : undefined,
  ].filter((failure): failure is string => failure !== undefined);
  if (failures.length === 0) return run;
  return {
    ...run,
    telemetry: { ...run.telemetry, sessionSucceeded: false },
    diagnostics: {
      ...run.diagnostics,
      lastError: `Diagnostic trial exceeded its frozen budget: ${failures.join(", ")}.`,
      oraclePassed: false,
    },
  };
}

function withTaskEvaluation(
  run: RunEnvelope,
  task: Readonly<Record<string, unknown>>,
  repositoryRoot: string,
): RunEnvelope {
  const oracle = requireRecord(task.oracle, "task oracle");
  const kind = requireString(oracle.kind, "task oracle kind");
  const answer = run.answer ?? "";
  const requestedAuthority = requireString(task.authority, "task authority");
  const expectedRuntimeAuthority = requireString(task.expectedRuntimeAuthority, "expected Runtime authority");
  const authorityPassed = (run.telemetry.providerRequests ?? []).every((rawRequest) => {
    const request = requireRecord(rawRequest, "provider-request observation");
    const authority = requireRecord(request.authority, "provider-request authority evidence");
    return authority.state === "observed"
      && authority.requestedAuthority === requestedAuthority
      && authority.completeness === "authoritative"
      && authority.admittedAuthority === expectedRuntimeAuthority;
  });
  let oraclePassed: boolean;
  let oracleReasonCodes: readonly string[];
  if (kind === "scripted_conversation_recall") {
      const scriptPath = requireString(oracle.scriptFixture, "conversation script fixture");
      const script = requireRecord(
        JSON.parse(readFileSync(resolve(repositoryRoot, scriptPath), "utf8")) as unknown,
        "conversation script fixture",
      );
      oraclePassed = run.telemetry.toolCallCount === 0 && run.telemetry.managedChildCount === 0
        && answer.includes(requireString(script.finalNonce, "conversation final nonce"))
        && readStringArray(script.requiredFinalTerms, "conversation required final terms")
          .every((term) => answer.includes(term));
      oracleReasonCodes = oraclePassed ? [] : ["conversation_obligation_failed"];
  } else {
    const evaluation = evaluateContextEfficiencyTaskOracle({ answer, oracle, evidence: {
      ...run.oracleEvidence,
      toolCallCount: run.telemetry.toolCallCount,
      ...(run.diagnostics.workspaceUnchanged === undefined ? {} : { workspaceUnchanged: run.diagnostics.workspaceUnchanged }),
      ...(run.telemetry.readToolEvidence === undefined ? {} : { readToolEvidence: run.telemetry.readToolEvidence }),
    } });
    const admissionPassed = kind !== "fixture_test_and_allowed_diff" && kind !== "managed_child_settlement"
      || run.diagnostics.oraclePassed === true;
    oraclePassed = evaluation.passed && admissionPassed;
    oracleReasonCodes = admissionPassed ? evaluation.reasonCodes : [...evaluation.reasonCodes, "canonical_admission_failed"];
  }
  return {
    ...run,
    diagnostics: {
      ...run.diagnostics,
      oraclePassed,
      oracleReasonCodes,
      authorityPassed,
      requestedAuthority,
    },
  };
}

function mergeConversationEnvelopes(envelopes: readonly RunEnvelope[]): RunEnvelope {
  const final = envelopes.at(-1);
  if (!final) throw new Error("Conversation execution produced no run envelopes.");
  return {
    schemaVersion: "kiln.run.output.v1",
    ...(final.answer === undefined ? {} : { answer: final.answer }),
    telemetry: {
      sessionId: final.telemetry.sessionId,
      sessionSucceeded: envelopes.every((entry) => entry.telemetry.sessionSucceeded),
      ...(final.telemetry.provider ? { provider: final.telemetry.provider } : {}),
      ...(final.telemetry.model ? { model: final.telemetry.model } : {}),
      inputTokens: envelopes.reduce((total, entry) => total + entry.telemetry.inputTokens, 0),
      outputTokens: envelopes.reduce((total, entry) => total + entry.telemetry.outputTokens, 0),
      toolCallCount: envelopes.reduce((total, entry) => total + entry.telemetry.toolCallCount, 0),
      managedChildCount: envelopes.reduce((total, entry) => total + entry.telemetry.managedChildCount, 0),
      durationMs: envelopes.reduce((total, entry) => total + entry.telemetry.durationMs, 0),
      providerRequests: envelopes.flatMap((entry, collectorTurnIndex) =>
        (entry.telemetry.providerRequests ?? []).map((request) => ({ ...request, collectorTurnIndex }))),
    },
    diagnostics: {
      lastError: [...envelopes].reverse().find((entry) => entry.diagnostics.lastError !== null)?.diagnostics.lastError ?? null,
    },
  };
}

function readPhysicalUsage(envelopes: readonly RunEnvelope[]): readonly ContextEfficiencyPhysicalRequestUsage[] {
  return envelopes.flatMap((envelope, envelopeIndex) =>
    (envelope.telemetry.providerRequests ?? []).map((request) => {
      const dispatch = isRecord(request.dispatch) ? request.dispatch : undefined;
      const attempt = isRecord(dispatch?.attempt) ? dispatch.attempt : undefined;
      const lineage = isRecord(request.managedInvocation) ? request.managedInvocation : undefined;
      const usage = isRecord(request.usage) ? request.usage : undefined;
      const input = isRecord(usage?.input) ? usage.input : undefined;
      const output = isRecord(usage?.output) ? usage.output : undefined;
      const attemptKnown = attempt?.state === "observed" && Number.isSafeInteger(attempt.value);
      return {
        requestId: JSON.stringify([
          envelope.telemetry.sessionId, request.collectorTurnIndex ?? envelopeIndex,
          lineage?.invocationId ?? "parent", lineage?.childSessionId, lineage?.childTurnId,
          request.requestIndex, attemptKnown ? attempt.value : "unknown",
        ]),
        inputTokens: attemptKnown && input?.measurement === "provider_reported" && typeof input.tokens === "number"
          ? input.tokens : "unknown",
        outputTokens: attemptKnown && output?.measurement === "provider_reported" && typeof output.tokens === "number"
          ? output.tokens : "unknown",
      };
    }));
}

function projectInternalBenchmarkEnvelope(value: unknown): RunEnvelope {
  const artifact = requireRecord(value, "internal benchmark artifact");
  const run = requireRecord(requireArrayItem(artifact.runs, 0, "internal benchmark runs"), "internal benchmark run");
  const consistency = requireRecord(run.consistency, "internal benchmark consistency");
  const experiment = requireRecord(requireArrayItem(consistency.runs, 0, "internal benchmark experiments"), "internal benchmark experiment");
  const result = requireRecord(requireArrayItem(experiment.results, 0, "internal benchmark results"), "internal benchmark result");
  const metadata = requireRecord(result.metadata, "internal benchmark result metadata");
  const tokenUsage = requireRecord(result.tokenUsage, "internal benchmark token usage");
  const trial = requireRecord(result.trial, "internal benchmark trial");
  // Trial validity admits the row to the denominator. The canonical
  // consistency result, computed from admission scorers, owns task success.
  const itemOutcome = Array.isArray(consistency.itemResults)
    ? consistency.itemResults.find((entry) => isRecord(entry) && entry.itemId === result.itemId)
    : undefined;
  const oraclePassed = trial.status === "valid"
    && consistency.k === 1
    && typeof result.itemId === "string"
    && isRecord(itemOutcome)
    && itemOutcome.totalRuns === 1
    && itemOutcome.invalidTrialCount === 0
    && itemOutcome.passCount === 1
    && itemOutcome.allPassed === true;
  const providerRequests = metadata.providerRequestObservations;
  if (!Array.isArray(providerRequests)) {
    throw new Error("Internal benchmark result lacks canonical provider-request observations.");
  }
  const toolCalls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls.length : 0;
  const managedChildCount = Array.isArray(metadata.toolCalls)
    ? metadata.toolCalls.filter((entry) => isRecord(entry)
      && (entry.name === "managed_agent.invoke" || entry.name === "managed_agent.start")).length
    : 0;
  const envelope = validateContextEfficiencyRunEnvelope({
    schemaVersion: "kiln.run.output.v1",
    ...(typeof result.output === "string" ? { answer: result.output } : {}),
    telemetry: {
      sessionId: requireString(metadata.sessionId, "internal benchmark session identity"),
      sessionSucceeded: metadata.sessionSucceeded === true,
      ...(typeof metadata.providerId === "string" ? { provider: metadata.providerId } : {}),
      ...(typeof metadata.modelId === "string" ? { model: metadata.modelId } : {}),
      inputTokens: requireNonNegativeNumber(tokenUsage.inputTokens, "internal benchmark input tokens"),
      outputTokens: requireNonNegativeNumber(tokenUsage.outputTokens, "internal benchmark output tokens"),
      toolCallCount: toolCalls,
      managedChildCount,
      durationMs: requireNonNegativeNumber(result.durationMs, "internal benchmark duration"),
      providerRequests,
    },
    diagnostics: {
      lastError: trial.status === "valid" && metadata.sessionSucceeded === true
        ? null
        : typeof trial.reason === "string" ? trial.reason : "internal benchmark trial failed",
      oraclePassed,
    },
  });
  return { ...envelope, canonicalTrialStatus: requireString(trial.status, "canonical trial status"), oracleEvidence: {
    ...(Array.isArray(metadata.managedInvocations) ? { managedInvocations: metadata.managedInvocations } : {}),
    workspaceChanges: metadata.workspaceChanges,
    observedVerification: metadata.observedVerification,
  } };
}

function requireArrayItem(value: unknown, index: number, label: string): unknown {
  if (!Array.isArray(value) || value[index] === undefined) throw new Error(`${label} is missing item ${index}.`);
  return value[index];
}

function readStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value as readonly string[];
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function readBudgets(value: Record<string, unknown>): ContextEfficiencyScheduledTrial["budgets"] {
  const keys = [
    "maximumProviderRequests",
    "maximumToolCalls",
    "maximumManagedChildren",
    "maximumCumulativeInputTokens",
    "maximumCumulativeOutputTokens",
  ] as const;
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) <= 0) {
      throw new Error(`Diagnostic budget '${key}' must be a positive safe integer.`);
    }
  }
  return {
    maximumProviderRequests: value.maximumProviderRequests as number,
    maximumToolCalls: value.maximumToolCalls as number,
    maximumManagedChildren: value.maximumManagedChildren as number,
    maximumCumulativeInputTokens: value.maximumCumulativeInputTokens as number,
    maximumCumulativeOutputTokens: value.maximumCumulativeOutputTokens as number,
  };
}

async function main(args: readonly string[]): Promise<void> {
  if (args[0] === "freeze") {
    const repositoryRoot = resolve(readFlag(args, "--repository-root"));
    const outputPath = resolve(readFlag(args, "--output"));
    assertPrivateBenchmarkPath(repositoryRoot, outputPath);
    await verifyCommittedContextEfficiencyCheckout({ repositoryRoot });
    const template = requireRecord(JSON.parse(await readFile(resolve(readFlag(args, "--manifest")), "utf8")), "preregistered protocol");
    const templateIdentity = requireRecord(template.identity, "preregistered identity");
    buildContextEfficiencySchedule(template);
    const runner = createBunContextEfficiencyCommandRunner();
    const compiledPackages = ["operator-appearance", "gateway-contracts", "tools", "core", "runtime", "sdk", "cli", "tui"];
    for (const packageName of compiledPackages) {
      const outputDirectory = resolve(repositoryRoot, "packages", packageName, "dist");
      if (relative(resolve(repositoryRoot, "packages"), outputDirectory) !== `${packageName}${process.platform === "win32" ? "\\" : "/"}dist`) {
        throw new Error("Compiled output escaped the owning package.");
      }
      await rm(outputDirectory, { recursive: true, force: true });
    }
    const compilation = await runner.run({ command: ["bun", "run", "compile", "--force"],
      cwd: repositoryRoot, timeoutMs: 120_000 });
    if (compilation.exitCode !== 0) throw new Error("Source compilation failed; cannot freeze executable artifacts.");
    const head = await runner.run({ command: ["git", "rev-parse", "HEAD"], cwd: repositoryRoot, timeoutMs: 10_000 });
    const tracked = await runner.run({ command: ["git", "ls-files", "-z"], cwd: repositoryRoot, timeoutMs: 10_000 });
    if (head.exitCode !== 0 || tracked.exitCode !== 0) throw new Error("Unable to freeze committed source identity.");
    const sourceContractPaths = tracked.stdout.split("\0").filter(Boolean).sort();
    const compiledContractPaths = readdirSync(join(repositoryRoot, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && compiledPackages.includes(entry.name) && existsSync(join(repositoryRoot, "packages", entry.name, "dist")))
      .flatMap((entry) => {
        const root = join(repositoryRoot, "packages", entry.name, "dist");
        return readdirSync(root, { recursive: true, withFileTypes: true }).filter((file) => file.isFile())
          .map((file) => relative(repositoryRoot, join(file.parentPath, file.name)).replaceAll("\\", "/"));
      }).sort();
    const inputContractPaths = readStringArray(templateIdentity.inputContractPaths, "preregistered input paths");
    if (inputContractPaths.some((path) => !sourceContractPaths.includes(path))) throw new Error("All benchmark inputs must be committed.");
    const accountUsage = await createAccountUsageInspectionService().inspect();
    const authority = readGlobalExecutionTargetAuthority(readGlobalConfig());
    const target = authority?.executionCatalog.targets.find((entry) => entry.id === templateIdentity.targetId);
    const policy = authority?.executionCatalog.accountPolicies?.find((entry) => entry.id === target?.accountPolicyId);
    if (!target || !policy) throw new Error("Proposed target lacks a canonical account policy.");
    const allowedAccountIds = [...policy.accountIds].sort();
    const configurationRevisionId = readRuntimeConfigurationRevision(repositoryRoot).revisionSetId;
    const sourceContractDigest = computeContextEfficiencyFileContract({ repositoryRoot, rawPaths: sourceContractPaths, label: "source" });
    const observedAt = accountUsage.evidence.observedAt;
    const processor = cpus();
    const frozen = freezeContextEfficiencyProtocol({ template, execution: {
      startingCommit: head.stdout.trim(), sourceContractPaths, sourceContractDigest,
      compiledContractPaths,
      compiledContractDigest: computeContextEfficiencyFileContract({ repositoryRoot, rawPaths: compiledContractPaths, label: "compiled" }),
      inputContractPaths,
      inputContractDigest: computeContextEfficiencyFileContract({ repositoryRoot, rawPaths: inputContractPaths, label: "input" }),
      configurationRevisionId, bunVersion: process.versions.bun ?? "unknown", toolFixtureSeed: randomUUID(),
      toolProjectionRecipeDigest: digestCanonicalValue({ sourceContractDigest, configurationRevisionId,
        mcp: templateIdentity.mcp, tasks: template.tasks }),
      runtime: {
        targetId: requireString(templateIdentity.targetId, "preregistered target"),
        providerId: requireString(templateIdentity.providerId, "preregistered provider"),
        modelId: requireString(templateIdentity.modelId, "preregistered model"),
        deliberationLevel: requireString(templateIdentity.deliberationLevel, "preregistered deliberation"),
        fallback: "disabled", mcp: "disabled_by_strategy", concurrency: 1,
      },
      plusAccountPolicy: { plan: "plus", evidenceState: "fresh", allowedAccountIds, observedAt,
        expiresAt: new Date(Date.parse(observedAt) + 60_000).toISOString(),
        source: "provider-endpoint", confidence: "authoritative" },
      hardware: { platform: process.platform, architecture: process.arch,
        cpuModel: processor[0]?.model ?? "unknown", logicalCpuCount: processor.length, totalMemoryBytes: totalmem() },
    } });
    // Freeze uses canonical eligibility, not merely the proposed account labels.
    await verifyCurrentContextEfficiencyExecutionTarget({ manifest: frozen });
    await verifyCurrentContextEfficiencyIdentity({ repositoryRoot, manifest: frozen });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(frozen, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${JSON.stringify({ status: "frozen", sourceRevision: frozen.identity.startingCommit,
      protocolContractDigest: frozen.identity.protocolContractDigest, providerQuotaUsed: false })}\n`);
    return;
  }
  if (args[0] === "schedule") {
    const manifestPath = readFlag(args, "--manifest");
    const outputPath = readFlag(args, "--output");
    const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as unknown;
    const schedule = buildContextEfficiencySchedule(manifest);
    await writeFile(resolve(outputPath), `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
    return;
  }
  if (args[0] === "verify") {
    const manifestPath = readFlag(args, "--manifest");
    const repositoryRoot = resolve(readFlag(args, "--repository-root"));
    const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as unknown;
    await verifyCurrentContextEfficiencyIdentity({ repositoryRoot, manifest });
    await verifyCurrentContextEfficiencyExecutionTarget({ manifest });
    process.stdout.write(`${JSON.stringify({ status: "ready", providerQuotaUsed: false })}\n`);
    return;
  }
  if (args[0] === "execute") {
    if (!args.includes("--acknowledge-provider-quota")) {
      throw new Error("execute requires --acknowledge-provider-quota after explicit operator authorization.");
    }
    const manifestPath = readFlag(args, "--manifest");
    const outputPath = readFlag(args, "--output");
    const repositoryRoot = resolve(readFlag(args, "--repository-root"));
    const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as unknown;
    assertPrivateBenchmarkPath(repositoryRoot, outputPath);
    await verifyCurrentContextEfficiencyIdentity({ repositoryRoot, manifest });
    await verifyCurrentContextEfficiencyExecutionTarget({ manifest });
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(resolve(outputPath), `${JSON.stringify(bindContextEfficiencyReport(manifest, []), null, 2)}\n`, {
      encoding: "utf8", flag: "wx",
    });
    const dispatcher = createProductionContextEfficiencyDispatcher({ repositoryRoot, manifest });
    try {
      const trials = await dispatchContextEfficiencySchedule({
        manifest,
        dispatcher,
        providerQuotaAuthorized: true,
        checkpoint: (trials) => checkpointContextEfficiencyReport(outputPath, manifest, trials),
        verifyIdentity: () => verifyCurrentContextEfficiencyIdentity({ repositoryRoot, manifest }),
      });
      await checkpointContextEfficiencyReport(outputPath, manifest, trials);
      const report = bindContextEfficiencyReport(manifest, trials);
      const complete = report.integrity.reconciliation.status === "complete"
        && report.integrity.physicalRequestAccounting.status === "complete";
      process.stdout.write(`${JSON.stringify({ status: complete ? "collected" : "incomplete",
        verdict: report.verdict, providerQuotaUsed: true })}\n`);
      if (!complete) process.exitCode = 1;
    } finally {
      await dispatcher.cleanup();
    }
    return;
  }
  if (args[0] !== "collect") {
    throw new Error("Usage: bun scripts/context-efficiency-diagnostic.ts <freeze|schedule|verify|collect|execute> --input/--manifest <path> --output <path>");
  }
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  const parsed = JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Diagnostic collector input must be an array of trial records.");
  const report = collectContextEfficiencyTrials(parsed as ContextEfficiencyCollectedTrial[]);
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function assertPrivateBenchmarkPath(repositoryRoot: string, outputPath: string): void {
  const root = resolveProjectStateBinding(repositoryRoot).benchmarksPath;
  const path = relative(root, resolve(outputPath));
  if (path.length === 0 || path === ".." || path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(path)) {
    throw new Error("Frozen protocols and collection reports must live under the canonical private project benchmark namespace.");
  }
}

async function verifyCurrentContextEfficiencyExecutionTarget(input: { readonly manifest: unknown }): Promise<void> {
  const authority = readGlobalExecutionTargetAuthority(readGlobalConfig());
  if (!authority) throw new Error("The frozen diagnostic execution-target catalog is unavailable.");
  const accountUsage = await createAccountUsageInspectionService().inspect();
  verifyContextEfficiencyExecutionTarget({
    manifest: input.manifest,
    targets: authority.executionCatalog.targets,
    accountPolicies: authority.executionCatalog.accountPolicies,
    accountUsage: accountUsage.accounts,
  });
}

export function verifyContextEfficiencyExecutionTarget(input: {
  readonly manifest: unknown;
  readonly targets: readonly {
    readonly id: string;
    readonly providerId: string;
    readonly providerModelId?: string;
    readonly economics?: { readonly fallbackPosture?: string };
    readonly accountPolicyId?: string;
  }[];
  readonly accountPolicies?: readonly {
    readonly id: string;
    readonly accountIds: readonly string[];
  }[];
  readonly accountUsage: readonly Pick<
    AccountUsageInspectionEntry,
    "provider" | "accountId" | "plan" | "availability" | "evidenceState" | "source" | "confidence" | "eligibleTargets"
  >[];
  readonly now?: Date;
}): void {
  const identity = readManifestIdentity(input.manifest);
  const targetId = requireString(identity.targetId, "frozen target identity");
  const target = input.targets.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`Frozen diagnostic target '${targetId}' is unavailable.`);
  if (target.providerId !== requireString(identity.providerId, "frozen provider identity")
    || target.providerModelId !== requireString(identity.modelId, "frozen model identity")) {
    throw new Error("Frozen diagnostic target differs from the provider/model identity.");
  }
  if (target.economics?.fallbackPosture !== "disabled") {
    throw new Error("Frozen diagnostic target does not disable provider fallback.");
  }
  const plusAccountIds = readDeclaredPlusAccountIds(identity);
  const accountPolicy = input.accountPolicies?.find((candidate) => candidate.id === target.accountPolicyId);
  if (!accountPolicy) {
    throw new Error("Frozen diagnostic target lacks an inspectable account policy.");
  }
  if (JSON.stringify([...accountPolicy.accountIds].sort()) !== JSON.stringify([...plusAccountIds].sort())) {
    throw new Error("Frozen diagnostic target account policy is not restricted to the registered Plus accounts.");
  }
  for (const accountId of plusAccountIds) {
    const usage = input.accountUsage.find((entry) =>
      entry.provider === target.providerId && entry.accountId === accountId
    );
    if (!usage
      || usage.plan !== "plus"
      || usage.availability !== "available"
      || usage.evidenceState !== "fresh"
      || usage.source !== "provider-endpoint"
      || usage.confidence !== "authoritative"
      || !usage.eligibleTargets.includes(targetId)) {
      throw new Error(`Registered Plus account '${accountId}' lacks fresh canonical provider evidence for '${targetId}'.`);
    }
  }
}

function readDeclaredPlusAccountIds(
  identity: Readonly<Record<string, unknown>>,
): readonly string[] {
  const policy = requireRecord(identity.plusAccountPolicy, "frozen Plus account policy");
  if (policy.plan !== "plus" || policy.evidenceState !== "fresh") {
    throw new Error("Live diagnostic dispatch requires fresh evidence for registered Plus accounts.");
  }
  const accountIds = readStringArray(policy.allowedAccountIds, "registered Plus account ids");
  if (accountIds.length === 0 || new Set(accountIds).size !== accountIds.length) {
    throw new Error("Live diagnostic dispatch requires a non-empty unique Plus account allowlist.");
  }
  return accountIds;
}

async function verifyCurrentContextEfficiencyIdentity(input: {
  readonly repositoryRoot: string;
  readonly manifest: unknown;
}): Promise<void> {
  const identity = readManifestIdentity(input.manifest);
  const processor = cpus();
  const actualHardware = { platform: process.platform, architecture: process.arch,
    cpuModel: processor[0]?.model ?? "unknown", logicalCpuCount: processor.length, totalMemoryBytes: totalmem() };
  if (digestCanonicalValue(identity.hardware) !== digestCanonicalValue(actualHardware)) {
    throw new Error("Frozen hardware identity differs from this execution host.");
  }
  const identityRunner = createBunContextEfficiencyCommandRunner();
  await verifyCommittedContextEfficiencyCheckout({
    repositoryRoot: input.repositoryRoot,
    commandRunner: identityRunner,
  });
  const head = await identityRunner.run({
    command: ["git", "rev-parse", "HEAD"],
    cwd: input.repositoryRoot,
    timeoutMs: 10_000,
  });
  if (head.exitCode !== 0) throw new Error("Unable to resolve the diagnostic repository HEAD.");
  verifyContextEfficiencySourceContract({
    repositoryRoot: input.repositoryRoot,
    manifest: input.manifest,
    headCommit: head.stdout,
    bunVersion: process.versions.bun ?? "unknown",
    configurationRevisionId: readRuntimeConfigurationRevision(input.repositoryRoot).revisionSetId,
  });
}

export async function verifyCommittedContextEfficiencyCheckout(input: {
  readonly repositoryRoot: string;
  readonly commandRunner?: ContextEfficiencyCommandRunner;
}): Promise<void> {
  const runner = input.commandRunner ?? createBunContextEfficiencyCommandRunner();
  const status = await runner.run({
    command: ["git", "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"],
    cwd: input.repositoryRoot,
    timeoutMs: 10_000,
  });
  if (status.exitCode !== 0) {
    throw new Error("Unable to verify the committed context-efficiency checkout.");
  }
  if (status.stdout.trim().length > 0) {
    throw new Error(
      "Context-efficiency collection requires a clean committed checkout. Use an isolated checkout and keep private manifests and reports outside it.",
    );
  }
}

function readFlag(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
