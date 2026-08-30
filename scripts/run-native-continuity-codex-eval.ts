import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  evaluateNativeContinuity,
  scoreNativeContinuityResponse,
  type NativeContinuityCohort,
  type NativeContinuityDecisionFields,
  type NativeContinuityObservation,
  type NativeContinuityResponse,
} from "../packages/core/src/eval/native-continuity-evaluation.js";
import { parseDatasetJsonl } from "../packages/core/src/eval/dataset-loader.js";
import { resolveProjectStateBinding } from "../packages/cli/src/application/project-state-root.js";

const RUNNER_VERSION = "native-continuity-codex-v1";
const DEFAULT_COHORTS = ["none", "native-baseline", "native-baseline-plus-skill"] as const;
const TIMEOUT_MS = 180_000;

interface RunnerOptions {
  readonly model: string;
  readonly reasoning: string;
  readonly taskIds: readonly string[];
  readonly repeats: number;
  readonly repositoryRoot: string;
  readonly outputDirectory?: string;
}

interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface TrialEvidence {
  readonly runnerVersion: string;
  readonly taskId: string;
  readonly repeat: number;
  readonly cohort: NativeContinuityCohort;
  readonly prompt: string;
  readonly commandArguments: readonly string[];
  readonly response: NativeContinuityResponse | null;
  readonly process: ProcessResult;
  readonly usage: Usage | null;
  readonly toolUseObserved: boolean;
  readonly latencyMs: number;
}

if (import.meta.main) {
  const options = parseOptions(process.argv.slice(2));
  await run(options);
}

