import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  SessionEvent,
  SessionCapabilities,
  SessionRunOptions,
  IKilnSession,
  KilnPermissionAction,
  KilnPermissionPolicy,
  KilnSandboxMode,
} from "./session.js";
import { debug } from "./debug.js";
import { SessionStore } from "./session-store.js";

interface OpencodeClientShape {
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
  config: {
    update(options?: {
      body?: {
        permission?: {
          edit?: "ask" | "allow" | "deny";
          bash?: "ask" | "allow" | "deny";
          webfetch?: "ask" | "allow" | "deny";
        };
        mcp?: Record<string, unknown>;
        experimental?: Record<string, unknown>;
      };
      query?: { directory?: string };
    }): Promise<unknown>;
  };
}

function asOpencodeClient(value: unknown): OpencodeClientShape {
  if (value === null || value === undefined) {
    throw new Error("SDK client is null or undefined");
  }
  const v = value as { session?: { create?: unknown }; global?: { event?: unknown }; config?: { update?: unknown } };
  if (typeof v.session?.create !== "function") {
    throw new Error("SDK client missing session.create");
  }
  if (typeof v.global?.event !== "function") {
    throw new Error("SDK client missing global.event");
  }
  if (typeof v.config?.update !== "function") {
    throw new Error("SDK client missing config.update");
  }
  return value as OpencodeClientShape;
}

interface McpServer {
  name: string;
  url: string;
}

interface TranslationRuleMetadata {
  readonly category: string;
  readonly selector: string;
  readonly action: string;
  readonly reason?: string;
}

interface OpenCodeNativeRuleMetadata {
  readonly tools: readonly {
    readonly tool: string;
    readonly action: KilnPermissionAction;
  }[];
  readonly commands: readonly {
    readonly pattern: string;
    readonly shell?: "bash" | "sh" | "zsh" | "any";
    readonly action: KilnPermissionAction;
  }[];
  readonly fileGovernance: {
    readonly denyGlobs: readonly string[];
    readonly askGlobs: readonly string[];
    readonly allowGlobs: readonly string[];
  };
}

export interface OpenCodeSessionConfig {
  readonly task: string;
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly mcpServers?: McpServer[];
  readonly mcpServerEntryPath?: string;
  readonly model?: string;
  readonly port?: number;
  readonly baseUrl?: string;
  readonly permissionDefault?: "ask" | "allow" | "deny";
  readonly sandboxMode?: KilnSandboxMode;
  readonly nativeRules?: OpenCodeNativeRuleMetadata;
  readonly representableRules?: readonly TranslationRuleMetadata[];
  readonly unsupportedRules?: readonly TranslationRuleMetadata[];
  readonly constraintInstructions?: readonly string[];
  readonly translationWarnings?: readonly string[];
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly resumeSessionId?: string;
}

function derivePermissionPolicy(
  permissionDefault?: string,
  sandboxMode?: KilnSandboxMode,
  fallback?: KilnPermissionPolicy,
): KilnPermissionPolicy {
  if (permissionDefault === "allow") {
    return { approval: "never", sandbox: sandboxMode ?? "read-only" };
  }
  if (permissionDefault === "deny") {
    return { approval: "untrusted", sandbox: "read-only" };
  }
  return fallback ?? { approval: "on-request", sandbox: "read-only" };
}

type OpenCodePermissionValue = "ask" | "allow" | "deny";

interface OpenCodePermissionPayload {
  edit: OpenCodePermissionValue;
  bash: OpenCodePermissionValue;
  webfetch: OpenCodePermissionValue;
}

function toOpenCodePermissionValue(action: KilnPermissionAction): OpenCodePermissionValue {
  return action;
}

function mapToolToPermissionKey(tool: string): keyof OpenCodePermissionPayload | null {
  const normalized = tool.trim().toLowerCase();
  if (normalized === "edit" || normalized === "write" || normalized === "multiedit" || normalized === "notebookedit") {
    return "edit";
  }
  if (normalized === "bash" || normalized === "command_execution" || normalized === "command") {
    return "bash";
  }
  if (normalized === "webfetch" || normalized === "web_fetch" || normalized === "fetch") {
    return "webfetch";
  }
  return null;
}

function isGlobalCommandRule(pattern: string): boolean {
  const normalized = pattern.trim();
  return normalized === "*" || normalized === "**" || normalized === "*:*";
}

function applyGranularPermissionOverrides(
  base: OpenCodePermissionPayload,
  nativeRules?: OpenCodeNativeRuleMetadata,
): OpenCodePermissionPayload {
  const next: OpenCodePermissionPayload = { ...base };
  if (!nativeRules) return next;

  for (const rule of nativeRules.tools) {
    const permissionKey = mapToolToPermissionKey(rule.tool);
    if (permissionKey !== null) {
      next[permissionKey] = toOpenCodePermissionValue(rule.action);
    }
  }

  for (const rule of nativeRules.commands) {
    if (
      isGlobalCommandRule(rule.pattern)
      && (rule.shell === undefined || rule.shell === "any" || rule.shell === "bash")
    ) {
      next.bash = toOpenCodePermissionValue(rule.action);
    }
  }

  return next;
}

function buildFileGovernanceInstructions(
  nativeRules?: OpenCodeNativeRuleMetadata,
): string[] {
  if (!nativeRules) return [];
  const lines: string[] = [];
  for (const glob of nativeRules.fileGovernance.denyGlobs) {
    lines.push(`[file-governance] DENY ${glob}`);
  }
  for (const glob of nativeRules.fileGovernance.askGlobs) {
    lines.push(`[file-governance] ASK ${glob}`);
  }
  for (const glob of nativeRules.fileGovernance.allowGlobs) {
    lines.push(`[file-governance] ALLOW ${glob}`);
  }
  if (lines.length === 0) return [];
  return ["Kiln file governance constraints for opencode:", ...lines];
}

