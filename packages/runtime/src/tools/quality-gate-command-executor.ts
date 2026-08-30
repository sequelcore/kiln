import { execFile, spawn, type ChildProcess } from "node:child_process";
import type {
  QualityGateCommandExecutionRequest,
  QualityGateCommandExecutionResult,
  QualityGateCommandExecutor,
} from "@kilnai/core/quality-gates";

/** Runtime-owned shell execution for Core quality gates. */
export const nodeQualityGateCommandExecutor: QualityGateCommandExecutor = {
  execute(request: QualityGateCommandExecutionRequest): Promise<QualityGateCommandExecutionResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(request.command, {
        cwd: request.cwd,
        shell: true,
        // A dedicated process group lets the POSIX adapter terminate the shell
        // and every ordinary descendant without touching the Runtime process.
        detached: process.platform !== "win32",
      });
      const chunks: string[] = [];
      let settled = false;
      let timedOut = false;
      let closeSeen = false;
      let terminationComplete = false;
      let terminationFailed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      let settlementTimer: ReturnType<typeof setTimeout> | undefined;
      let treeKiller: ChildProcess | undefined;

      const clearTimers = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        if (settlementTimer !== undefined) clearTimeout(settlementTimer);
      };

      const settleResolve = (result: QualityGateCommandExecutionResult): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (treeKiller?.exitCode === null) {
          try {
            treeKiller.kill("SIGKILL");
          } catch {
            // The helper may have exited between the state check and kill.
          }
        }
        resolve(result);
      };

      const settleReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (treeKiller?.exitCode === null) {
          try {
            treeKiller.kill("SIGKILL");
          } catch {
            // The helper may have exited between the state check and kill.
          }
        }
        reject(error);
      };

      const signalChild = (signal: NodeJS.Signals): boolean => {
        try {
          return child.kill(signal);
        } catch {
          return false;
        }
      };

      const signalProcessTree = (signal: NodeJS.Signals): boolean => {
        if (process.platform !== "win32" && typeof child.pid === "number" && child.pid > 0) {
          try {
            process.kill(-child.pid, signal);
            return true;
          } catch {
            // The group can disappear between the timeout and the signal. The
            // direct handle remains the bounded fallback for that race.
          }
        }
        return signalChild(signal);
      };

      const timeoutResult = (settlementFailed: boolean): QualityGateCommandExecutionResult => ({
        exitCode: 1,
        output: settlementFailed
          ? `timeout after ${request.timeoutMs}ms; process settlement failed after ${PROCESS_SETTLEMENT_TIMEOUT_MS}ms`
          : `timeout after ${request.timeoutMs}ms`,
      });

      const maybeSettleTimeout = (): void => {
        if (!timedOut || settled || !closeSeen || !terminationComplete) return;
        settleResolve(timeoutResult(terminationFailed));
      };

      const forceTerminate = (): void => {
        if (process.platform === "win32") {
          // taskkill /T /F is the tree-aware Windows path. The direct handle
          // is still needed when taskkill is unavailable or times out.
          signalChild("SIGKILL");
          return;
        }
        signalProcessTree("SIGKILL");
      };

      const startTreeTermination = (): void => {
        if (terminationComplete || settled) return;

        if (process.platform === "win32" && typeof child.pid === "number" && child.pid > 0) {
          try {
            treeKiller = execFile(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              {
                timeout: PROCESS_SETTLEMENT_TIMEOUT_MS,
                windowsHide: true,
              },
              (error) => {
                terminationFailed = error !== null;
                terminationComplete = true;
                if (error !== null) signalChild("SIGKILL");
                maybeSettleTimeout();
              },
            );
            return;
          } catch {
            terminationFailed = true;
          }
        } else if (!signalProcessTree("SIGTERM")) {
          terminationFailed = true;
        }

        terminationComplete = true;
        maybeSettleTimeout();

        if (process.platform !== "win32") {
          forceTimer = setTimeout(() => {
            if (settled || !timedOut) return;
            forceTerminate();
            maybeSettleTimeout();
          }, PROCESS_FORCE_KILL_DELAY_MS);
        }
      };

      const onClose = (code: number | null): void => {
        closeSeen = true;
        if (!timedOut) {
          settleResolve({
            exitCode: code ?? 1,
            output: chunks.join(""),
          });
          return;
        }

        // A shell can close before one of its descendants has released the
        // pipes. Escalate once more before exposing a timeout projection.
        forceTerminate();
        maybeSettleTimeout();
      };

      child.stdout?.on("data", (data: Buffer) => {
        chunks.push(data.toString());
      });

      child.stderr?.on("data", (data: Buffer) => {
        chunks.push(data.toString());
      });

      timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        startTreeTermination();
        if (settled) return;
        settlementTimer = setTimeout(() => {
          if (settled) return;
          forceTerminate();
          settleResolve(timeoutResult(true));
        }, PROCESS_SETTLEMENT_TIMEOUT_MS);
      }, request.timeoutMs);

      child.on("error", (error) => {
        if (!timedOut) settleReject(error);
      });

      child.on("close", onClose);
    });
  },
};

const PROCESS_SETTLEMENT_TIMEOUT_MS = 1_000;
const PROCESS_FORCE_KILL_DELAY_MS = Math.floor(PROCESS_SETTLEMENT_TIMEOUT_MS / 2);