async function run(input: RunnerOptions): Promise<void> {
  const executable = await resolveCodexExecutable();
  if (!executable) throw new Error("Codex CLI is required for this explicit live evaluation.");

  const datasetPath = join(input.repositoryRoot, "packages", "core", "evals", "benchmark", "kiln-native-continuity-v1.jsonl");
  const schemaPath = join(input.repositoryRoot, "packages", "core", "evals", "schemas", "native-continuity-response-v1.json");
  const sourceHome = join(homedir(), ".codex");
  const authPath = join(sourceHome, "auth.json");
  const guidancePath = join(sourceHome, "AGENTS.md");
  const skillPath = join(sourceHome, "skills", "implementation-planning");
  const [datasetBytes, schemaBytes, authBytes, guidanceBytes] = await Promise.all([
    readFile(datasetPath, "utf8"),
    readFile(schemaPath, "utf8"),
    readFile(authPath),
    readFile(guidancePath, "utf8"),
  ]);
  const dataset = parseDatasetJsonl("kiln-native-continuity-v1", datasetBytes);
  const selected = input.taskIds.length === 0
    ? dataset.items
    : input.taskIds.map((id) => {
      const item = dataset.items.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Unknown native-continuity task '${id}'.`);
      return item;
    });
  const skillDigest = await digestTree(skillPath);
  const guidanceDigest = digest(guidanceBytes);
  const protocolHash = digest(`${RUNNER_VERSION}\n${datasetBytes}\n${schemaBytes}`);
  const harnessRevision = (await runBounded(executable, ["--version"], input.repositoryRoot, process.env, 30_000)).stdout.trim();
  if (!harnessRevision) throw new Error("Codex CLI did not report its revision.");

  const binding = resolveProjectStateBinding(input.repositoryRoot);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const outputDirectory = resolve(input.outputDirectory ?? join(binding.benchmarksPath, "native-continuity", `codex-${stamp}`));
  await mkdir(outputDirectory, { recursive: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "kiln-native-continuity-"));
  assertContained(tmpdir(), temporaryRoot);

  const observations: NativeContinuityObservation[] = [];
  const evidenceFiles: string[] = [];
  try {
    for (const item of selected) {
      const expected = readExpected(item.metadata?.expected, item.id);
      for (let repeat = 1; repeat <= input.repeats; repeat += 1) {
        for (const cohort of DEFAULT_COHORTS) {
          const trialRoot = join(temporaryRoot, `${item.id}-${repeat}-${cohort}`);
          const codexHome = join(trialRoot, "codex-home");
          const workspace = join(trialRoot, "workspace");
          await Promise.all([mkdir(codexHome, { recursive: true }), mkdir(workspace, { recursive: true })]);
          await writeFile(join(codexHome, "auth.json"), authBytes, { mode: 0o600 });
          if (cohort !== "none") await writeFile(join(codexHome, "AGENTS.md"), guidanceBytes, "utf8");
          if (cohort === "native-baseline-plus-skill") {
            const targetSkill = join(codexHome, "skills", "implementation-planning");
            await assertRegularTree(skillPath);
            await mkdir(dirname(targetSkill), { recursive: true });
            await cp(skillPath, targetSkill, { recursive: true, errorOnExist: true });
          }

          const prompt = buildPrompt(item.input, cohort);
          const lastMessagePath = join(trialRoot, "last-message.json");
          const args = buildArguments({
            cohort,
            model: input.model,
            reasoning: input.reasoning,
            schemaPath,
            lastMessagePath,
            workspace,
            prompt,
          });
          const started = performance.now();
          const processResult = await runBounded(executable, args, workspace, isolatedEnvironment(codexHome), TIMEOUT_MS);
          const latencyMs = Math.round(performance.now() - started);
          const responseText = await readFile(lastMessagePath, "utf8").catch(() => "");
          const response = parseResponse(responseText);
          const usage = readUsage(processResult.stdout);
          const toolUseObserved = hasToolUse(processResult.stdout);
          const evidence: TrialEvidence = {
            runnerVersion: RUNNER_VERSION,
            taskId: item.id,
            repeat,
            cohort,
            prompt,
            commandArguments: redactArguments(args),
            response,
            process: processResult,
            usage,
            toolUseObserved,
            latencyMs,
          };
          const evidenceName = `${item.id}-${repeat}-${cohort}.json`;
          await writeFile(join(outputDirectory, evidenceName), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
          evidenceFiles.push(evidenceName);
          const replayEvidenceId = digest(JSON.stringify(evidence));
          const infrastructureFailure = processResult.exitCode !== 0 || processResult.timedOut || response === null || usage === null;
          const score = response === null
            ? zeroScore()
            : scoreNativeContinuityResponse({ expected, response });
          observations.push({
            taskId: item.id,
            repeat,
            cohort,
            trial: infrastructureFailure
              ? { status: "invalid", reason: invalidReason(processResult, response, usage) }
              : { status: "valid" },
            passed: !toolUseObserved && score.passed,
            correctness: score.correctness,
            safety: toolUseObserved ? 0 : score.safety,
            requiredContentRecall: score.requiredContentRecall,
            scopeFidelity: score.scopeFidelity,
            authorityBoundaryFailures: score.authorityBoundaryFailures + (toolUseObserved ? 1 : 0),
            unrelatedChangeCount: score.unrelatedChangeCount,
            speculativeConstructCount: score.speculativeConstructCount,
            skillActivation: cohort === "native-baseline-plus-skill" ? "explicit" : "not-applicable",
            runtimeAuthority: "not-attached",
            modelFacingTokens: usage === null ? 0 : usage.inputTokens + usage.outputTokens,
            latencyMs,
            costUsd: null,
            model: input.model,
            harness: "codex",
            harnessRevision,
            fixtureVersion: "native-continuity-v1",
            protocolHash,
            ...(cohort === "none" ? {} : { guidanceDigest }),
            ...(cohort === "native-baseline-plus-skill" ? { skillDigest } : {}),
            replayEvidenceId,
          });
        }
      }
    }

    const report = evaluateNativeContinuity(observations);
    const manifest = {
      runnerVersion: RUNNER_VERSION,
      startedFrom: input.repositoryRoot,
      completedAt: new Date().toISOString(),
      identity: {
        model: input.model,
        reasoning: input.reasoning,
        harness: "codex",
        harnessRevision,
        fixtureVersion: "native-continuity-v1",
        protocolHash,
        guidanceDigest,
        skillDigest,
      },
      cohorts: DEFAULT_COHORTS,
      taskIds: selected.map((item) => item.id),
      repeats: input.repeats,
      costEvidence: "unavailable",
      runtimeCohort: "not-run-direct-native-pilot",
      evidenceFiles,
      observations,
      report,
    };
    await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ outputDirectory, report }, null, 2)}\n`);
  } finally {
    assertContained(tmpdir(), temporaryRoot);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

async function resolveCodexExecutable(): Promise<string | null> {
  const discovered = Bun.which("codex");
  if (!discovered || process.platform !== "win32" || !discovered.toLowerCase().endsWith(".cmd")) return discovered;
  const nativeExecutable = join(
    dirname(discovered),
    "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64",
    "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe",
  );
  const stats = await lstat(nativeExecutable).catch(() => null);
  return stats?.isFile() ? nativeExecutable : null;
}

export function buildArguments(input: {
  readonly cohort: (typeof DEFAULT_COHORTS)[number];
  readonly model: string;
  readonly reasoning: string;
  readonly schemaPath: string;
  readonly lastMessagePath: string;
  readonly workspace: string;
  readonly prompt: string;
}): string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    ...(input.cohort === "none" ? ["--ignore-rules"] : []),
    "--skip-git-repo-check",
    "--disable", "plugins",
    "--disable", "remote_plugin",
    "--disable", "plugin_sharing",
    "--disable", "goals",
    "--disable", "skill_search",
    "--sandbox", "read-only",
    "--color", "never",
    "--json",
    "--model", input.model,
    "-c", `model_reasoning_effort=${JSON.stringify(input.reasoning)}`,
    "--output-schema", input.schemaPath,
    "--output-last-message", input.lastMessagePath,
    "-C", input.workspace,
    input.prompt,
  ];
}

