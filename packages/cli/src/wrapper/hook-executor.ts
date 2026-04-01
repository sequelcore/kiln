import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import type { HookEvent, HookHandler } from "../kiln-yaml-types.js";

export interface HookContext {
  event: HookEvent;
  toolName?: string;
  sessionId?: string;
  workingDirectory: string;
}

export interface HookResult {
  handler: HookHandler;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export class HookExecutor {
  async run(handlers: readonly HookHandler[], ctx: HookContext): Promise<HookResult[]> {
    const results: HookResult[] = [];
    for (const handler of handlers) {
      const result = await this.executeHandler(handler, ctx);
      results.push(result);
    }
    return results;
  }

  private async executeHandler(handler: HookHandler, ctx: HookContext): Promise<HookResult> {
    if (handler.async) {
      return this.runAsync(handler, ctx);
    }
    return this.runSync(handler, ctx);
  }

  private runSync(handler: HookHandler, ctx: HookContext): HookResult {
    const env = {
      ...process.env,
      KILN_HOOK_EVENT: ctx.event,
      KILN_HOOK_TOOL: ctx.toolName ?? "",
      KILN_SESSION_ID: ctx.sessionId ?? "",
    };

    const timeoutMs = handler.timeoutSec ? handler.timeoutSec * 1000 : undefined;
    const options: {
      cwd: string;
      env: typeof env;
      shell: boolean;
      encoding: "utf8";
      timeout?: number;
    } = {
      cwd: ctx.workingDirectory,
      env,
      shell: true,
      encoding: "utf8",
    };

    if (timeoutMs) options.timeout = timeoutMs;

    try {
      const result = spawnSync(handler.command, [], options);
      return {
        handler,
        exitCode: result.status ?? -1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        timedOut: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        handler,
        exitCode: -1,
        stdout: "",
        stderr: errorMessage,
        timedOut: errorMessage.includes("timeout"),
      };
    }
  }

  private runAsync(handler: HookHandler, ctx: HookContext): HookResult {
    const env = {
      ...process.env,
      KILN_HOOK_EVENT: ctx.event,
      KILN_HOOK_TOOL: ctx.toolName ?? "",
      KILN_SESSION_ID: ctx.sessionId ?? "",
    };

    let proc: ChildProcess | null = null;
    let timedOut = false;

    try {
      proc = spawn(handler.command, [], {
        cwd: ctx.workingDirectory,
        env,
        shell: true,
        detached: true,
        stdio: "ignore",
      });
      proc.unref();

      if (handler.timeoutSec) {
        const timeoutMs = handler.timeoutSec * 1000;
        setTimeout(() => {
          if (proc && !proc.killed) {
            timedOut = true;
            proc.kill();
          }
        }, timeoutMs);
      }
    } catch {
      return {
        handler,
        exitCode: -1,
        stdout: "",
        stderr: "Failed to spawn process",
        timedOut: false,
      };
    }

    return {
      handler,
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut,
    };
  }
}
