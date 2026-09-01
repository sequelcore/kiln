import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readRuntimeConfigurationRevision } from "../packages/cli/src/application/runtime-configuration-revision.js";
import {
  readGlobalConfig,
  readGlobalExecutionTargetAuthority,
} from "../packages/cli/src/config/global-config.js";

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

export interface ContextEfficiencyCollectedTrial {
  readonly taskId: string;
  readonly condition: "cold" | "immediate_warm" | "long_session";
  readonly repetition: number;
  readonly attempt?: number;
  readonly validity?: "valid" | "invalid";
  readonly invalidReason?: ContextEfficiencyInvalidReason;
  readonly invalidDiagnostic?: ContextEfficiencyInvalidDiagnostic;
  readonly output?: unknown;
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

class ContextEfficiencyInvalidTrialError extends Error {
  override readonly name = "ContextEfficiencyInvalidTrialError";

  constructor(
    readonly reason: ContextEfficiencyInvalidReason,
    message: string,
    readonly diagnostic?: ContextEfficiencyInvalidDiagnostic,
    options?: ErrorOptions,
  ) {
    super(message, options);
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
}): ProductionContextEfficiencyDispatcher {
  const repositoryRoot = resolve(input.repositoryRoot);
  const identity = readManifestIdentity(input.manifest);
  const commandRunner = input.commandRunner ?? createBunContextEfficiencyCommandRunner();
  let generatedFixtureRoot: string | undefined;
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
    assertFrozenRunIdentity(envelope, identity);
    return envelope;
  };

  return {
    async runCli({ trial, task, continuationSessionId }) {
      const generatedFixturePath = trial.executionStrategy === "cli_run_generated_fixture"
        ? await resolveGeneratedFixturePath()
        : undefined;
      const envelope = await runCliEnvelope(trial, task, continuationSessionId, generatedFixturePath);
      return {
        output: applyTrialBudgetEvaluation(withTaskEvaluation(envelope, task, repositoryRoot), trial),
        continuationSessionId: envelope.telemetry.sessionId,
      };
    },

    async runConversation({ trial, task }) {
      const oracle = requireRecord(task.oracle, "conversation oracle");
      const scriptPath = resolve(repositoryRoot, requireString(oracle.scriptFixture, "conversation script fixture"));
      const script = parseJsonOutput(await readFile(scriptPath, "utf8"), "conversation script fixture");
      if (!isRecord(script) || !Array.isArray(script.turns) || script.turns.length === 0) {
        throw new Error("Conversation script fixture has no turns.");
      }
      let continuationSessionId: string | undefined;
      const envelopes: RunEnvelope[] = [];
      for (const rawTurn of script.turns) {
        const turn = requireRecord(rawTurn, "conversation turn");
        const envelope = await runCliEnvelope(
          trial,
          { ...task, input: requireString(turn.message, "conversation turn message") },
          continuationSessionId,
        );
        continuationSessionId = envelope.telemetry.sessionId;
        envelopes.push(envelope);
      }
      const output = applyTrialBudgetEvaluation(
        withTaskEvaluation(mergeConversationEnvelopes(envelopes), task, repositoryRoot),
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
      assertFrozenRunIdentity(projected, identity);
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
      "packages/core/evals/fixtures/context-efficiency-diagnostic-v1/tool-result-generation.json",
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
        content += `shard-${String(shard).padStart(2, "0")}:line-${String(line).padStart(4, "0")}:kiln-context-efficiency-diagnostic-v1\n`;
      }
      chunks.push(content);
      await writeFile(join(fixturePath, `shard-${String(shard).padStart(2, "0")}.txt`), content, "utf8");
    }
    const concatenated = chunks.join("");
    const digest = `sha256:${createHash("sha256").update(concatenated).digest("hex")}`;
    if (digest !== fixtureManifest.orderedConcatenationSha256
      || Buffer.byteLength(concatenated) !== fixtureManifest.orderedConcatenationBytes) {
      throw new Error("Generated fixture does not match its frozen checksum and byte count.");
    }
    await writeFile(join(fixturePath, "manifest.json"), `${JSON.stringify(fixtureManifest, null, 2)}\n`, "utf8");
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

function digestCanonicalValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

interface RunEnvelope {
  readonly schemaVersion: "kiln.run.output.v1";
  readonly answer?: string;
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
  };
  readonly diagnostics: {
    readonly lastError: string | null;
    readonly oraclePassed?: boolean;
    readonly authorityPassed?: boolean;
    readonly requestedAuthority?: string;
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
    };
    if (validity === "invalid") {
      return {
        ...identity,
        validity,
        invalidReason: trial.invalidReason ?? "infrastructure_failure",
        ...(trial.invalidDiagnostic ? { invalidDiagnostic: trial.invalidDiagnostic } : {}),
      };
    }
    return {
      ...identity,
      validity,
      run: projectContentFreeRunEvidence(validateContextEfficiencyRunEnvelope(trial.output)),
    };
  });
  return {
    schemaVersion: "kiln-context-efficiency-diagnostic-collection-v1" as const,
    verdictCeiling: "diagnostic-only" as const,
    trials: projectedTrials,
    cells: summarizeDiagnosticCells(projectedTrials),
  };
}