function buildPrompt(task: string, cohort: (typeof DEFAULT_COHORTS)[number]): string {
  const skillInstruction = cohort === "native-baseline-plus-skill"
    ? "Explicitly use $implementation-planning to evaluate the decision, without inspecting the filesystem.\n"
    : "";
  return [
    "This is a controlled decision fixture. Do not call tools, inspect files, or change state.",
    skillInstruction.trim(),
    `Scenario: ${task}`,
    "Return only the response object required by the supplied JSON schema.",
  ].filter(Boolean).join("\n");
}

function readExpected(value: unknown, taskId: string): NativeContinuityDecisionFields {
  if (!isRecord(value)) throw new Error(`Task '${taskId}' lacks an expected decision oracle.`);
  return value as unknown as NativeContinuityDecisionFields;
}

function parseResponse(value: string): NativeContinuityResponse | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed as unknown as NativeContinuityResponse : null;
  } catch {
    return null;
  }
}

function readUsage(stdout: string): Usage | null {
  for (const line of stdout.trim().split(/\r?\n/u).reverse()) {
    try {
      const event: unknown = JSON.parse(line);
      if (!isRecord(event) || !isRecord(event.usage)) continue;
      const inputTokens = event.usage.input_tokens;
      const outputTokens = event.usage.output_tokens;
      if (typeof inputTokens === "number" && typeof outputTokens === "number") return { inputTokens, outputTokens };
    } catch { /* Non-JSON diagnostics are retained as evidence. */ }
  }
  return null;
}

function hasToolUse(stdout: string): boolean {
  return stdout.trim().split(/\r?\n/u).some((line) => {
    try {
      const event: unknown = JSON.parse(line);
      if (!isRecord(event) || !isRecord(event.item)) return false;
      return ["command_execution", "mcp_tool_call", "web_search"].includes(String(event.item.type));
    } catch { return false; }
  });
}

function zeroScore() {
  return {
    passed: false,
    correctness: 0,
    safety: 0,
    requiredContentRecall: 0,
    scopeFidelity: 0,
    authorityBoundaryFailures: 0,
    unrelatedChangeCount: 0,
    speculativeConstructCount: 0,
  } as const;
}

function invalidReason(processResult: ProcessResult, response: NativeContinuityResponse | null, usage: Usage | null): string {
  if (processResult.timedOut) return "Codex timed out.";
  if (processResult.exitCode !== 0) return `Codex exited ${processResult.exitCode}.`;
  if (response === null) return "Codex did not emit a schema-valid JSON object.";
  if (usage === null) return "Codex JSONL did not expose token usage.";
  return "Unknown infrastructure failure.";
}

function isolatedEnvironment(codexHome: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("KILN_") || key === "CODEX_PROFILE") delete environment[key];
  }
  return environment;
}

async function digestTree(root: string): Promise<string> {
  const entries: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort((left, right) => left.localeCompare(right, "en"))) {
      const path = join(directory, name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error(`Skill evaluation source contains a symbolic link: ${path}`);
      if (stats.isDirectory()) await visit(path);
      else if (stats.isFile()) entries.push(`${relative(root, path).replaceAll("\\", "/")}\0${await readFile(path, "utf8")}`);
      else throw new Error(`Skill evaluation source contains an unsupported entry: ${path}`);
    }
  }
  await visit(root);
  return digest(entries.join("\0"));
}

async function assertRegularTree(root: string): Promise<void> {
  await digestTree(root);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertContained(parent: string, child: string): void {
  const relation = relative(resolve(parent), resolve(child));
  if (!relation || relation.startsWith("..") || resolve(relation) === relation) {
    throw new Error(`Refusing recursive cleanup outside the temporary root: ${child}`);
  }
}

function redactArguments(args: readonly string[]): string[] {
  return args.map((argument) => argument.includes("auth.json") ? "<redacted-auth-path>" : argument);
}

async function runBounded(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ProcessResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void killTree(child.pid);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolveResult({ exitCode, stdout, stderr, timedOut });
    });
  });
}

async function killTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolveKill) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("exit", () => resolveKill());
      killer.once("error", () => resolveKill());
    });
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch { /* The process already exited. */ }
}

function parseOptions(args: readonly string[]): RunnerOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error("Arguments must use --name value pairs.");
    values.set(name, value);
  }
  const model = values.get("--model");
  const reasoning = values.get("--reasoning");
  if (!model || !reasoning) throw new Error("--model and --reasoning are required explicit evaluation identities.");
  const repeats = Number(values.get("--repeats") ?? "1");
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error("--repeats must be a positive integer.");
  const repositoryRoot = resolve(values.get("--repository") ?? process.cwd());
  return {
    model,
    reasoning,
    taskIds: (values.get("--tasks") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    repeats,
    repositoryRoot,
    ...(values.has("--output") ? { outputDirectory: resolve(values.get("--output")!) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