function appendConstraintInstructions(
  prompt: string,
  constraintInstructions?: readonly string[],
  nativeRules?: OpenCodeNativeRuleMetadata,
): string {
  const sections: string[] = [prompt];
  if (constraintInstructions && constraintInstructions.length > 0) {
    sections.push(constraintInstructions.join("\n"));
  }
  const fileGovernanceInstructions = buildFileGovernanceInstructions(nativeRules);
  if (fileGovernanceInstructions.length > 0) {
    sections.push(fileGovernanceInstructions.join("\n"));
  }
  return sections.filter((section) => section.trim().length > 0).join("\n\n");
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
      resumable: config.resumeSessionId !== undefined,
      resume: config.resumeSessionId !== undefined,
      costTrackingMode: "native",
      supportedTools: [],
      maxContextTokens: null,
      priority: 2,
      fallbackTo: null,
      permissionPolicy: derivePermissionPolicy(
        config.permissionDefault,
        config.sandboxMode,
        config.permissionPolicy,
      ),
    };
    if (config.sandboxMode && config.sandboxMode !== "read-only") {
      debug(`sandboxMode=${config.sandboxMode} not supported, silently ignored`);
    }
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
      let attachSession = false;
      if (this._config.resumeSessionId !== undefined) {
        try {
          const store = new SessionStore(this._config.cwd);
          const record = await store.find(this._config.resumeSessionId);
          if (record?.remoteSessionId) {
            attachSession = true;
          }
        } catch {
          console.error("[SessionStore] Resume lookup failed, continuing without resume");
        }
      }
      if (this._config.baseUrl) {
        baseUrl = this._config.baseUrl;
      } else {
        const port = this._config.port ?? 0;
        const actualPort = await this.spawnAndWaitForServe(port, cwd, this._config.env, attachSession);
        baseUrl = `http://127.0.0.1:${actualPort}`;
      }

      const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
      const client = asOpencodeClient(createOpencodeClient({ baseUrl }));

      const approval = this._capabilities.permissionPolicy.approval;
      const permValue: OpenCodePermissionValue =
        approval === "never" ? "allow" : approval === "untrusted" ? "deny" : "ask";
      const permissionPayload = applyGranularPermissionOverrides(
        {
          edit: permValue,
          bash: permValue,
          webfetch: permValue,
        },
        this._config.nativeRules,
      );
      await client.config
        .update({
          body: { permission: permissionPayload },
          query: { directory: cwd },
        })
        .catch((err: unknown) => {
          console.debug(
            `[opencode] config.update failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      const mcpEntryPath = this._config.mcpServerEntryPath;
      if (mcpEntryPath && existsSync(mcpEntryPath)) {
        const mcpEntry: Record<string, unknown> = {
          type: "local",
          command: ["node", mcpEntryPath],
          enabled: true,
        };
        await client.config
          .update({
            body: { mcp: { kiln: mcpEntry } },
            query: { directory: cwd },
          })
          .catch((err: unknown) => {
            console.debug(
              `[opencode] MCP config.update failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      } else if (mcpEntryPath) {
        debug(`MCP server entry not found at ${mcpEntryPath}, skipping runtime MCP registration`);
      }

      await client.config
        .update({
          body: { experimental: { batch_tool: true } },
          query: { directory: cwd },
        })
        .catch((err: unknown) => {
          console.debug(
            `[opencode] batch_tool config.update failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

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
            parts: [{
              type: "text",
              text: appendConstraintInstructions(
                options.prompt,
                this._config.constraintInstructions,
                this._config.nativeRules,
              ),
            }],
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
            cost?: { amount: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (props?.type === "usage_update" && props?.cost?.amount !== undefined) {
            this._lastCostUsd = props.cost.amount;
            yield {
              type: "cost_update",
              usd: props.cost.amount,
              mode: "native" as const,
              inputTokens: props.cost.inputTokens,
              outputTokens: props.cost.outputTokens,
              cacheReadTokens: props.cost.cacheReadTokens,
            };
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

        if (event.payload.type === "session.compacted") {
          const props = event.payload.properties as {
            sessionID?: string;
            tokens?: number;
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          const output = props?.tokens !== undefined
            ? `Context compacted to approximately ${props.tokens} tokens`
            : "Context compacted";
          yield { type: "tool_result", toolName: "session.compacted", output };
          continue;
        }

        if (event.payload.type === "question.asked") {
          const props = event.payload.properties as {
            sessionID?: string;
            question?: string;
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (props?.question) {
            yield { type: "text_delta", content: `[Question] ${props.question}` };
          }
          continue;
        }

        if (event.payload.type === "mcp.tools.changed") {
          const props = event.payload.properties as {
            sessionID?: string;
            tools?: Array<{ name: string }>;
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          const toolList = props?.tools?.map((t) => t.name).join(", ") ?? "";
          yield { type: "tool_result", toolName: "mcp.tools.changed", output: toolList };
          continue;
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
      try {
        const store = new SessionStore(this._config.cwd);
        const completedAt = new Date().toISOString();
        await store.append({
          sessionId: this._remoteSessionId ?? this.sessionId,
          provider: "opencode",
          task: this._config.task,
          completedAt,
          cost: this._lastCostUsd,
          projectPath: this._config.cwd,
          remoteSessionId: this._remoteSessionId ?? undefined,
        });
      } catch (err) {
        console.error("[SessionStore] Failed to append session record:", err instanceof Error ? err.message : String(err));
      }
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
    attach?: boolean,
  ): Promise<number> {
    const opencodePath = await this._findOpencodePath();
    const args = ["serve", "--port", String(port), "--cwd", cwd];
    if (attach) args.push("--attach");
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
