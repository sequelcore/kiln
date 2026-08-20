import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFormalVerifyTool,
  FORMAL_VERIFY_CAPABILITY,
} from "../../src/tools/infrastructure/formal-verify-tool.js";
import { TOOL_SCHEMAS } from "../../src/tools/domain/tool.js";
import { createDefaultBuiltinTools } from "../../src/tools/default-tool-surface.js";
import { BUILTIN_TOOL_EFFECT_ENVELOPES } from "../../src/tools/domain/tool-effect-envelopes.js";
import {
  FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
  isFormalVerificationToolResultMetadata,
  parseFormalVerificationToolResultMetadata,
  type FormalVerificationToolResultMetadata,
} from "../../src/tools/domain/tool-result-metadata.js";
import type {
  CommandProcessRequest,
  CommandProcessResult,
  CommandProcessRunner,
  CommandProcessSink,
} from "../../src/tools/infrastructure/command-process.js";
import { makeSandbox, makeTempDir as makePlainTempDir, removeTempDir } from "./infrastructure/test-utils.js";

class ScriptedRunner implements CommandProcessRunner {
  request?: CommandProcessRequest;
  constructor(
    private readonly result: CommandProcessResult = { exitCode: 0 },
    private readonly beforeFinish?: (request: CommandProcessRequest) => void,
    private readonly logCsv?: string,
    private readonly delayMs = 0,
  ) {}
  start(request: CommandProcessRequest, sink: CommandProcessSink) {
    this.request = request;
    const finish = (): void => {
      this.beforeFinish?.(request);
      if (this.logCsv !== undefined) {
        const logArgument = request.args.find((argument) => argument.startsWith("csv;LogFileName="));
        if (!logArgument) throw new Error("scripted verifier did not receive a CSV log argument");
        writeFileSync(resolve(request.cwd, logArgument.slice("csv;LogFileName=".length)), this.logCsv);
      }
      sink.finish(this.result);
    };
    if (this.delayMs > 0) {
      setTimeout(finish, this.delayMs);
    } else {
      finish();
    }
    return { stop: async () => {} };
  }
}

const tool = (runner: CommandProcessRunner = new ScriptedRunner()) =>
  createFormalVerifyTool({ executable: "dafny", verifierVersion: "4.11.0", runner });

const call = (file: unknown) => ({ input: { file } }) as never;
const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd, encoding: "utf8" });
  return result.stdout;
}

async function makeTempDir(prefix = "kiln-tools-"): Promise<string> {
  const root = await makePlainTempDir(prefix);
  await git(root, "init", "--quiet");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "Kiln test");
  await git(root, "config", "core.autocrlf", "true");
  await git(root, "commit", "--quiet", "--allow-empty", "-m", "baseline");
  return root;
}

const makeGitRepo = (): Promise<string> => makeTempDir("kiln-formal-git-");

describe("formal_verify registration", () => {
  it("declares a schema that does not accept an acceptance-criterion mapping", () => {
    const properties = (TOOL_SCHEMAS.formal_verify.inputSchema as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    });
    expect(Object.keys(properties.properties)).toEqual(["file"]);
    expect(properties.additionalProperties).toBe(false);
  });

  it("declares an effect envelope that admits process, workspace, and machine boundaries", () => {
    const envelope = BUILTIN_TOOL_EFFECT_ENVELOPES.formal_verify;
    expect(envelope.operation).toBe("mutate");
    expect([...envelope.boundaries].sort()).toEqual(["machine", "process", "workspace"]);
    expect(envelope.dataEgress).toBe("none");
    expect(envelope.idempotency).toBe("conditionally-idempotent");
  });

  it("names the capability identity it implements", () => {
    expect(FORMAL_VERIFY_CAPABILITY).toBe("verify.formal");
  });

  it("exposes the registered schema", () => {
    expect(tool().name).toBe("formal_verify");
    expect(tool().effectEnvelope).toBeDefined();
  });
});

