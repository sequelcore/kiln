import type {
  CommandProcessRequest,
  CommandProcessResult,
  CommandProcessRunner,
  CommandProcessSink,
} from "@kilnai/core";
import { describe, expect, it } from "vitest";
import { DafnyVerifier } from "../../src/verification/dafny/dafny-verifier.js";

const CSV = [
  "TestResult.DisplayName,TestResult.Outcome,TestResult.Duration,TestResult.ResourceCount,RandomSeed",
  "admitsPath (correctness),Passed,00:00:00.0230392,26991,0",
].join("\n");

const JSON_LINES = JSON.stringify({
  type: "status",
  value: "\nDafny program verifier finished with 6 verified, 0 errors\n",
});

/** Records the spawned request and replays a scripted result. */
class ScriptedRunner implements CommandProcessRunner {
  request?: CommandProcessRequest;
  constructor(
    private readonly stdout: string,
    private readonly result: CommandProcessResult,
    private readonly stderr = "",
  ) {}
  start(request: CommandProcessRequest, sink: CommandProcessSink) {
    this.request = request;
    if (this.stdout) sink.output({ stream: "stdout", text: this.stdout });
    if (this.stderr) sink.output({ stream: "stderr", text: this.stderr });
    sink.finish(this.result);
    return { stop: async () => {} };
  }
}

const verifier = (runner: CommandProcessRunner, readLog = async () => CSV) =>
  new DafnyVerifier(runner, { executable: "dafny", cwd: "/w", readLog });

const request = { file: "policy.dfy", logFilePath: "policy.csv" };

describe("DafnyVerifier", () => {
  it("requests structured output rather than console prose", async () => {
    const runner = new ScriptedRunner(JSON_LINES, { exitCode: 0 });
    await verifier(runner).verify(request);
    expect(runner.request?.args).toEqual([
      "verify",
      "--json-output",
      "--log-format",
      "csv;LogFileName=policy.csv",
      "policy.dfy",
    ]);
  });

  it("reads the log relative to the subprocess working directory, not this process's", async () => {
    let requested = "";
    const verifierWithProbe = new DafnyVerifier(new ScriptedRunner(JSON_LINES, { exitCode: 0 }), {
      executable: "dafny",
      cwd: "/w/project",
      readLog: async (path) => {
        requested = path;
        return CSV;
      },
    });
    await verifierWithProbe.verify(request);
    expect(requested.replace(/\\/gu, "/")).toMatch(/\/w\/project\/policy\.csv$/u);
  });

  it("returns a parsed log for a completed run", async () => {
    const run = await verifier(new ScriptedRunner(JSON_LINES, { exitCode: 0 })).verify(request);
    expect(run.status).toBe("completed");
    expect(run.log.efforts).toHaveLength(1);
    expect(run.log.efforts[0]?.symbol).toBe("admitsPath");
    expect(run.failure).toBeUndefined();
  });

  it("reports an empty log when the run timed out", async () => {
    const run = await verifier(new ScriptedRunner("", { timedOut: true })).verify(request);
    expect(run.status).toBe("timed_out");
    expect(run.log.efforts).toEqual([]);
    expect(run.failure).toBeDefined();
  });

  it("reports an empty log when the run was cancelled", async () => {
    const run = await verifier(new ScriptedRunner("", { cancelled: true })).verify(request);
    expect(run.status).toBe("cancelled");
    expect(run.log.efforts).toEqual([]);
  });

  it("reports failure when the executable could not run", async () => {
    const run = await verifier(new ScriptedRunner("", { error: new Error("spawn dafny ENOENT") })).verify(request);
    expect(run.status).toBe("failed_to_run");
    expect(run.failure).toContain("ENOENT");
  });

  it("fails closed when the verifier is terminated by a signal", async () => {
    const run = await verifier(new ScriptedRunner(JSON_LINES, { exitCode: 0, signal: "SIGKILL" })).verify(request);
    expect(run.status).toBe("failed_to_run");
    expect(run.log.efforts).toEqual([]);
  });

  it("fails closed when machine-readable output exceeds its bound", async () => {
    const run = await verifier(new ScriptedRunner("x".repeat(2_000_001), { exitCode: 0 })).verify(request);
    expect(run.status).toBe("failed_to_run");
    expect(run.log.efforts).toEqual([]);
    expect(run.failure).toContain("exceeded");
  });

  it("treats an unreadable log as failure, never as a passing run", async () => {
    const run = await verifier(new ScriptedRunner(JSON_LINES, { exitCode: 0 }), async () => {
      throw new Error("ENOENT: no such file");
    }).verify(request);
    expect(run.status).toBe("failed_to_run");
    expect(run.log.efforts).toEqual([]);
    expect(run.failure).toContain("unreadable");
  });

  it("preserves stderr and exit code for a failing verification", async () => {
    const run = await verifier(new ScriptedRunner(JSON_LINES, { exitCode: 4 }, "boom")).verify(request);
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toBe("boom");
    expect(run.status).toBe("completed");
  });
});
