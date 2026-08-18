/**
 * Runs the Dafny verifier as a governed subprocess and returns a typed log.
 *
 * Dafny is a .NET executable with no in-process binding, so it is invoked the
 * same way Kiln invokes any external checker: as a replaceable, version-pinned
 * actuator behind a process boundary. That boundary is deliberate. A verifier
 * linked into the control plane would be implicitly trusted and impossible to
 * attribute; a subprocess can be pinned, swapped, and named in the evidence it
 * produces.
 *
 * Per-symbol outcomes are only available through `--log-format csv`, which
 * Dafny writes to a file rather than stdout, so a run produces two artifacts:
 * the CSV log and the `--json-output` diagnostic stream on stdout. Parsing both
 * is pure and lives in `verification/dafny-proof-log.ts`.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDafnyProofLog } from "../../verification/dafny-proof-log.js";
import type { DafnyProofLog } from "../../verification/dafny-proof-log.js";
import type { CommandProcessResult, CommandProcessRunner } from "./command-process.js";

/** Reads the CSV log Dafny wrote. Injected so a run is testable without a filesystem. */
export type DafnyLogReader = (path: string) => Promise<string>;

export interface DafnyVerifierOptions {
  /** Path to the `dafny` executable. Resolved by the caller, never searched for here. */
  readonly executable: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly readLog?: DafnyLogReader;
}

export interface DafnyVerificationRequest {
  /** `.dfy` source to verify, resolved against `cwd`. */
  readonly file: string;
  /** Where Dafny should write its CSV log, resolved against `cwd`. */
  readonly logFilePath: string;
  readonly signal?: AbortSignal;
}

export type DafnyRunStatus = "completed" | "timed_out" | "cancelled" | "failed_to_run";

export interface DafnyVerificationRun {
  readonly status: DafnyRunStatus;
  readonly log: DafnyProofLog;
  readonly exitCode?: number | string;
  readonly stderr: string;
  /** Set when the log could not be produced or read; the run establishes nothing. */
  readonly failure?: string;
}

export class DafnyVerifier {
  private readonly runner: CommandProcessRunner;
  private readonly options: DafnyVerifierOptions;
  private readonly readLog: DafnyLogReader;

  constructor(runner: CommandProcessRunner, options: DafnyVerifierOptions) {
    this.runner = runner;
    this.options = options;
    this.readLog = options.readLog ?? ((path) => readFile(path, "utf8"));
  }

  /**
   * Verify one file.
   *
   * A run that did not complete, or whose log could not be read, returns an
   * empty log with a failure reason rather than an optimistic result. An absent
   * log is not a passing log, and a caller must not be able to mistake one for
   * the other.
   */
  async verify(request: DafnyVerificationRequest): Promise<DafnyVerificationRun> {
    const process = await this.spawn(request);
    const status = toStatus(process.result);
    if (status !== "completed") {
      return {
        status,
        log: { efforts: [], diagnostics: [] },
        stderr: process.stderr,
        ...(process.result.exitCode === undefined ? {} : { exitCode: process.result.exitCode }),
        failure: process.result.error?.message ?? `dafny run ${status}`,
      };
    }
    let csv: string;
    try {
      // Dafny resolves the log path against its own working directory, so the
      // reader must resolve it the same way rather than against this process's.
      csv = await this.readLog(resolve(this.options.cwd, request.logFilePath));
    } catch (error) {
      return {
        status: "failed_to_run",
        log: { efforts: [], diagnostics: [] },
        stderr: process.stderr,
        ...(process.result.exitCode === undefined ? {} : { exitCode: process.result.exitCode }),
        failure: `dafny verification log unreadable: ${(error as Error).message}`,
      };
    }
    return {
      status: "completed",
      log: parseDafnyProofLog({ csv, jsonLines: process.stdout }),
      stderr: process.stderr,
      ...(process.result.exitCode === undefined ? {} : { exitCode: process.result.exitCode }),
    };
  }

  private spawn(request: DafnyVerificationRequest): Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly result: CommandProcessResult;
  }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      this.runner.start(
        {
          executable: this.options.executable,
          args: [
            "verify",
            "--json-output",
            `--log-format`,
            `csv;LogFileName=${request.logFilePath}`,
            request.file,
          ],
          cwd: this.options.cwd,
          ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
        {
          output: (chunk) => {
            if (chunk.stream === "stdout") stdout += chunk.text;
            else stderr += chunk.text;
          },
          finish: (result) => resolve({ stdout, stderr, result }),
        },
      );
    });
  }
}

function toStatus(result: CommandProcessResult): DafnyRunStatus {
  if (result.cancelled) return "cancelled";
  if (result.timedOut) return "timed_out";
  if (result.error) return "failed_to_run";
  return "completed";
}
