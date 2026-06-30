import type { ExecutionSessionEvent, ExecutionSessionRunOptions } from "@kilnai/core";
import type { OperatorSurfaceController } from "../operator/operator-surface-controller.js";

export interface CliSession {
  run(options: ExecutionSessionRunOptions): AsyncIterable<ExecutionSessionEvent>;
  dispose(): Promise<void>;
}

export interface CliSessionFactoryContext {
  readonly kilnSessionId?: string;
  readonly operatorSurface?: OperatorSurfaceController;
  readonly permissionPolicy?: {
    readonly approval: "never" | "on-request" | "on-failure" | "untrusted";
    readonly sandbox: "read-only" | "workspace-write" | "danger-full-access";
  };
}

/**
 * Factory injected by the CLI command. Creates a fresh one-shot CLI session per turn.
 * @param systemPrompt The assembled system prompt (memory + context already injected).
 * @param cwd Working directory for the subprocess.
 */
export type CliSessionFactory = (systemPrompt: string, cwd: string, context?: CliSessionFactoryContext) => CliSession;

/**
 * Event callback for streaming CLI subprocess events to the TUI.
 * The executor fires this for each event from the CLI session.
 */
export type ExecutionSessionEventCallback = (event: ExecutionSessionEvent) => void;