describe("formal_verify execution", () => {
  let executionDir: string | undefined;

  afterEach(async () => {
    if (executionDir) await removeTempDir(executionDir);
    executionDir = undefined;
  });

  const executionFile = async (): Promise<string> => {
    executionDir = await makeTempDir();
    const filePath = join(executionDir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    return filePath;
  };

  it("rejects a call without a file", async () => {
    const result = await tool().execute(call(undefined));
    expect(result.isError).toBe(true);
  });

  it("reports a run that did not complete as an error, not as a clean verification", async () => {
    const filePath = await executionFile();
    const result = await tool(new ScriptedRunner({ timedOut: true })).execute(call(filePath), makeSandbox(executionDir!));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("did not complete");
    expect(result.output).toContain("timed_out");
  });

  it("reports a missing executable as an error", async () => {
    const filePath = await executionFile();
    const result = await tool(
      new ScriptedRunner({ error: new Error("spawn dafny ENOENT") }),
    ).execute(call(filePath), makeSandbox(executionDir!));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("ENOENT");
  });

  it("does not claim acceptance when a completed run discharged nothing", async () => {
    const filePath = await executionFile();
    await writeFile(
      `${filePath}.verification.csv`,
      "TestResult.DisplayName,TestResult.Outcome,TestResult.Duration,TestResult.ResourceCount,RandomSeed",
    );
    const result = await tool().execute(call(filePath));
    expect(result.isError).toBe(true);
    expect(result.metadata).toBeUndefined();
  });
});

describe("formal_verify observation metadata", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await removeTempDir(dir);
  });

  const CSV_HEADER =
    "TestResult.DisplayName,TestResult.Outcome,TestResult.Duration,TestResult.ResourceCount,RandomSeed";
  const diagnosticJsonLine = JSON.stringify({
    type: "diagnostic",
    value: {
      location: { filename: "policy.dfy", range: { start: { line: 44, character: 4 } } },
      defaultFormatMessage: "a postcondition could not be proved",
      relatedInformation: [{ defaultFormatMessage: "this is the postcondition" }],
    },
  });

  /**
   * A real `.dfy` file plus a real CSV log on disk. `DafnyVerifier` reads the
   * log through the real filesystem (no injected reader is reachable through
   * `createFormalVerifyTool`), so only a run backed by real files ever reaches
   * `status: "completed"`.
   */
  async function runWithLog(rows: readonly string[], jsonLines = ""): Promise<{
    readonly result: Awaited<ReturnType<ReturnType<typeof tool>["execute"]>>;
    readonly fileBytes: Buffer;
    readonly filePath: string;
  }> {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    const fileBytes = Buffer.from("method Foo() ensures true {}\n");
    await writeFile(filePath, fileBytes);
    const runner = new ScriptedRunner({ exitCode: 0 }, undefined, [CSV_HEADER, ...rows].join("\n"));
    if (jsonLines) {
      const originalStart = runner.start.bind(runner);
      runner.start = (request, sink) => {
        sink.output({ stream: "stdout", text: jsonLines });
        return originalStart(request, sink);
      };
    }
    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    return { result, fileBytes, filePath };
  }

  it("emits a versioned facts-only observation with canonical artifact identity", async () => {
    const { result, fileBytes } = await runWithLog([
      "admitPath (well-formedness),Passed,00:00:00.0100000,100,0",
      "admitPath (correctness),Passed,00:00:00.0230392,26991,0",
    ]);

    expect(result.isError).toBe(false);
    const metadata = result.metadata as FormalVerificationToolResultMetadata;
    expect(metadata).toEqual({
      schema: FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
      toolName: "formal_verify",
      kind: "formal_verification",
      verifier: { name: "dafny", version: "4.11.0" },
      artifact: { contentDigest: `sha256:${createHash("sha256").update(fileBytes).digest("hex")}` },
      subjects: [{ path: "policy.dfy", contentDigest: `sha256:${createHash("sha256").update(fileBytes).digest("hex")}` }],
      checks: [{ symbol: "admitPath", check: "correctness", outcome: "proved" }],
      establishes: [],
    });
    expect(metadata).not.toHaveProperty("completedAt");
    expect(metadata).not.toHaveProperty("criterionId");
    expect(isFormalVerificationToolResultMetadata(metadata)).toBe(true);
    expect(parseFormalVerificationToolResultMetadata(metadata)).toEqual(metadata);
  });

  it("emits refuted with a non-empty detail for a failed correctness effort", async () => {
    const { result } = await runWithLog(
      ["admitPath (correctness),Failed,00:00:00.0230392,26991,0"],
      diagnosticJsonLine,
    );

    expect(result.isError).toBe(false);
    const metadata = result.metadata as FormalVerificationToolResultMetadata;
    expect(metadata.checks).toHaveLength(1);
    expect(metadata.checks[0]?.outcome).toBe("refuted");
    expect(metadata.checks[0]?.detail).toContain("policy.dfy:44:4");
    expect(metadata.establishes).toEqual([]);
  });

  it("keeps a parsed refuted log as a valid observation even with a nonzero verifier exit", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    const runner = new ScriptedRunner(
      { exitCode: 1 },
      undefined,
      [CSV_HEADER, "admitPath (correctness),Failed,00:00:00.0230392,26991,0"].join("\n"),
    );

    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    expect(result.isError).toBe(false);
    expect((result.metadata as FormalVerificationToolResultMetadata).checks[0]?.outcome).toBe("refuted");
  });

  it("emits an error result and no metadata for a completed run with no correctness checks", async () => {
    const result = await runWithLog([
      "admitPath (well-formedness),Passed,00:00:00.0100000,100,0",
    ]);
    expect(result.result.isError).toBe(true);
    expect(result.result.metadata).toBeUndefined();
  });

  it("emits an error result and no metadata for an incomplete run", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    const result = await tool(new ScriptedRunner({ timedOut: true })).execute(call(filePath));
    expect(result.isError).toBe(true);
    expect(result.metadata).toBeUndefined();
  });

  it("excludes well-formedness efforts from checks", async () => {
    const { result } = await runWithLog([
      "admitPath (well-formedness),Passed,00:00:00.0100000,100,0",
      "admitPath (correctness),Passed,00:00:00.0230392,26991,0",
    ]);

    const metadata = result.metadata as FormalVerificationToolResultMetadata;
    expect(metadata.checks.map((check) => check.symbol)).toEqual(["admitPath"]);
  });

  it("emits correctness checks in canonical symbol order", async () => {
    const { result } = await runWithLog([
      "zeta (correctness),Passed,00:00:00.0230392,26991,0",
      "admitPath (correctness),Passed,00:00:00.0100000,100,0",
    ]);
    const metadata = result.metadata as FormalVerificationToolResultMetadata;
    expect(metadata.checks.map((check) => check.symbol)).toEqual(["admitPath", "zeta"]);
  });

  it("does not consume a stale CSV beside the input when the run emits no fresh log", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    await writeFile(`${filePath}.verification.csv`, [
      CSV_HEADER,
      "admitPath (correctness),Passed,00:00:00.0230392,26991,0",
    ].join("\n"));
    const runner = new ScriptedRunner({ exitCode: 0 });

    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("did not complete");
    expect(result.metadata).toBeUndefined();
  });

  it("gives concurrent runs distinct input and log boundaries", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    const csv = [CSV_HEADER, "admitPath (correctness),Passed,00:00:00.0230392,26991,0"].join("\n");
    const first = new ScriptedRunner({ exitCode: 0 }, undefined, csv, 10);
    const second = new ScriptedRunner({ exitCode: 0 }, undefined, csv, 10);

    const [firstResult, secondResult] = await Promise.all([
      tool(first).execute(call(filePath), makeSandbox(dir)),
      tool(second).execute(call(filePath), makeSandbox(dir)),
    ]);
    expect(firstResult.isError).toBe(false);
    expect(secondResult.isError).toBe(false);
    expect(first.request?.cwd).toBeDefined();
    expect(second.request?.cwd).toBeDefined();
    expect(first.request?.cwd).not.toBe(second.request?.cwd);
    expect(first.request?.args.find((argument) => argument.startsWith("csv;LogFileName=")))
      .not.toBe(second.request?.args.find((argument) => argument.startsWith("csv;LogFileName=")));
  });

  it("verifies an isolated read-only snapshot when the source changes and is restored", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    const original = Buffer.from("method Foo() ensures true {}\n");
    await writeFile(filePath, original);
    const csv = [CSV_HEADER, "admitPath (correctness),Passed,00:00:00.0230392,26991,0"].join("\n");
    let observedSnapshot: Buffer | undefined;
    let observedRequestPath = "";
    const runner = new ScriptedRunner({ exitCode: 0 }, (request) => {
      const inputArgument = request.args.at(-1)!;
      observedRequestPath = resolve(request.cwd, inputArgument);
      observedSnapshot = readFileSync(observedRequestPath);
      writeFileSync(filePath, "method Foo() ensures false {}\n");
      writeFileSync(filePath, original);
    }, csv);

    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    expect(result.isError).toBe(false);
    expect(observedRequestPath).not.toBe(filePath);
    expect(observedSnapshot).toEqual(original);
    expect((result.metadata as FormalVerificationToolResultMetadata).artifact.contentDigest)
      .toBe(`sha256:${createHash("sha256").update(original).digest("hex")}`);
  });

  it("preserves quoted local include dependencies inside the snapshot boundary", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, 'include "helper.dfy"\nmethod Foo() ensures true {}\n');
    await writeFile(join(dir, "helper.dfy"), "lemma Helper() ensures true {}\n");
    const csv = [CSV_HEADER, "admitPath (correctness),Passed,00:00:00.0230392,26991,0"].join("\n");
    let snapshotHasHelper = false;
    const runner = new ScriptedRunner({ exitCode: 0 }, (request) => {
      const snapshotInputPath = resolve(request.cwd, request.args.at(-1)!);
      snapshotHasHelper = existsSync(join(dirname(snapshotInputPath), "helper.dfy"));
    }, csv);

    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    expect(result.isError).toBe(false);
    expect(snapshotHasHelper).toBe(true);
    expect((result.metadata as FormalVerificationToolResultMetadata).subjects).toEqual([
      { path: "helper.dfy", contentDigest: `sha256:${createHash("sha256").update("lemma Helper() ensures true {}\n").digest("hex")}` },
      { path: "policy.dfy", contentDigest: `sha256:${createHash("sha256").update('include "helper.dfy"\nmethod Foo() ensures true {}\n').digest("hex")}` },
    ]);
  });

  it("fails closed when sandbox.cwd is absent", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    const runner = new ScriptedRunner({ exitCode: 0 }, undefined, [
      CSV_HEADER,
      "admitPath (correctness),Passed,00:00:00.0230392,26991,0",
    ].join("\n"));

    const result = await tool(runner).execute(call(filePath), { cwd: join(dir, "missing") });
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/sandbox\.cwd|does not exist/u);
    expect(result.metadata).toBeUndefined();
    expect(runner.request).toBeUndefined();
  });

  it("fails closed when sandbox.cwd is not a Git worktree", async () => {
    dir = await makePlainTempDir("kiln-formal-non-git-");
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    const runner = new ScriptedRunner({ exitCode: 0 }, undefined, [
      CSV_HEADER,
      "admitPath (correctness),Passed,00:00:00.0230392,26991,0",
    ].join("\n"));

    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/Git boundary|not a git repository/u);
    expect(result.metadata).toBeUndefined();
    expect(runner.request).toBeUndefined();
  });

  it("fails closed when a verified subject is outside sandbox.cwd", async () => {
    dir = await makeTempDir();
    const candidateRoot = join(dir, "candidate");
    const outsideRoot = join(dir, "outside");
    const filePath = join(outsideRoot, "policy.dfy");
    await mkdir(candidateRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(filePath, "method Foo() ensures true {}\n");
    const runner = new ScriptedRunner({ exitCode: 0 }, undefined, [
      CSV_HEADER,
      "admitPath (correctness),Passed,00:00:00.0230392,26991,0",
    ].join("\n"));

    const result = await tool(runner).execute(
      call(filePath),
      makeSandbox(candidateRoot, { allowedPaths: [dir] }),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/candidate-relative|outside|subject/u);
    expect(result.metadata).toBeUndefined();
    expect(runner.request).toBeUndefined();
  });

  it("runs on Git-clean bytes for tracked input and an untracked dependency", async () => {
    dir = await makeGitRepo();
    const filePath = join(dir, "policy.dfy");
    const helperPath = join(dir, "helper.dfy");
    const fileBytes = Buffer.from('include "helper.dfy"\r\nmethod Foo() ensures true {}\r\n', "utf8");
    const helperBytes = Buffer.from("lemma Helper() ensures true {}\r\n", "utf8");
    await writeFile(filePath, fileBytes);
    await git(dir, "add", "policy.dfy");
    await git(dir, "commit", "--quiet", "-m", "baseline");
    await writeFile(helperPath, helperBytes);
    const cleanFileBytes = Buffer.from('include "helper.dfy"\nmethod Foo() ensures true {}\n', "utf8");
    const cleanHelperBytes = Buffer.from("lemma Helper() ensures true {}\n", "utf8");
    let observedFileBytes: Buffer | undefined;
    let observedHelperBytes: Buffer | undefined;
    const runner = new ScriptedRunner({ exitCode: 0 }, undefined, [
      CSV_HEADER,
      "admitPath (correctness),Passed,00:00:00.0230392,26991,0",
    ].join("\n"));
    const originalStart = runner.start.bind(runner);
    runner.start = (request, sink) => {
      const snapshotInputPath = resolve(request.cwd, request.args.at(-1)!);
      observedFileBytes = readFileSync(snapshotInputPath);
      observedHelperBytes = readFileSync(join(dirname(snapshotInputPath), "helper.dfy"));
      return originalStart(request, sink);
    };

    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    expect(result.isError).toBe(false);
    expect(observedFileBytes).toEqual(cleanFileBytes);
    expect(observedHelperBytes).toEqual(cleanHelperBytes);
    expect((result.metadata as FormalVerificationToolResultMetadata).subjects).toEqual([
      { path: "helper.dfy", contentDigest: `sha256:${createHash("sha256").update(cleanHelperBytes).digest("hex")}` },
      { path: "policy.dfy", contentDigest: `sha256:${createHash("sha256").update(cleanFileBytes).digest("hex")}` },
    ]);
  });

  it("fails closed when a local include escapes the admitted read boundary", async () => {
    dir = await makeTempDir();
    const allowedDir = join(dir, "allowed");
    const outsideDir = join(dir, "outside");
    const filePath = join(allowedDir, "policy.dfy");
    await mkdir(allowedDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(filePath, 'include "../outside/helper.dfy"\nmethod Foo() ensures true {}\n');
    await writeFile(join(outsideDir, "helper.dfy"), "method Helper() {}\n");

    const runner = new ScriptedRunner();
    const result = await tool(runner).execute(
      call(filePath),
      makeSandbox(allowedDir, { allowedPaths: [allowedDir] }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("dependency read denied");
    expect(result.metadata).toBeUndefined();
    expect(runner.request).toBeUndefined();
  });

  it("fails closed when a local include follows a symlink outside the admitted read boundary", async () => {
    dir = await makeTempDir();
    const allowedDir = join(dir, "allowed");
    const outsideDir = join(dir, "outside");
    const filePath = join(allowedDir, "policy.dfy");
    const linkPath = join(allowedDir, "linked");
    await mkdir(allowedDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(filePath, 'include "linked/helper.dfy"\nmethod Foo() ensures true {}\n');
    await writeFile(join(outsideDir, "helper.dfy"), "method Helper() {}\n");

    try {
      await symlink(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "UNKNOWN")) {
        // Windows junction/symlink creation may require a privilege unavailable to the test runner.
        return;
      }
      throw error;
    }

    const runner = new ScriptedRunner();
    const result = await tool(runner).execute(
      call(filePath),
      makeSandbox(allowedDir, { allowedPaths: [allowedDir] }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/dependency read denied|symlink|boundary/u);
    expect(result.metadata).toBeUndefined();
    expect(runner.request).toBeUndefined();
  });

  it("fails closed if the verifier changes the read-only snapshot", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    const csv = [CSV_HEADER, "admitPath (correctness),Passed,00:00:00.0230392,26991,0"].join("\n");
    const runner = new ScriptedRunner({ exitCode: 0 }, (request) => {
      const snapshotPath = resolve(request.cwd, request.args.at(-1)!);
      chmodSync(snapshotPath, 0o600);
      writeFileSync(snapshotPath, "method Foo() ensures false {}\n");
    }, csv);

    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("changed during verification");
    expect(result.metadata).toBeUndefined();
  });

  it("fails closed if the verifier removes the snapshot before the post-run check", async () => {
    dir = await makeTempDir();
    const filePath = join(dir, "policy.dfy");
    await writeFile(filePath, "method Foo() ensures true {}\n");
    const csv = [CSV_HEADER, "admitPath (correctness),Passed,00:00:00.0230392,26991,0"].join("\n");
    const runner = new ScriptedRunner({ exitCode: 0 }, (request) => {
      unlinkSync(resolve(request.cwd, request.args.at(-1)!));
    }, csv);

    const result = await tool(runner).execute(call(filePath), makeSandbox(dir));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("snapshot");
    expect(result.metadata).toBeUndefined();
  });
});

describe("formal_verify observation parser", () => {
  const valid = (): FormalVerificationToolResultMetadata => ({
    schema: FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
    toolName: "formal_verify",
    kind: "formal_verification",
    verifier: { name: "dafny", version: "4.11.0" },
    artifact: { contentDigest: `sha256:${"a".repeat(64)}` },
    subjects: [{ path: "policy.dfy", contentDigest: `sha256:${"b".repeat(64)}` }],
    checks: [{ symbol: "admitPath", check: "correctness", outcome: "proved" }],
    establishes: [],
  });

  it("rejects noncanonical digests", () => {
    const value = valid();
    const malformed = { ...value, artifact: { contentDigest: "a".repeat(64) } };
    expect(isFormalVerificationToolResultMetadata(malformed)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(malformed)).toThrow(/canonical sha256/u);
  });

  it("rejects subject paths that are not canonical candidate-relative POSIX paths", () => {
    for (const path of ["../outside.dfy", "/absolute.dfy", "C:/absolute.dfy", "dir\\file.dfy", "dir//file.dfy", "dir/./file.dfy", "dir/../file.dfy", " file.dfy", "file.dfy "]) {
      const malformed = { ...valid(), subjects: [{ path, contentDigest: `sha256:${"b".repeat(64)}` }] };
      expect(isFormalVerificationToolResultMetadata(malformed)).toBe(false);
      expect(() => parseFormalVerificationToolResultMetadata(malformed)).toThrow(/subject/u);
    }
    const internalSpace = { ...valid(), subjects: [{ path: "formal proofs/policy.dfy", contentDigest: `sha256:${"b".repeat(64)}` }] };
    expect(parseFormalVerificationToolResultMetadata(internalSpace).subjects[0]?.path)
      .toBe("formal proofs/policy.dfy");
  });

  it("rejects duplicate or non-canonical subject ordering", () => {
    const duplicate = {
      ...valid(),
      subjects: [
        { path: "policy.dfy", contentDigest: `sha256:${"a".repeat(64)}` },
        { path: "policy.dfy", contentDigest: `sha256:${"b".repeat(64)}` },
      ],
    };
    expect(() => parseFormalVerificationToolResultMetadata(duplicate)).toThrow(/duplicate subject path/u);

    const unsorted = {
      ...valid(),
      subjects: [
        { path: "z.dfy", contentDigest: `sha256:${"b".repeat(64)}` },
        { path: "a.dfy", contentDigest: `sha256:${"c".repeat(64)}` },
      ],
    };
    expect(() => parseFormalVerificationToolResultMetadata(unsorted)).toThrow(/sorted|order/u);
  });

  it("rejects extra fields in subjects", () => {
    const malformed = {
      ...valid(),
      subjects: [{ path: "policy.dfy", contentDigest: `sha256:${"b".repeat(64)}`, size: 1 }],
    };
    expect(isFormalVerificationToolResultMetadata(malformed)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(malformed)).toThrow(/extra|shape|field/u);
  });

  it("rejects digests with surrounding whitespace", () => {
    const value = valid();
    const malformed = { ...value, artifact: { contentDigest: ` sha256:${"a".repeat(64)} ` } };
    expect(isFormalVerificationToolResultMetadata(malformed)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(malformed)).toThrow(/canonical sha256/u);
  });

  it("rejects verifier versions with surrounding whitespace", () => {
    const malformed = { ...valid(), verifier: { name: "dafny" as const, version: " 4.11.0 " } };
    expect(isFormalVerificationToolResultMetadata(malformed)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(malformed)).toThrow(/version/u);
  });

  it("rejects criterion fields and any other extra fields", () => {
    const withCriterion = { ...valid(), criterionId: "AC-1" };
    const withCheckCriterion = {
      ...valid(),
      checks: [{ ...valid().checks[0], criterion: "AC-1" }],
    };
    expect(isFormalVerificationToolResultMetadata(withCriterion)).toBe(false);
    expect(isFormalVerificationToolResultMetadata(withCheckCriterion)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(withCriterion)).toThrow(/extra|shape|field/u);
    expect(() => parseFormalVerificationToolResultMetadata(withCheckCriterion)).toThrow(/extra|shape|field/u);
  });

  it("rejects non-empty establishes", () => {
    const value = { ...valid(), establishes: ["AC-1"] };
    expect(isFormalVerificationToolResultMetadata(value)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(value)).toThrow(/establishes/u);
  });

  it("rejects sparse check arrays", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;
    const value = { ...valid(), checks: sparse };
    expect(isFormalVerificationToolResultMetadata(value)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(value)).toThrow(/check/u);
  });

  it("rejects noncanonical check order", () => {
    const value = {
      ...valid(),
      checks: [
        { symbol: "zeta", check: "correctness" as const, outcome: "proved" as const },
        { symbol: "admitPath", check: "correctness" as const, outcome: "proved" as const },
      ],
    };
    expect(isFormalVerificationToolResultMetadata(value)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(value)).toThrow(/sorted|order/u);
  });

  it("rejects diagnostics attached to a proved check", () => {
    const value = {
      ...valid(),
      checks: [{ ...valid().checks[0], detail: "unexpected detail" }],
    };
    expect(isFormalVerificationToolResultMetadata(value)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(value)).toThrow(/proved.*detail|detail.*proved/u);
  });

  it("accepts and validates shared resource links without mixing them into verifier facts", () => {
    const value = {
      ...valid(),
      resourceLinks: [{ uri: "artifact://formal/output", relation: "full_output" as const, sequence: 0 }],
    };
    expect(isFormalVerificationToolResultMetadata(value)).toBe(true);
    expect(parseFormalVerificationToolResultMetadata(value)).toEqual(value);

    const malformed = { ...value, resourceLinks: [{ uri: "", relation: "full_output" as const }] };
    expect(isFormalVerificationToolResultMetadata(malformed)).toBe(false);
  });

  it("rejects empty correctness checks", () => {
    const value = { ...valid(), checks: [] };
    expect(isFormalVerificationToolResultMetadata(value)).toBe(false);
    expect(() => parseFormalVerificationToolResultMetadata(value)).toThrow(/checks/u);
  });
});

describe("formal_verify in the default tool surface", () => {
  it("is absent when no verifier executable is configured", () => {
    const names = createDefaultBuiltinTools({}).map((tool) => tool.name);
    expect(names).not.toContain("formal_verify");
  });

  it("is offered once a verifier is configured", () => {
    const names = createDefaultBuiltinTools({ formalVerify: { executable: "dafny", verifierVersion: "4.11.0" } })
      .map((tool) => tool.name);
    expect(names).toContain("formal_verify");
  });

  it("carries its effect envelope into the surface", () => {
    const tool = createDefaultBuiltinTools({ formalVerify: { executable: "dafny", verifierVersion: "4.11.0" } })
      .find((entry) => entry.name === "formal_verify");
    expect(tool?.effectEnvelope?.operation).toBe("mutate");
  });
});
