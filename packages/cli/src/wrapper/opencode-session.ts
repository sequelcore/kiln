import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  SessionEvent,
  SessionCapabilities,
  SessionRunOptions,
  IKilnSession,
} from "./session.js";

interface OpencodeClient {
  session: {
    create(
      params: { directory?: string },
      options?: { throwOnError?: boolean },
    ): Promise<{ data?: { id: string } }>;
    prompt(
      params: {
        sessionID: string;
        parts?: Array<{ type: "text"; text: string }>;
        directory?: string;
      },
      options?: { throwOnError?: boolean },
    ): Promise<{
      data?: {
        info: { cost: number; stopReason?: string };
      };
    }>;
    abort(
      params: { sessionID: string; directory?: string },
      options?: { throwOnError?: boolean },
    ): Promise<unknown>;
  };
  global: {
    event(options?: {
      signal?: AbortSignal;
    }): Promise<{
      stream: AsyncGenerator<{
        directory: string;
        payload: { type: string; properties?: Record<string, unknown> };
      }>;
    }>;
  };
}

function asOpencodeClient(value: unknown): OpencodeClient {
  if (value === null || value === undefined) {
    throw new Error("SDK client is null or undefined");
  }
  const v = value as { session?: { create?: unknown }; global?: { event?: unknown } };
  if (typeof v.session?.create !== "function") {
    throw new Error("SDK client missing session.create");
  }
  if (typeof v.global?.event !== "function") {
    throw new Error("SDK client missing global.event");
  }
  return value as OpencodeClient;
}

interface McpServer {
  name: string;
  url: string;
}

export interface OpenCodeSessionConfig {
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly mcpServers?: McpServer[];
  readonly model?: string;
  readonly port?: number;
  readonly baseUrl?: string;
}

interface MutableCapabilities {
  supportedTools: readonly string[];
}

export class OpenCodeSession implements IKilnSession {
  readonly sessionId: string;
  serveProcess: ReturnType<typeof spawn> | null = null;

  private readonly _config: OpenCodeSessionConfig;
  private readonly _capabilities: MutableCapabilities & Omit<SessionCapabilities, "supportedTools">;
  private _remoteSessionId: string | null = null;
  private _lastCostUsd = 0;
  private _abortController: AbortController | null = null;
  private _eventAbortController: AbortController | null = null;
  private _disposed = false;

  constructor(config: OpenCodeSessionConfig) {
    this.sessionId = randomUUID();
    this._config = config;
    this._capabilities = {
      mcp: true,
      streaming: true,
      resume: false,
      costTrackingMode: "native",
      supportedTools: [],
      maxContextTokens: null,
      priority: 2,
      fallbackTo: null,
    };
  }

  get capabilities(): SessionCapabilities {
    return this._capabilities;
  }

