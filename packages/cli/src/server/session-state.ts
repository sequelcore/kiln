import { randomUUID } from "node:crypto";
import { Orchestrator } from "@kilnai/core";
import type {
  KilnEvent,
  OrchestratorStatus,
  TaskNode,
} from "@kilnai/core";
import { SessionManager } from "../wrapper/session-manager.js";
import { ClaudeSession } from "../wrapper/claude-code-process.js";
import type { SessionMode, WrapperConfig } from "../wrapper/index.js";
import type { KilnAppConfig } from "../config.js";
import type { WSContext } from "hono/ws";
import { formatEvent } from "../formatters.js";

/** Session lifecycle status */
export type SessionStatus = "idle" | "starting" | "running" | "error" | "completed";

/** Flags passed when starting a session */
export interface SessionFlags {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly dangerouslySkipPermissions?: boolean;
}

/** WebSocket message sent to clients -- matches console protocol */
export type WsMessage = Record<string, unknown> & { readonly type: string };

/** Wire-format types matching the console protocol */
export interface WireCostSummary {
  readonly total: number;
  readonly byRole: Record<string, number>;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface WireTaskNode {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly depth: number;
  readonly children: WireTaskNode[];
}

export interface WireQualityGate {
  readonly name: string;
  readonly passed: boolean;
  readonly message?: string;
}

/** Full state snapshot sent on connect and via REST */
export interface StateSnapshot {
  readonly sessionActive: boolean;
  readonly sessionStatus: SessionStatus;
  readonly statusMessage: string;
  readonly task: string | null;
  readonly phase: string;
  readonly status: OrchestratorStatus;
  readonly cost: WireCostSummary;
  readonly events: readonly KilnEvent[];
  readonly output: readonly string[];
  readonly tasks: readonly WireTaskNode[];
  readonly workers: readonly never[];
  readonly qualityGates: readonly WireQualityGate[];
}

export interface OutputLine {
  readonly line: string;
  readonly stream: "stdout" | "stderr";
  readonly timestamp: number;
}

/**
 * In-memory session state manager.
 * Single-session: one Claude Code session at a time.
 * Uses the Claude Agent SDK for subprocess management.
 */
export class SessionState {
  private readonly clients = new Set<WSContext>();
  private orchestrator: Orchestrator | null = null;
  private manager: SessionManager | null = null;
  private session: ClaudeSession | null = null;
  private sessionId: string | null = null;
  private task: string | null = null;
  private _sessionStatus: SessionStatus = "idle";
  private _statusMessage = "";
  private readonly events: KilnEvent[] = [];
  private readonly outputLines: OutputLine[] = [];
  private readonly appConfig: KilnAppConfig | undefined;

  private static readonly MAX_OUTPUT_LINES = 500;
  private static readonly MAX_EVENTS = 200;

  constructor(appConfig?: KilnAppConfig) {
    this.appConfig = appConfig;
  }

  addClient(ws: WSContext): void {
    this.clients.add(ws);
  }

