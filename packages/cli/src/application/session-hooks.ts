import { HookExecutor, HookRegistry } from "../wrapper/index.js";
import type { KilnHooksConfig } from "../kiln-yaml-types.js";

type SupportedHookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd";

interface SessionHooksOptions {
  readonly sessionId: string;
  readonly workingDirectory: string;
}

export class SessionHooks {
  private readonly registry: HookRegistry;
  private readonly executor: HookExecutor;
  private readonly sessionId: string;
  private readonly workingDirectory: string;

  constructor(config: KilnHooksConfig | undefined, options: SessionHooksOptions) {
    this.registry = new HookRegistry(config ?? {});
    this.executor = new HookExecutor();
    this.sessionId = options.sessionId;
    this.workingDirectory = options.workingDirectory;
  }

  sessionStart(): void {
    this.fire("SessionStart");
  }

  sessionEnd(): void {
    this.fire("SessionEnd");
  }

  userPromptSubmit(): void {
    this.fire("UserPromptSubmit");
  }

  preToolUse(toolName: string): void {
    this.fire("PreToolUse", toolName);
  }

  postToolUse(toolName: string): void {
    this.fire("PostToolUse", toolName);
  }

  private fire(event: SupportedHookEvent, toolName?: string): void {
    const handlers = this.registry.getRules(event, toolName);
    if (handlers.length === 0) return;

    this.executor
      .run(handlers, {
        event,
        toolName,
        sessionId: this.sessionId,
        workingDirectory: this.workingDirectory,
      })
      .then((results) => {
        for (const result of results) {
          if (result.exitCode !== 0) {
            console.error(`[hook:${event}] non-zero exit ${result.exitCode} from: ${result.handler.command}`);
            if (result.stderr) {
              console.error(`[hook:${event}] stderr: ${result.stderr.trim()}`);
            }
          }
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[hook:${event}] hook execution failed: ${message}`);
      });
  }
}
