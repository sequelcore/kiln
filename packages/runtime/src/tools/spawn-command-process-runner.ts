import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { win32 } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type {
  CommandProcessHandle,
  CommandProcessRequest,
  CommandProcessResult,
  CommandProcessRunner,
  CommandProcessSink,
} from "@kilnai/core/tools";

const PROCESS_STOP_GRACE_MS = 2_000;
const PROCESS_KILL_OBSERVATION_MS = 500;

export class SpawnCommandProcessRunner implements CommandProcessRunner {
  start(request: CommandProcessRequest, sink: CommandProcessSink): CommandProcessHandle {
    if (request.signal?.aborted) {
      try { sink.finish({ signal: "SIGTERM", cancelled: true }); } catch { /* observer cannot change cancellation */ }
      return { stop: async () => undefined };
    }
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      detached: process.platform !== "win32",
      windowsHide: true,
      shell: request.shell ?? false,
      ...(request.env === undefined ? {} : { env: { ...request.env } }),
    }) as ChildProcessWithoutNullStreams;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let settled = false;
    let stopReason: "cancelled" | "timeout" | "stopped" | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveTerminalObservation: () => void = () => undefined;
    const terminalObservation = new Promise<void>((resolve) => {
      resolveTerminalObservation = resolve;
    });

    const finish = (result: CommandProcessResult): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
      try {
        const stdoutTail = stdoutDecoder.end();
        const stderrTail = stderrDecoder.end();
        try {
          if (stdoutTail) sink.output({ stream: "stdout", text: stdoutTail });
          if (stderrTail) sink.output({ stream: "stderr", text: stderrTail });
        } catch {
          // A diagnostic observer cannot prevent terminal process evidence.
        }
        try {
          sink.finish({
            ...result,
            ...(stopReason !== undefined && result.signal === undefined ? { signal: "SIGTERM" as const } : {}),
            ...(stopReason === "timeout" ? { timedOut: true } : {}),
            ...(stopReason === "cancelled" ? { cancelled: true } : {}),
          });
        } catch {
          // The process lifecycle is terminal even if an observer fails.
        }
      } finally {
        resolveTerminalObservation();
      }
    };

    const stop = async (reason: "cancelled" | "timeout" | "stopped"): Promise<void> => {
      if (settled || stopReason !== undefined) return;
      stopReason = reason;
      await terminateProcessTree(child, "SIGTERM");
      await waitForTerminalObservation(terminalObservation, PROCESS_STOP_GRACE_MS);
      if (!settled) {
        await terminateProcessTree(child, "SIGKILL");
        await waitForTerminalObservation(terminalObservation, PROCESS_KILL_OBSERVATION_MS);
      }
      if (!settled) finish({ signal: "SIGKILL" });
    };
    const abort = (): void => {
      void stop("cancelled");
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      try {
        if (text) sink.output({ stream: "stdout", text });
      } catch {
        // Output observers cannot change child-process settlement.
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      try {
        if (text) sink.output({ stream: "stderr", text });
      } catch {
        // Output observers cannot change child-process settlement.
      }
    });
    child.once("error", (error) => finish({ error }));
    child.once("close", (code, signal) => finish({ exitCode: code ?? undefined, signal: signal ?? undefined }));

    if (request.timeoutMs !== undefined) timeout = setTimeout(() => void stop("timeout"), request.timeoutMs);
    if (request.signal?.aborted) void stop("cancelled");
    else request.signal?.addEventListener("abort", abort, { once: true });

    return { pid: child.pid, stop };
  }
}

async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid !== undefined) {
    const taskkillExecutable = resolveWindowsTaskkillExecutable(process.env.SystemRoot);
    if (taskkillExecutable === undefined) {
      child.kill(signal);
      return;
    }
    await new Promise<void>((resolve) => {
      const killer = spawn(taskkillExecutable, ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        shell: false,
      });
      killer.once("error", () => {
        child.kill();
        resolve();
      });
      killer.once("close", () => resolve());
    });
    return;
  }
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may have exited between the state check and the signal.
    }
  }
  child.kill(signal);
}

export function resolveWindowsTaskkillExecutable(systemRoot: string | undefined): string | undefined {
  if (typeof systemRoot !== "string"
    || systemRoot.includes("\u0000")
    || !win32.isAbsolute(systemRoot)) return undefined;
  return win32.join(systemRoot, "System32", "taskkill.exe");
}

async function waitForTerminalObservation(observation: Promise<void>, timeoutMs: number): Promise<void> {
  await Promise.race([
    observation,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