  removeClient(ws: WSContext): void {
    this.clients.delete(ws);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get sessionStatus(): SessionStatus {
    return this._sessionStatus;
  }

  get isSessionActive(): boolean {
    return this._sessionStatus === "starting" || this._sessionStatus === "running";
  }

  snapshot(): StateSnapshot {
    const coreCost = this.orchestrator?.costSummary;
    const coreNodes = this.orchestrator?.tree.allNodes ?? [];

    return {
      sessionActive: this.isSessionActive,
      sessionStatus: this._sessionStatus,
      statusMessage: this._statusMessage,
      task: this.task,
      phase: this.orchestrator?.currentPhase ?? "idle",
      status: this.orchestrator?.status ?? "idle",
      cost: {
        total: coreCost?.totalCostUsd ?? 0,
        inputTokens: coreCost?.totalInputTokens ?? 0,
        outputTokens: coreCost?.totalOutputTokens ?? 0,
        byRole: coreCost
          ? Object.fromEntries(
              Object.entries(coreCost.byRole).map(([role, usage]) => [
                role,
                (usage.inputTokens + usage.outputTokens) * 0.00001,
              ]),
            )
          : {},
      },
      events: this.events,
      output: this.outputLines.map((o) => o.line),
      tasks: coreNodes.map((n) => toWireTask(n)),
      workers: [],
      qualityGates: [],
    };
  }

  startSession(task: string, flags: SessionFlags = {}): void {
    if (this.isSessionActive) {
      throw new SessionConflictError("A session is already running");
    }

    if (!flags.apiKey) {
      throw new Error(
        "An API key is required. Anthropic's ToS prohibits OAuth/subscription credentials in third-party tools. " +
        "Pass --api-key or set ANTHROPIC_API_KEY.",
      );
    }

    // Clean up any previous session state
    this.events.length = 0;
    this.outputLines.length = 0;

    this.setStatus("starting", "Initializing Claude Code session...");

    const mode = resolveMode(flags);
    const config = buildConfig(flags, mode);

    if (!this.appConfig) {
      throw new Error("KilnAppConfig is required to start a session");
    }

    this.manager = new SessionManager(config, this.appConfig);
    this.task = task;
    this.sessionId = randomUUID();

    let context;
    try {
      context = this.manager.prepare(task, process.cwd());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("error", message);
      this.broadcast({ type: "error", message });
      throw err;
    }

    this.orchestrator = new Orchestrator();
    this.orchestrator.eventBus.onAny((event: KilnEvent) => {
      this.pushEvent(event);
    });

    // Build env for the SDK session
    const env: Record<string, string> = {};
    if (config.mode === "api-key" && config.apiKey) {
      env.ANTHROPIC_API_KEY = config.apiKey;
    }
    if (config.mode === "byok" && config.provider && config.apiKey) {
      const providerUpper = config.provider.toUpperCase();
      env[`${providerUpper}_API_KEY`] = config.apiKey;
    }

    // Create SDK session
    this.session = new ClaudeSession({
      task,
      systemPrompt: context.systemPrompt,
      mcpServers: {
        [this.appConfig.mcpServerName]: {
          command: "bun",
          args: ["run", context.mcpServerEntryPath],
        },
      },
      cwd: process.cwd(),
      env,
      permissionMode: config.dangerouslySkipPermissions ? "bypassPermissions" : "default",
      allowDangerouslySkipPermissions: config.dangerouslySkipPermissions,
    });

    this.session.onMessage((msg) => this.handleSdkMessage(msg));
    this.session.onExit((code, costUsd) => {
      this.manager?.cleanup(this.sessionId!);
      const costStr = costUsd > 0 ? ` (cost: $${costUsd.toFixed(4)})` : "";
      this.setStatus("completed", `Session completed${costStr}`);
      this.broadcast({ type: "exit", code });
      this.session = null;
      console.log(`[session] Session ended (exit code ${code})${costStr}`);
    });

    // Start async -- don't await
    this.session.start().catch((err) => {
      console.error("[session] Unhandled session error:", err);
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("error", message);
      this.broadcast({ type: "error", message });
    });

    console.log(`[session] Claude Code session started -- task: "${task}"`);
    this.setStatus("running", "Session active");
    this.broadcast({ type: "session_started", sessionId: this.sessionId });
  }

  stopSession(): void {
    if (this.session) {
      this.session.stop();
    }
  }

  private setStatus(status: SessionStatus, message: string): void {
    this._sessionStatus = status;
    this._statusMessage = message;
    this.broadcast({ type: "session_status", status, message });
  }

  /**
   * Map SDK messages to dashboard output lines.
   * Handles all SDKMessage variants and emits formatted text.
   * Public for testing -- called internally by the SDK message handler.
   */
  handleSdkMessage(message: Record<string, unknown>): void {
    switch (message.type) {
      case "system": {
        const subtype = (message as { subtype?: string }).subtype;
        if (subtype === "init") {
          const sysMsg = message as {
            model?: string;
            mcp_servers?: Array<{ name: string; status: string }>;
          };
          if (sysMsg.model) {
            this.emitOutputLine(`[system] Model: ${sysMsg.model}`, "stdout");
          }
          if (sysMsg.mcp_servers) {
            for (const s of sysMsg.mcp_servers) {
              this.emitOutputLine(`[system] MCP: ${s.name} (${s.status})`, "stdout");
            }
          }
        } else if (subtype === "task_started") {
          const taskMsg = message as { description?: string };
          this.emitOutputLine(`[task] Started: ${taskMsg.description ?? "unknown"}`, "stdout");
        } else if (subtype === "task_notification") {
          const taskMsg = message as { status?: string; summary?: string };
          this.emitOutputLine(
            `[task] ${taskMsg.status ?? "done"}: ${taskMsg.summary ?? ""}`,
            "stdout",
          );
        } else if (subtype === "status") {
          const statusMsg = message as { status?: string };
          if (statusMsg.status === "compacting") {
            this.emitOutputLine("[system] Compacting context...", "stdout");
          }
        }
        break;
      }

      case "assistant": {
        const assMsg = message as {
          message?: {
            content?: Array<{
              type: string;
              text?: string;
              name?: string;
              input?: unknown;
            }>;
          };
        };
        if (assMsg.message?.content) {
          for (const block of assMsg.message.content) {
            if (block.type === "text" && block.text) {
              this.emitOutputLine(block.text, "stdout");
            } else if (block.type === "tool_use" && block.name) {
              const inputPreview = block.input
                ? JSON.stringify(block.input).slice(0, 100)
                : "";
              this.emitOutputLine(
                `[tool] ${block.name}${inputPreview ? `: ${inputPreview}` : ""}`,
                "stdout",
              );
            }
          }
        }
        break;
      }

      case "result": {
        const resultMsg = message as {
          subtype?: string;
          result?: string;
          total_cost_usd?: number;
          duration_ms?: number;
          errors?: string[];
        };
        if (resultMsg.subtype === "success" && resultMsg.result) {
          this.emitOutputLine("--- Result ---", "stdout");
          this.emitOutputLine(resultMsg.result, "stdout");
        }
        if (resultMsg.subtype?.startsWith("error")) {
          const errors = resultMsg.errors ?? [];
          for (const e of errors) {
            this.emitOutputLine(`[error] ${e}`, "stderr");
          }
        }
        const parts: string[] = [];
        if (resultMsg.total_cost_usd !== undefined) {
          parts.push(`$${resultMsg.total_cost_usd.toFixed(4)}`);
        }
        if (resultMsg.duration_ms !== undefined) {
          parts.push(`${(resultMsg.duration_ms / 1000).toFixed(1)}s`);
        }
        if (parts.length > 0) {
          this.emitOutputLine(`[session] Completed: ${parts.join(", ")}`, "stdout");
        }
        break;
      }

      case "tool_progress": {
        const toolMsg = message as { tool_name?: string; elapsed_time_seconds?: number };
        if (toolMsg.tool_name) {
          const elapsed = toolMsg.elapsed_time_seconds
            ? ` (${toolMsg.elapsed_time_seconds.toFixed(0)}s)`
            : "";
          this.emitOutputLine(`[tool progress] ${toolMsg.tool_name}${elapsed}`, "stdout");
        }
        break;
      }

      case "tool_use_summary": {
        const summaryMsg = message as { summary?: string };
        if (summaryMsg.summary) {
          this.emitOutputLine(`[tool summary] ${summaryMsg.summary}`, "stdout");
        }
        break;
      }

      case "auth_status": {
        const authMsg = message as { isAuthenticating?: boolean; error?: string };
        if (authMsg.error) {
          this.emitOutputLine(`[auth] Error: ${authMsg.error}`, "stderr");
        } else if (authMsg.isAuthenticating) {
          this.emitOutputLine("[auth] Authenticating...", "stdout");
        }
        break;
      }

      // user, stream_event, and other types are not displayed
      default:
        break;
    }
  }

  /** Emit a single output line and broadcast to clients. */
  emitOutputLine(text: string, stream: "stdout" | "stderr"): void {
    const outputLine: OutputLine = {
      line: text,
      stream,
      timestamp: Date.now(),
    };

    this.outputLines.push(outputLine);
    if (this.outputLines.length > SessionState.MAX_OUTPUT_LINES) {
      this.outputLines.shift();
    }

    this.broadcast({ type: "output", stream, text });
  }

  private pushEvent(event: KilnEvent): void {
    this.events.push(event);
    if (this.events.length > SessionState.MAX_EVENTS) {
      this.events.shift();
    }

    this.broadcast({
      type: "event",
      event: formatEvent(event),
      data: event as unknown as Record<string, unknown>,
    });
  }

  broadcast(msg: WsMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients) {
      try {
        client.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}

export class SessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConflictError";
  }
}

/** Map core TaskStatus to wire-format status */
const TASK_STATUS_MAP: Record<string, string> = {
  proposed: "pending",
  testing: "in_progress",
  supported: "completed",
  refuted: "failed",
  rejected: "pruned",
  revised: "pending",
};

function toWireTask(node: TaskNode): WireTaskNode {
  return {
    id: node.id,
    label: node.statement,
    status: TASK_STATUS_MAP[node.status] ?? "pending",
    depth: node.depth,
    children: [],
  };
}

function resolveMode(flags: SessionFlags): SessionMode {
  if (flags.apiKey && flags.provider) return "byok";
  return "api-key";
}

function buildConfig(flags: SessionFlags, mode: SessionMode): WrapperConfig {
  return {
    mode,
    apiKey: flags.apiKey,
    provider: flags.provider,
    claudeCodePath: "claude",
    dangerouslySkipPermissions: flags.dangerouslySkipPermissions ?? false,
    sandbox: true,
    autoApprove: false,
    autoApproveTimeout: 30000,
  };
}
