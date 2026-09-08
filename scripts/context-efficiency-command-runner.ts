import { execFile } from "node:child_process";

export interface ContextEfficiencyCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

export interface ContextEfficiencyCommandRunner {
  run(input: {
    readonly command: readonly string[];
    readonly cwd: string;
    readonly timeoutMs: number;
  }): Promise<ContextEfficiencyCommandResult>;
}

/** Owns bounded diagnostic subprocess capture and authoritative termination evidence. */
export function createContextEfficiencyCommandRunner(): ContextEfficiencyCommandRunner {
  return {
    run(input) {
      const [executable, ...args] = input.command;
      if (!executable) throw new TypeError("A diagnostic command is required.");
      if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
        throw new TypeError("A diagnostic command timeout must be a positive safe integer.");
      }
      return new Promise((resolve, reject) => {
        let timedOut = false;
        const child = execFile(executable, args, {
          cwd: input.cwd,
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        }, (error, stdout, stderr) => {
          clearTimeout(timeout);
          if (error && typeof error.code === "string" && !timedOut && !error.killed) {
            reject(error);
            return;
          }
          resolve({
            exitCode: error ? typeof error.code === "number" ? error.code : 1 : 0,
            stdout,
            stderr,
            ...(timedOut ? { timedOut: true } : {}),
          });
        });
        // The caller owns the execution deadline and any terminal drain allowance.
        // This is the final process fence, never evidence of successful cleanup.
        const timeout = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, input.timeoutMs);
      });
    },
  };
}
