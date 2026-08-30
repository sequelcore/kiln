import { spawn } from "node:child_process";
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
      });
      const chunks: string[] = [];
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settleResolve = (result: QualityGateCommandExecutionResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(result);
      };

      const settleReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        reject(error);
      };

      child.stdout?.on("data", (data: Buffer) => {
        chunks.push(data.toString());
      });

      child.stderr?.on("data", (data: Buffer) => {
        chunks.push(data.toString());
      });

      timer = setTimeout(() => {
        if (settled) return;
        child.kill();
        settleResolve({
          exitCode: 1,
          output: `timeout after ${request.timeoutMs}ms`,
        });
      }, request.timeoutMs);

      child.on("error", (error) => {
        settleReject(error);
      });

      child.on("close", (code) => {
        settleResolve({
          exitCode: code ?? 1,
          output: chunks.join(""),
        });
      });
    });
  },
};