function projectContentFreeRunEvidence(run: RunEnvelope) {
  return {
    schemaVersion: run.schemaVersion,
    telemetry: {
      sessionId: run.telemetry.sessionId,
      sessionSucceeded: run.telemetry.sessionSucceeded,
      ...(run.telemetry.provider ? { provider: run.telemetry.provider } : {}),
      ...(run.telemetry.model ? { model: run.telemetry.model } : {}),
      inputTokens: run.telemetry.inputTokens,
      outputTokens: run.telemetry.outputTokens,
      toolCallCount: run.telemetry.toolCallCount,
      managedChildCount: run.telemetry.managedChildCount,
      durationMs: run.telemetry.durationMs,
      providerRequests: run.telemetry.providerRequests ?? [],
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
        trial.run.diagnostics.failed
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
    inputTokens: run.telemetry.inputTokens,
    outputTokens: run.telemetry.outputTokens,
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
  requests: readonly Record<string, unknown>[],
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
  requests: readonly Record<string, unknown>[],
  field: "cacheRead" | "cacheWrite",
): number | undefined {
  let total = 0;
  for (const request of requests) {
    const usage = request.usage;
    if (!isRecord(usage) || !isRecord(usage[field]) || typeof usage[field].tokens !== "number") return undefined;
    total += usage[field].tokens;
  }
  return total;
}

function countObservedDispatches(
  requests: readonly Record<string, unknown>[],
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
  if (!isRecord(manifest) || manifest.schemaVersion !== "kiln-context-efficiency-diagnostic-manifest-v1") {
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
  const budgets = readBudgets(design.budgetsPerTrial);
  const schedule: ContextEfficiencyScheduledTrial[] = [];
  for (const rawTask of manifest.tasks) {
    if (!isRecord(rawTask)
      || typeof rawTask.id !== "string"
      || typeof rawTask.executionStrategy !== "string"
      || !Array.isArray(rawTask.conditions)) {
      throw new Error("Diagnostic task identity or execution strategy is invalid.");
    }
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
  return schedule;
}

export async function dispatchContextEfficiencySchedule(input: {
  readonly manifest: unknown;
  readonly dispatcher: ContextEfficiencyStrategyDispatcher;
  readonly providerQuotaAuthorized: boolean;
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
  const coldSessionByTaskRepeat = new Map<string, string>();
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
      try {
        let result: ContextEfficiencyStrategyResult;
        if (trial.executionStrategy === "cli_run" || trial.executionStrategy === "cli_run_generated_fixture") {
          const continuationSessionId = trial.condition === "immediate_warm"
            ? coldSessionByTaskRepeat.get(pairKey)
            : undefined;
          if (trial.condition === "immediate_warm" && !continuationSessionId) {
            throw new ContextEfficiencyInvalidTrialError(
              "canonical_transcript_unavailable",
              `Warm trial '${pairKey}' has no completed cold-session identity.`,
            );
          }
          result = await input.dispatcher.runCli({ trial, task, ...(continuationSessionId ? { continuationSessionId } : {}) });
        } else if (trial.executionStrategy === "cli_continuation") {
          result = await input.dispatcher.runConversation({ trial, task });
        } else if (trial.executionStrategy.startsWith("internal_benchmark")) {
          result = await input.dispatcher.runInternalBenchmark({ trial, task });
        } else {
          throw new Error(`Unsupported diagnostic execution strategy '${trial.executionStrategy}'.`);
        }
        if (trial.condition === "cold") {
          if (!result.continuationSessionId) {
            throw new Error(`Cold CLI trial '${pairKey}' did not return a continuation session identity.`);
          }
          coldSessionByTaskRepeat.set(pairKey, result.continuationSessionId);
        }
        collected.push({
          taskId: trial.taskId,
          condition: trial.condition,
          repetition: trial.repetition,
          attempt,
          validity: "valid",
          output: result.output,
        });
        break;
      } catch (error) {
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
        });
        if (attempt === 1 && retryAvailable) invalidRetryUsedByCell.add(cellKey);
      }
    }
  }
  return collected;
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
    );
  }
  for (const rawRequest of run.telemetry.providerRequests ?? []) {
    const request = requireRecord(rawRequest, "provider-request observation");
    if (request.providerId !== expectedProvider || request.modelId !== expectedModel) {
      throw new ContextEfficiencyInvalidTrialError(
        "route_identity_mismatch",
        "Provider-request observation differs from the frozen provider/model identity.",
      );
    }
    const deliberation = requireRecord(request.deliberation, "provider-request deliberation evidence");
    if (deliberation.state !== "observed" || deliberation.selectedLevel !== expectedDeliberation) {
      throw new ContextEfficiencyInvalidTrialError(
        "route_identity_mismatch",
        "Provider-request observation differs from the frozen deliberation identity.",
      );
    }
    const dispatch = requireRecord(request.dispatch, "provider-request dispatch evidence");
    const fallback = requireRecord(dispatch.fallback, "provider-request fallback evidence");
    if (fallback.state === "observed" && fallback.value === true) {
      throw new ContextEfficiencyInvalidTrialError(
        "route_identity_mismatch",
        "Fixed-route diagnostic trial observed provider fallback.",
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
  if (!isRecord(manifest) || manifest.schemaVersion !== "kiln-context-efficiency-diagnostic-manifest-v1") {
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
  verifyFileContract({
    repositoryRoot,
    rawPaths: identity.sourceContractPaths,
    expectedDigest: identity.sourceContractDigest,
    label: "source",
  });
  verifyFileContract({
    repositoryRoot,
    rawPaths: identity.inputContractPaths,
    expectedDigest: identity.inputContractDigest,
    label: "input",
  });
  const protocolContract = {
    schemaVersion: requireRecord(input.manifest, "diagnostic manifest").schemaVersion,
    claim: requireRecord(input.manifest, "diagnostic manifest").claim,
    identity: Object.fromEntries(Object.entries(identity)
      .filter(([key]) => key !== "protocolContractDigest" && key !== "protocolContractDigestMethod")),
    design: requireRecord(input.manifest, "diagnostic manifest").design,
    tasks: requireRecord(input.manifest, "diagnostic manifest").tasks,
    requiredPerPhysicalRequestEvidence:
      requireRecord(input.manifest, "diagnostic manifest").requiredPerPhysicalRequestEvidence,
    hardGates: requireRecord(input.manifest, "diagnostic manifest").hardGates,
    retention: requireRecord(input.manifest, "diagnostic manifest").retention,
  };
  const observedProtocolDigest = digestCanonicalValue(protocolContract);
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
  readonly label: "source" | "input";
}): void {
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
  const observedDigest = `sha256:${createHash("sha256").update(rows.join("\n"), "utf8").digest("hex")}`;
  const expectedDigest = requireString(input.expectedDigest, `frozen ${input.label}-contract digest`);
  if (observedDigest !== expectedDigest) {
    throw new Error(
      `Current ${input.label} files differ from the frozen ${input.label} contract: expected ${expectedDigest}, observed ${observedDigest}.`,
    );
  }
}

function applyTrialBudgetEvaluation(
  run: RunEnvelope,
  trial: ContextEfficiencyScheduledTrial,
): RunEnvelope {
  const failures = [
    run.telemetry.providerRequests!.length > trial.budgets.maximumProviderRequests
      ? `provider requests ${run.telemetry.providerRequests!.length}/${trial.budgets.maximumProviderRequests}`
      : undefined,
    run.telemetry.toolCallCount > trial.budgets.maximumToolCalls
      ? `tool calls ${run.telemetry.toolCallCount}/${trial.budgets.maximumToolCalls}`
      : undefined,
    run.telemetry.managedChildCount > trial.budgets.maximumManagedChildren
      ? `managed children ${run.telemetry.managedChildCount}/${trial.budgets.maximumManagedChildren}`
      : undefined,
    run.telemetry.inputTokens > trial.budgets.maximumCumulativeInputTokens
      ? `input tokens ${run.telemetry.inputTokens}/${trial.budgets.maximumCumulativeInputTokens}`
      : undefined,
    run.telemetry.outputTokens > trial.budgets.maximumCumulativeOutputTokens
      ? `output tokens ${run.telemetry.outputTokens}/${trial.budgets.maximumCumulativeOutputTokens}`
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
  switch (kind) {
    case "exact_text":
      oraclePassed = answer.trim() === requireString(oracle.value, "exact-text oracle value");
      break;
    case "required_terms_and_no_diff":
      oraclePassed = readStringArray(oracle.requiredTerms, "required oracle terms")
        .every((term) => answer.includes(term));
      break;
    case "fixture_checksum_and_tool_trajectory":
      oraclePassed = answer.trim() === requireString(oracle.expectedChecksum, "fixture checksum")
        && run.telemetry.toolCallCount >= requirePositiveInteger(oracle.minimumToolCalls, "minimum tool calls");
      break;
    case "scripted_conversation_recall": {
      const scriptPath = requireString(oracle.scriptFixture, "conversation script fixture");
      const script = requireRecord(
        JSON.parse(readFileSync(resolve(repositoryRoot, scriptPath), "utf8")) as unknown,
        "conversation script fixture",
      );
      oraclePassed = answer.includes(requireString(script.finalNonce, "conversation final nonce"))
        && readStringArray(script.requiredFinalTerms, "conversation required final terms")
          .every((term) => answer.includes(term));
      break;
    }
    case "fixture_test_and_allowed_diff":
    case "managed_child_settlement":
      oraclePassed = run.diagnostics.oraclePassed === true;
      break;
    default:
      throw new Error(`Unsupported diagnostic task oracle '${kind}'.`);
  }
  return {
    ...run,
    diagnostics: {
      ...run.diagnostics,
      oraclePassed,
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
      providerRequests: envelopes.flatMap((entry) => entry.telemetry.providerRequests ?? []),
    },
    diagnostics: {
      lastError: [...envelopes].reverse().find((entry) => entry.diagnostics.lastError !== null)?.diagnostics.lastError ?? null,
    },
  };
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
  const providerRequests = metadata.providerRequestObservations;
  if (!Array.isArray(providerRequests)) {
    throw new Error("Internal benchmark result lacks canonical provider-request observations.");
  }
  const toolCalls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls.length : 0;
  const managedChildCount = Array.isArray(metadata.toolCalls)
    ? metadata.toolCalls.filter((entry) => isRecord(entry)
      && (entry.name === "managed_agent.invoke" || entry.name === "managed_agent.start")).length
    : 0;
  return validateContextEfficiencyRunEnvelope({
    schemaVersion: "kiln.run.output.v1",
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
      oraclePassed: trial.status === "valid",
    },
  });
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
    verifyCurrentContextEfficiencyExecutionTarget({ manifest });
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
    await verifyCurrentContextEfficiencyIdentity({ repositoryRoot, manifest });
    verifyCurrentContextEfficiencyExecutionTarget({ manifest });
    const dispatcher = createProductionContextEfficiencyDispatcher({ repositoryRoot, manifest });
    try {
      const trials = await dispatchContextEfficiencySchedule({
        manifest,
        dispatcher,
        providerQuotaAuthorized: true,
      });
      const report = collectContextEfficiencyTrials(trials);
      await mkdir(dirname(resolve(outputPath)), { recursive: true });
      await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } finally {
      await dispatcher.cleanup();
    }
    return;
  }
  if (args[0] === "probe") {
    if (!args.includes("--acknowledge-provider-quota")) {
      throw new Error("probe requires --acknowledge-provider-quota after explicit operator authorization.");
    }
    const manifestPath = readFlag(args, "--manifest");
    const outputPath = readFlag(args, "--output");
    const repositoryRoot = resolve(readFlag(args, "--repository-root"));
    const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as unknown;
    await verifyCurrentContextEfficiencyIdentity({ repositoryRoot, manifest });
    verifyCurrentContextEfficiencyExecutionTarget({ manifest });
    const dispatcher = createProductionContextEfficiencyDispatcher({ repositoryRoot, manifest });
    try {
      const trials = await dispatchContextEfficiencyPredispatchProbe({
        manifest,
        dispatcher,
        providerQuotaAuthorized: true,
      });
      const report = collectContextEfficiencyTrials(trials);
      await mkdir(dirname(resolve(outputPath)), { recursive: true });
      await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } finally {
      await dispatcher.cleanup();
    }
    return;
  }
  if (args[0] !== "collect") {
    throw new Error("Usage: bun scripts/context-efficiency-diagnostic.ts <schedule|verify|probe|collect|execute> --input/--manifest <path> --output <path>");
  }
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  const parsed = JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Diagnostic collector input must be an array of trial records.");
  const report = collectContextEfficiencyTrials(parsed as ContextEfficiencyCollectedTrial[]);
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function verifyCurrentContextEfficiencyExecutionTarget(input: { readonly manifest: unknown }): void {
  const authority = readGlobalExecutionTargetAuthority(readGlobalConfig());
  if (!authority) throw new Error("The frozen diagnostic execution-target catalog is unavailable.");
  verifyContextEfficiencyExecutionTarget({
    manifest: input.manifest,
    targets: authority.executionCatalog.targets,
  });
}

export function verifyContextEfficiencyExecutionTarget(input: {
  readonly manifest: unknown;
  readonly targets: readonly {
    readonly id: string;
    readonly providerId: string;
    readonly providerModelId?: string;
    readonly economics?: { readonly fallbackPosture?: string };
  }[];
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
}

async function verifyCurrentContextEfficiencyIdentity(input: {
  readonly repositoryRoot: string;
  readonly manifest: unknown;
}): Promise<void> {
  const identityRunner = createBunContextEfficiencyCommandRunner();
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

function readFlag(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
