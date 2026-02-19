/**
 * Claude Code session using the official Agent SDK.
 *
 * Replaces the previous subprocess approach that failed due to
 * Claude Code requiring a TTY. The SDK handles subprocess lifecycle
 * internally via its `query()` function.
 *
 * See: https://github.com/anthropics/claude-code/issues/771
 */

type SDKMessage = import("@anthropic-ai/claude-agent-sdk").SDKMessage;
type Options = import("@anthropic-ai/claude-agent-sdk").Options;
type Query = import("@anthropic-ai/claude-agent-sdk").Query;

type MessageHandler = (message: SDKMessage) => void;
type ExitHandler = (exitCode: number, costUsd: number) => void;

/** Configuration for a Claude Code SDK session. */
export interface ClaudeSessionConfig {
  readonly task: string;
  readonly systemPrompt: string;
  readonly mcpServers?: Options["mcpServers"];
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  readonly allowDangerouslySkipPermissions?: boolean;
}

/**
 * Wraps the Claude Agent SDK `query()` function with an event-based API.
 *
 * Usage:
 *   const session = new ClaudeSession(config);
 *   session.onMessage((msg) => { ... });
 *   session.onExit((code, cost) => { ... });
 *   await session.start();
 */
export class ClaudeSession {
  private queryInstance: Query | null = null;
  private abortController: AbortController | null = null;
  private readonly messageHandlers: MessageHandler[] = [];
  private readonly exitHandlers: ExitHandler[] = [];
  private _isRunning = false;

  constructor(private readonly config: ClaudeSessionConfig) {}

  /** Start the SDK query. Resolves when the session ends. */
  async start(): Promise<void> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    this._isRunning = true;
    this.abortController = new AbortController();

    const env: Record<string, string | undefined> = { ...process.env };
    if (this.config.env) {
      Object.assign(env, this.config.env);
    }

    const options: Options = {
      abortController: this.abortController,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: this.config.systemPrompt,
      },
      mcpServers: this.config.mcpServers,
      cwd: this.config.cwd,
      env,
      includePartialMessages: false,
      permissionMode: this.config.permissionMode ?? "default",
      allowDangerouslySkipPermissions: this.config.allowDangerouslySkipPermissions,
      settingSources: ["project"],
      stderr: (data: string) => {
        console.error(`[claude:stderr] ${data.trimEnd()}`);
      },
    };

    const queryInstance = query({
      prompt: this.config.task,
      options,
    });
    this.queryInstance = queryInstance;

    let totalCostUsd = 0;
    try {
      for await (const message of queryInstance) {
        for (const handler of this.messageHandlers) {
          try {
            handler(message);
          } catch (err) {
            console.error("[claude:session] handler error:", err);
          }
        }
        if (message.type === "result") {
          totalCostUsd = message.total_cost_usd;
        }
      }
      this._isRunning = false;
      for (const handler of this.exitHandlers) {
        handler(0, totalCostUsd);
      }
    } catch (err) {
      this._isRunning = false;
      console.error("[claude:session] error:", err);
      for (const handler of this.exitHandlers) {
        handler(1, totalCostUsd);
      }
    }
  }

  /** Stop the session by closing the SDK query. */
  stop(): void {
    if (this.queryInstance) {
      this.queryInstance.close();
      this.queryInstance = null;
    }
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Register callback for each SDK message. */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /** Register callback for when the session ends. */
  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler);
  }
}
