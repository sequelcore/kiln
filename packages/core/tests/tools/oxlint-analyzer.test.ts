import { describe, expect, it } from "vitest";
import type {
  CommandProcessRequest,
  CommandProcessResult,
  CommandProcessRunner,
  CommandProcessSink,
} from "../../src/tools/infrastructure/command-process.js";
import { OxlintAnalyzer } from "../../src/tools/infrastructure/verification/oxlint/oxlint-analyzer.js";

class ScriptedRunner implements CommandProcessRunner {
  request?: CommandProcessRequest;

  constructor(
    private readonly stdout: string,
    private readonly result: CommandProcessResult,
    private readonly stderr = "",
  ) {}

  start(request: CommandProcessRequest, sink: CommandProcessSink) {
    this.request = request;
    if (this.stdout.length > 0) sink.output({ stream: "stdout", text: this.stdout });
    if (this.stderr.length > 0) sink.output({ stream: "stderr", text: this.stderr });
    sink.finish(this.result);
    return { stop: async () => {} };
  }
}

function output(diagnostics: readonly unknown[] = []): string {
  return JSON.stringify({
    diagnostics,
    number_of_files: 1,
    number_of_rules: 126,
    threads_count: 1,
    start_time: 0.001,
  });
}

describe("OxlintAnalyzer", () => {
  it("uses a fixed isolated profile and machine-readable output", async () => {
    const runner = new ScriptedRunner(output(), { exitCode: 0 });
    const analyzer = new OxlintAnalyzer(runner, { executable: "oxlint", cwd: "/snapshot" });

    await analyzer.analyze({ file: "src/solution.ts" });

    expect(runner.request?.args).toEqual([
      "--format",
      "json",
      "--config",
      ".kiln-oxlint.json",
      "--disable-nested-config",
      "--no-ignore",
      "-D",
      "correctness",
      "-D",
      "suspicious",
      "src/solution.ts",
    ]);
  });

  it("parses a completed clean analysis", async () => {
    const run = await new OxlintAnalyzer(new ScriptedRunner(output(), { exitCode: 0 }), {
      executable: "oxlint",
      cwd: "/snapshot",
    }).analyze({ file: "src/solution.ts" });

    expect(run).toMatchObject({
      status: "completed",
      filesAnalyzed: 1,
      rulesAnalyzed: 126,
      diagnostics: [],
    });
  });

  it("preserves structured violations from a non-zero lint result", async () => {
    const run = await new OxlintAnalyzer(
      new ScriptedRunner(
        output([
          {
            message: "Unexpected debugger statement.",
            code: "eslint(no-debugger)",
            severity: "error",
            filename: "src/solution.ts",
            labels: [{ span: { line: 4, column: 3 } }],
          },
        ]),
        { exitCode: 1 },
      ),
      { executable: "oxlint", cwd: "/snapshot" },
    ).analyze({ file: "src/solution.ts" });

    expect(run.status).toBe("completed");
    expect(run.diagnostics).toEqual([
      {
        rule: "eslint(no-debugger)",
        severity: "error",
        message: "Unexpected debugger statement.",
        file: "src/solution.ts",
        line: 4,
        column: 3,
      },
    ]);
  });

  it("fails closed on malformed or incomplete JSON", async () => {
    const run = await new OxlintAnalyzer(new ScriptedRunner("not json", { exitCode: 1 }), {
      executable: "oxlint",
      cwd: "/snapshot",
    }).analyze({ file: "src/solution.ts" });

    expect(run.status).toBe("failed_to_run");
    expect(run.failure).toContain("JSON");
  });

  it("fails closed when no file or no rules were analyzed", async () => {
    const run = await new OxlintAnalyzer(
      new ScriptedRunner(
        JSON.stringify({
          diagnostics: [],
          number_of_files: 0,
          number_of_rules: 0,
          threads_count: 1,
          start_time: 0,
        }),
        { exitCode: 0 },
      ),
      { executable: "oxlint", cwd: "/snapshot" },
    ).analyze({ file: "src/solution.ts" });

    expect(run.status).toBe("failed_to_run");
    expect(run.failure).toContain("exactly one file");
  });

  it("reports timeout and cancellation without parsing optimistic output", async () => {
    const timedOut = await new OxlintAnalyzer(new ScriptedRunner(output(), { timedOut: true }), {
      executable: "oxlint",
      cwd: "/snapshot",
    }).analyze({ file: "src/solution.ts" });
    const cancelled = await new OxlintAnalyzer(new ScriptedRunner(output(), { cancelled: true }), {
      executable: "oxlint",
      cwd: "/snapshot",
    }).analyze({ file: "src/solution.ts" });

    expect(timedOut.status).toBe("timed_out");
    expect(cancelled.status).toBe("cancelled");
  });

  it("fails closed when the analyzer is terminated by a signal", async () => {
    const run = await new OxlintAnalyzer(new ScriptedRunner(output(), { signal: "SIGTERM" }), {
      executable: "oxlint",
      cwd: "/snapshot",
    }).analyze({ file: "src/solution.ts" });

    expect(run.status).toBe("failed_to_run");
  });
});