  async *run(options: SessionRunOptions): AsyncIterable<SessionEvent> {
    if (this._disposed) return;
    const startTime = Date.now();
    const abortController = new AbortController();
    this._abortController = abortController;
    const cwd = options.cwd ?? this._config.cwd;

    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        abortController.abort();
      } else {
        options.abortSignal.addEventListener(
          "abort",
          () => {
            abortController.abort();
            this._killServeProcess();
          },
          { once: true },
        );
      }
    }

    try {
      let baseUrl: string;
      if (this._config.baseUrl) {
        baseUrl = this._config.baseUrl;
      } else {
        const port = this._config.port ?? 0;
        const actualPort = await this.spawnAndWaitForServe(port, cwd, this._config.env);
        baseUrl = `http://127.0.0.1:${actualPort}`;
      }

      const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
      const client = asOpencodeClient(createOpencodeClient({ baseUrl }));

      const createResult = await client.session.create(
        { directory: cwd },
        { throwOnError: true },
      );
      this._remoteSessionId = createResult.data!.id;

      this._eventAbortController = new AbortController();
      const eventStreamPromise = client.global.event({
        signal: this._eventAbortController.signal,
      });

      const eventQueue: Array<{
        directory: string;
        payload: { type: string; properties?: Record<string, unknown> };
      }> = [];
      let eventYield: (
        value: {
          directory: string;
          payload: { type: string; properties?: Record<string, unknown> };
        } | null,
      ) => void = () => {};
      const eventDone = new Set<() => void>();

      eventStreamPromise
        .then(async ({ stream }) => {
          try {
            for await (const event of stream) {
              if (this._eventAbortController?.signal.aborted) break;
              if (eventYield) {
                const yieldFn = eventYield;
                eventYield = () => {};
                yieldFn(event);
              } else {
                eventQueue.push(event);
              }
            }
            for (const doneFn of eventDone) doneFn();
          } catch {
            for (const doneFn of eventDone) doneFn();
          }
        })
        .catch(() => {
          for (const doneFn of eventDone) doneFn();
        });

      const waitForEvent = (): Promise<{
        directory: string;
        payload: { type: string; properties?: Record<string, unknown> };
      } | null> => {
        if (eventQueue.length > 0) return Promise.resolve(eventQueue.shift()!);
        return new Promise((resolve) => {
          const yieldFn = (event: {
            directory: string;
            payload: { type: string; properties?: Record<string, unknown> };
          } | null) => resolve(event);
          eventYield = yieldFn;
          eventDone.add(() => resolve(null));
        });
      };

      const promptResult = await client.session
        .prompt(
          {
            sessionID: this._remoteSessionId,
            parts: [{ type: "text", text: options.prompt }],
            directory: cwd,
          },
          { throwOnError: false },
        )
        .catch(() => ({ data: undefined }));

      this._lastCostUsd = promptResult?.data?.info?.cost ?? this._lastCostUsd;

      while (true) {
        const event = await waitForEvent();
        if (!event) break;

        if (event.payload.type === "sessionUpdate") {
          const props = event.payload.properties as {
            sessionID?: string;
            type?: string;
            cost?: { amount: number };
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (props?.type === "usage_update" && props?.cost?.amount !== undefined) {
            this._lastCostUsd = props.cost.amount;
            yield { type: "cost_update", usd: props.cost.amount, mode: "native" as const };
          }
          continue;
        }

        if (event.payload.type === "message.part.delta") {
          const props = event.payload.properties as {
            sessionID?: string;
            field?: string;
            delta?: string;
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (props?.field === "text" && props?.delta) {
            yield { type: "text_delta", content: props.delta };
          }
          continue;
        }

        if (event.payload.type === "message.part.updated") {
          const props = event.payload.properties as {
            sessionID?: string;
            part?: {
              type?: string;
              callID?: string;
              tool?: string;
              state?: {
                status?: string;
                input?: Record<string, unknown>;
                output?: string;
                title?: string;
                error?: string;
                metadata?: Record<string, unknown>;
              };
            };
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (!props?.part) continue;

          const part = props.part;
          if (part.type === "tool") {
            if (part.state?.status === "pending" || part.state?.status === "running") {
              yield {
                type: "tool_use",
                toolName: part.tool ?? "unknown",
                input: part.state?.input ?? {},
              };
            } else if (part.state?.status === "completed") {
              const output = part.state?.output;
              const outputStr =
                output !== undefined
                  ? output
                  : part.state?.metadata?.output !== undefined
                    ? String(part.state.metadata.output)
                    : "";
              yield {
                type: "tool_result",
                toolName: part.tool ?? "unknown",
                output: outputStr,
              };
            } else if (part.state?.status === "error") {
              yield {
                type: "tool_result",
                toolName: part.tool ?? "unknown",
                output: part.state.error ?? "Tool failed",
              };
            }
          }
          continue;
        }

        if (event.payload.type === "session.status") {
          const props = event.payload.properties as {
            sessionID?: string;
            status?: { type?: string };
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (props?.status?.type === "idle") {
            break;
          }
        }
      }

      const stopReason = promptResult?.data?.info?.stopReason;
      const isError = stopReason === "cancelled";
      yield {
        type: "completed",
        totalUsd: this._lastCostUsd,
        durationMs: Date.now() - startTime,
        isError,
        isPreflightCrash: false,
      };
    } catch (err) {
      yield {
        type: "error",
        code: "OPENCODE_ERROR",
        message: err instanceof Error ? err.message : String(err),
        isRetryable: false,
      };
    } finally {
      this._abortController = null;
      this._eventAbortController?.abort();
      this._eventAbortController = null;
    }
  }

  async spawnAndWaitForServe(
    port: number,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<number> {
    const opencodePath = await this._findOpencodePath();
    const args = ["serve", "--port", String(port), "--cwd", cwd];
    const spawnEnv = { ...process.env, ...env };

    const proc = spawn(opencodePath, args, {
      cwd,
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this.serveProcess = proc;

    let actualPort = port;
    const portRegex = /Listening on (?:http:\/\/)?[^:]*:(\d+)/;

    const portPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("opencode serve failed to start within 10 seconds"));
      }, 10_000);

      const handleData = (data: Buffer) => {
        const line = data.toString();
        const match = line.match(portRegex);
        if (match?.[1]) actualPort = parseInt(match[1], 10);
        if (line.includes("Listening on")) {
          clearTimeout(timeout);
          proc.stdout?.removeListener("data", handleData);
          resolve();
        }
      };

      proc.stdout?.on("data", handleData);

      proc.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn opencode serve: ${err.message}`));
      });

      proc.on("exit", (code: number | null) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`opencode serve exited with code ${code}`));
        }
      });
    });

    await portPromise;
    return actualPort;
  }

  private async _findOpencodePath(): Promise<string> {
    const candidates = ["opencode", "opencode.exe"];

    for (const candidate of candidates) {
      try {
        const output = await new Promise<string>((resolve, reject) => {
          const proc = spawn(candidate, ["--version"], {
            stdio: "ignore",
          });
          let out = "";
          proc.stdout?.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.on("close", (code: number | null) => {
            if (code === 0) resolve(out.trim());
            else reject(new Error("exit " + code));
          });
          proc.on("error", () => reject(new Error("not found")));
        });
        if (output) return candidate;
      } catch {
        // try next
      }
    }

    throw new Error(
      "opencode binary not found in PATH. Ensure opencode is installed and accessible.",
    );
  }

  private _killServeProcess(): void {
    if (this.serveProcess && !this.serveProcess.killed) {
      this.serveProcess.kill("SIGTERM");
    }
  }

  async dispose(): Promise<void> {
    this._disposed = true;
    this._abortController?.abort();
    this._eventAbortController?.abort();
    this._killServeProcess();
    this.serveProcess = null;
  }
}
