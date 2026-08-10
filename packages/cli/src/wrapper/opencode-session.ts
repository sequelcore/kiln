import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  admitDeliberationForExecution,
  appendExecutionIdentity,
  resolveExecutionIdentity,
  type ExecutionSessionEvent,
} from "@kilnai/core";
import type {
  SessionCapabilities,
  SessionRunOptions,
  IKilnSession,
  KilnPermissionAction,
  KilnPermissionPolicy,
  KilnSandboxMode,
} from "./session.js";
import { NativeToolEventIdentity } from "./session.js";
import { normalizeMcpSelector } from "./mcp-selector.js";
import { debug } from "./debug.js";
import { SessionStore } from "./session-store.js";
import { deriveSessionMetadata } from "../application/session-metadata.js";
import { resolveNativeCliExecutable } from "./native-cli-executable.js";

interface OpencodeClientShape {
  session: {
    create(
      params: { directory?: string; permission?: OpenCodePermissionRule[] },
      options?: { throwOnError?: boolean },
    ): Promise<{ data?: { id: string } }>;
    update(
      params: { sessionID: string; directory?: string; permission?: OpenCodePermissionRule[] },
      options?: { throwOnError?: boolean },
    ): Promise<{ data?: { id: string } }>;
    get(
      params: { sessionID: string; directory?: string },
      options?: { throwOnError?: boolean },
    ): Promise<{ data?: { id: string; time?: { created: number } } }>;
    prompt(
      params: {
        sessionID: string;
        parts?: Array<{ type: "text"; text: string }>;
        model?: { providerID: string; modelID: string };
        directory?: string;
      },
      options?: { throwOnError?: boolean },
    ): Promise<{
      data?: {
        info: { cost: number; stopReason?: string };
        parts?: unknown[];
      };
    }>;
    messages(
      params: { sessionID: string; directory?: string; limit?: number },
      options?: { throwOnError?: boolean },
    ): Promise<{
      data?: Array<{
        info?: { role?: string; time?: { created?: number; completed?: number } };
        parts?: unknown[];
      }>;
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
      config?: {
        permission?: {
          "*"?: "ask" | "allow" | "deny";
          edit?: "ask" | "allow" | "deny";
          bash?: "ask" | "allow" | "deny";
          webfetch?: "ask" | "allow" | "deny";
        };
        mcp?: Record<string, unknown>;
        experimental?: Record<string, unknown>;
      };
      directory?: string;
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
  readonly runtimeSessionId?: string;
  readonly task: string;
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly mcpServers?: Readonly<Record<string, Record<string, unknown>>>;
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
  readonly continuationSessionId?: string;
  readonly sessionLedgerOwner?: "wrapper" | "host";
}

const OPENCODE_SANDBOX_WARNING =
  "OpenCode does not natively enforce Kiln sandbox modes; Kiln maps sandbox intent to permission prompting semantics only.";

function inferOpenCodeBillingMode(
  model: string | undefined,
): "free" | "unknown" {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.endsWith(":free") || normalized.endsWith("-free")) {
    return "free";
  }
  return "unknown";
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

function collectRuntimeWarnings(config: OpenCodeSessionConfig): string[] {
  const warnings = new Set(config.translationWarnings ?? []);
  if (config.sandboxMode && config.sandboxMode !== "read-only") {
    warnings.add(
      `OpenCode sandbox mode '${config.sandboxMode}' is not natively enforced; using permission prompting semantics only.`,
    );
  }
  if (warnings.size === 0 && config.sandboxMode !== undefined) {
    warnings.add(OPENCODE_SANDBOX_WARNING);
  }
  return [...warnings];
}

type OpenCodePermissionValue = "ask" | "allow" | "deny";

interface OpenCodePermissionPayload {
  "*": OpenCodePermissionValue;
  edit: OpenCodePermissionValue;
  bash: OpenCodePermissionValue;
  webfetch: OpenCodePermissionValue;
}

interface OpenCodePermissionRule {
  readonly permission: string;
  readonly pattern: string;
  readonly action: OpenCodePermissionValue;
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

function toPermissionPayload(config: OpenCodeSessionConfig): OpenCodePermissionPayload {
  const approval = derivePermissionPolicy(
    config.permissionDefault,
    config.sandboxMode,
    config.permissionPolicy,
  ).approval;
  const permValue: OpenCodePermissionValue =
    approval === "never" ? "allow" : approval === "untrusted" ? "deny" : "ask";
  return applyGranularPermissionOverrides(
    {
      "*": permValue,
      edit: permValue,
      bash: permValue,
      webfetch: permValue,
    },
    config.nativeRules,
  );
}

function toSessionPermissionRules(config: OpenCodeSessionConfig): OpenCodePermissionRule[] {
  return Object.entries(toPermissionPayload(config)).map(([permission, action]) => ({
    permission,
    pattern: "*",
    action,
  }));
}

function asJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${label} must be a JSON object when provided`);
}

function buildOpenCodeMcpEntry(config: OpenCodeSessionConfig): Record<string, unknown> | undefined {
  const mcpEntryPath = config.mcpServerEntryPath;
  if (!mcpEntryPath || !existsSync(mcpEntryPath)) {
    return undefined;
  }
  return {
    type: "local",
    command: ["node", mcpEntryPath],
    enabled: true,
  };
}

function mergeRecordField(
  base: Record<string, unknown>,
  runtime: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  if (base[field] === undefined && runtime[field] === undefined) {
    return undefined;
  }
  return {
    ...(base[field] === undefined ? {} : asJsonObject(base[field], field)),
    ...(runtime[field] === undefined ? {} : asJsonObject(runtime[field], field)),
  };
}

function mergeOpenCodeRuntimeConfig(
  base: Record<string, unknown>,
  runtime: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base, ...runtime };
  // Permission is session authority, so ambient rules must not survive beside Kiln's wildcard policy.
  for (const field of ["mcp", "experimental"]) {
    const value = mergeRecordField(base, runtime, field);
    if (value !== undefined) {
      merged[field] = value;
    }
  }
  return merged;
}

export function buildOpenCodeRuntimeConfigContent(config: OpenCodeSessionConfig): string {
  const document: Record<string, unknown> = {
    permission: toPermissionPayload(config),
    experimental: { batch_tool: true },
  };

  const nativeModel = parseOpenCodeModel(config.model);
  if (nativeModel) {
    document.model = `${nativeModel.providerID}/${nativeModel.modelID}`;
  }

  const mcpEntry = buildOpenCodeMcpEntry(config);
  const mcp = {
    ...(config.mcpServers ?? {}),
    ...(mcpEntry ? { kiln: mcpEntry } : {}),
  };
  if (Object.keys(mcp).length > 0) {
    document.mcp = mcp;
  }

  return JSON.stringify(document);
}

export function buildOpenCodeRuntimeConfigEnv(
  env: Record<string, string | undefined> | undefined,
  config: OpenCodeSessionConfig,
): Record<string, string | undefined> {
  const runtimeConfig = JSON.parse(buildOpenCodeRuntimeConfigContent(config)) as Record<string, unknown>;
  const existingRaw = env?.OPENCODE_CONFIG_CONTENT;
  if (existingRaw === undefined || existingRaw.trim().length === 0) {
    return {
      ...(env ?? {}),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(runtimeConfig),
    };
  }

  let existing: Record<string, unknown>;
  try {
    existing = asJsonObject(JSON.parse(existingRaw), "OPENCODE_CONFIG_CONTENT");
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("OPENCODE_CONFIG_CONTENT must be valid JSON when provided");
    }
    throw error;
  }

  return {
    ...(env ?? {}),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(mergeOpenCodeRuntimeConfig(existing, runtimeConfig)),
  };
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

/**
 * Applies an explicit per-call system override supplied by a caller that
 * owns a correctly-governed per-turn value at call time (e.g. the runtime
 * orchestrator's EffectivePromptManifest). CLI-side callers must not supply
 * a prepared/pre-rendered snapshot here.
 */
function appendPreparedSystemContext(prompt: string, systemPrompt?: string): string {
  const system = systemPrompt?.trim();
  if (!system) {
    return prompt;
  }
  return `${prompt}\n\n--- Kiln Prepared System Context ---\n${system}`;
}

function appendTaskReminder(prompt: string, governedPrompt: string): string {
  const task = extractPreambleTask(governedPrompt);
  if (!task) {
    return prompt;
  }
  return `${prompt}\n\n--- Kiln Task To Execute Now ---\n${task}\n\nExecute the task above in this turn. Do not ask the operator for another task unless required information is genuinely missing.`;
}

function extractPreambleTask(prompt: string): string | undefined {
  const match = prompt.match(/<task>([\s\S]*?)<\/task>/u);
  const task = match?.[1]?.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
  return task && task.length > 0 ? task : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const texts: string[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type !== "text") continue;
    if (part.ignored === true) continue;
    if (typeof part.text === "string" && part.text.length > 0) {
      texts.push(part.text);
    }
  }
  return texts.join("\n").trim();
}

function extractAssistantTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const assistantMessages = messages
    .filter((message): message is { info?: { role?: string; time?: { created?: number; completed?: number } }; parts?: unknown[] } =>
      isRecord(message) && isRecord(message.info) && message.info.role === "assistant",
    )
    .sort((a, b) => {
      const aTime = a.info?.time?.completed ?? a.info?.time?.created ?? 0;
      const bTime = b.info?.time?.completed ?? b.info?.time?.created ?? 0;
      return bTime - aTime;
    });

  for (const message of assistantMessages) {
    const text = extractTextFromParts(message.parts);
    if (text.length > 0) return text;
  }
  return "";
}

function parseOpenCodeModel(model: string | undefined): { providerID: string; modelID: string } | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return undefined;
  }
  return {
    providerID: trimmed.slice(0, separatorIndex),
    modelID: trimmed.slice(separatorIndex + 1),
  };
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
  private _resolvedBaseUrl: string | null = null;
  private _lastCostUsd = 0;
  private _abortController: AbortController | null = null;
  private _eventAbortController: AbortController | null = null;
  private _disposed = false;

  constructor(config: OpenCodeSessionConfig) {
    this.sessionId = config.runtimeSessionId ?? randomUUID();
    this._config = config;
    this._capabilities = {
      mcp: true,
      streaming: true,
      resumable: config.continuationSessionId !== undefined,
      resume: config.continuationSessionId !== undefined,
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
    for (const warning of collectRuntimeWarnings(config)) {
      debug(`[opencode] ${warning}`);
    }
  }

  get capabilities(): SessionCapabilities {
    return this._capabilities;
  }

  get providerSessionId(): string | undefined {
    return this._remoteSessionId ?? undefined;
  }

  async *run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> {
    if (this._disposed) return;
    const admittedDeliberationLevel = admitDeliberationForExecution(options.deliberationResolution);
    if (admittedDeliberationLevel !== undefined) {
      throw new Error(
        `OpenCode session cannot transport resolved deliberation level '${admittedDeliberationLevel}'.`,
      );
    }
    const startTime = Date.now();
    const abortController = new AbortController();
    this._abortController = abortController;
    const knownMcpToolNames = new Set<string>();
    const partTypes = new Map<string, string>(); // partID → part type ("text" | "reasoning" | "tool" | ...)
    const messageRoles = new Map<string, string>();
    const textPartSnapshots = new Map<string, string>();
    const pendingPartDeltas = new Map<string, string>();
    const toolIdentity = new NativeToolEventIdentity({
      providerId: "opencode",
      kilnSessionId: options.kilnSessionId ?? this.sessionId,
      turnId: options.turnId ?? "turn:1",
    });
    const cwd = options.cwd ?? this._config.cwd;
    let sawProviderEvidence = false;
    let emittedAssistantText = false;

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
      const isResumingTurn = this._resolvedBaseUrl !== null && this._remoteSessionId !== null;

      let storedRemoteSessionId: string | undefined;
      if (!isResumingTurn) {
        if (this._config.continuationSessionId !== undefined) {
          try {
            const store = new SessionStore(this._config.cwd);
            const providerThread = await store.findProviderThread(this._config.continuationSessionId, "opencode");
            if (providerThread) {
              storedRemoteSessionId = providerThread.nativeSessionId;
            }
          } catch {
            console.error("[SessionStore] Resume lookup failed, continuing without resume");
          }
        }
        if (this._config.baseUrl) {
          baseUrl = this._config.baseUrl;
        } else {
          const port = this._config.port ?? 0;
          const actualPort = await this.spawnAndWaitForServe(port, cwd, this._config.env);
          baseUrl = `http://127.0.0.1:${actualPort}`;
        }
        this._resolvedBaseUrl = baseUrl;
      } else {
        baseUrl = this._resolvedBaseUrl!;
      }

      const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
      const client = asOpencodeClient(createOpencodeClient({ baseUrl }));

      if (!isResumingTurn) {
        const mcpEntry = buildOpenCodeMcpEntry(this._config);
        if (mcpEntry !== undefined) {
          await client.config
            .update({
              config: { mcp: { kiln: mcpEntry } },
              directory: cwd,
            })
            .catch((err: unknown) => {
              console.debug(
                `[opencode] MCP config.update failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        } else if (this._config.mcpServerEntryPath) {
          debug(`MCP server entry not found at ${this._config.mcpServerEntryPath}, skipping runtime MCP registration`);
        }

        await client.config
          .update({
            config: { experimental: { batch_tool: true } },
            directory: cwd,
          })
          .catch((err: unknown) => {
            console.debug(
              `[opencode] batch_tool config.update failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });

        if (this._config.model && parseOpenCodeModel(this._config.model) === undefined) {
          debug(
            `[opencode] ignoring non-native model id '${this._config.model}'; OpenCode requires provider/model and will use its configured default.`,
          );
        }
      }

      if (!isResumingTurn) {
        if (storedRemoteSessionId !== undefined) {
          const getResult = await client.session.get(
            { sessionID: storedRemoteSessionId, directory: cwd },
            { throwOnError: true },
          );
          this._remoteSessionId = getResult.data!.id;
        } else {
          const createResult = await client.session.create(
            { directory: cwd, permission: toSessionPermissionRules(this._config) },
            { throwOnError: true },
          );
          this._remoteSessionId = createResult.data!.id;
        }
      }

      await client.session.update(
        {
          sessionID: this._remoteSessionId!,
          directory: cwd,
          permission: toSessionPermissionRules(this._config),
        },
        { throwOnError: true },
      );

      this._eventAbortController = new AbortController();
      const eventStreamPromise = client.global.event({
        signal: this._eventAbortController.signal,
      });

      const eventQueue: Array<QueuedEvent> = [];
      type QueuedEvent = {
        directory: string;
        payload: { type: string; properties?: Record<string, unknown> };
      };
      let eventYield: ((value: QueuedEvent | null) => void) | null = null;
      const eventDone = new Set<() => void>();

      eventStreamPromise
        .then(async ({ stream }) => {
          try {
            for await (const event of stream) {
              if (this._eventAbortController?.signal.aborted) break;
              if (eventYield !== null) {
                const yieldFn = eventYield;
                eventYield = null;
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

      const waitForEvent = (): Promise<QueuedEvent | null> => {
        if (eventQueue.length > 0) return Promise.resolve(eventQueue.shift()!);
        return new Promise((resolve) => {
          eventYield = resolve;
          eventDone.add(() => resolve(null));
        });
      };

      const promptWithExecutionIdentity = appendExecutionIdentity(
        appendPreparedSystemContext(options.prompt, options.system),
        resolveExecutionIdentity({
          configuredProvider: "opencode",
          configuredModel: this._config.model,
          configuredBillingMode: inferOpenCodeBillingMode(this._config.model),
        }),
      );
      const promptWithTaskReminder = appendTaskReminder(promptWithExecutionIdentity, options.prompt);
      const nativeModel = parseOpenCodeModel(this._config.model);
      let promptError: unknown;
      const promptResult = await client.session
        .prompt(
          {
            sessionID: this._remoteSessionId!,
            ...(nativeModel ? { model: nativeModel } : {}),
            parts: [{
              type: "text",
              text: appendConstraintInstructions(
                promptWithTaskReminder,
                this._config.constraintInstructions,
                this._config.nativeRules,
              ),
            }],
            directory: cwd,
          },
          { throwOnError: false },
        )
        .catch((err: unknown) => {
          promptError = err;
          return { data: undefined };
        });
      const promptResultError = (promptResult as { error?: unknown } | undefined)?.error;
      const promptParts = promptResult?.data?.parts;
      debug(
        `[opencode] prompt result: data=${promptResult?.data !== undefined ? "yes" : "no"} ` +
          `parts=${Array.isArray(promptParts) ? promptParts.length : 0} ` +
          `cost=${promptResult?.data?.info?.cost ?? 0} ` +
          `error=${promptError !== undefined || promptResultError !== undefined ? "yes" : "no"}`,
      );

      if (promptError !== undefined || promptResultError !== undefined) {
        const message = formatOpenCodeError(promptError ?? promptResultError);
        yield {
          type: "error",
          code: "OPENCODE_PROMPT_FAILED",
          message,
          isRetryable: false,
        };
        yield {
          type: "completed",
          totalUsd: this._lastCostUsd,
          durationMs: Date.now() - startTime,
          outcome: options.abortSignal?.aborted ? "cancelled" : "failed",
          isPreflightCrash: false,
        };
        return;
      }

      this._lastCostUsd = promptResult?.data?.info?.cost ?? this._lastCostUsd;
      if ((promptResult?.data?.info?.cost ?? 0) > 0) {
        sawProviderEvidence = true;
      }

      while (true) {
        const event = await waitForEvent();
        if (!event) break;

        if (event.payload.type === "message.updated") {
          const props = event.payload.properties as {
            sessionID?: string;
            info?: { id?: string; role?: string; cost?: number };
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (typeof props.info?.id === "string" && typeof props.info?.role === "string") {
            messageRoles.set(props.info.id, props.info.role);
          }
          if (props.info?.role === "assistant") {
            sawProviderEvidence = true;
            if (typeof props.info.cost === "number" && props.info.cost > 0) {
              this._lastCostUsd = props.info.cost;
            }
          }
          continue;
        }

        if (event.payload.type === "sessionUpdate") {
          const props = event.payload.properties as {
            sessionID?: string;
            type?: string;
            cost?: { amount: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (props?.type === "usage_update" && props?.cost?.amount !== undefined) {
            const executionIdentity = resolveExecutionIdentity({
              configuredProvider: "opencode",
              configuredModel: this._config.model,
              configuredBillingMode: inferOpenCodeBillingMode(this._config.model),
            });
            this._lastCostUsd = props.cost.amount;
            yield {
              type: "cost_update",
              usd: props.cost.amount,
              mode: "native" as const,
              provider: executionIdentity?.provider,
              model: executionIdentity?.model,
              canonicalModel: executionIdentity?.canonicalModel,
              billingMode: executionIdentity?.billingMode,
              inputTokens: props.cost.inputTokens,
              outputTokens: props.cost.outputTokens,
              cacheReadTokens: props.cost.cacheReadTokens,
            };
            sawProviderEvidence = true;
          }
          continue;
        }

        if (event.payload.type === "message.part.delta") {
          const props = event.payload.properties as {
            sessionID?: string;
            messageID?: string;
            partID?: string;
            field?: string;
            delta?: string;
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (props.messageID && messageRoles.get(props.messageID) === "user") continue;
          if (props?.field === "text" && props?.delta) {
            sawProviderEvidence = true;
            if (props.partID) {
              textPartSnapshots.set(
                props.partID,
                `${textPartSnapshots.get(props.partID) ?? ""}${props.delta}`,
              );
            }
            const partType = props.partID ? partTypes.get(props.partID) : undefined;
            if (partType === "reasoning") {
              yield { type: "text_delta", content: props.delta, isThinking: true };
            } else if (partType === "text") {
              emittedAssistantText = true;
              yield { type: "text_delta", content: props.delta };
            } else if (props.partID) {
              pendingPartDeltas.set(
                props.partID,
                `${pendingPartDeltas.get(props.partID) ?? ""}${props.delta}`,
              );
            }
          }
          continue;
        }

        if (event.payload.type === "message.part.updated") {
          const props = event.payload.properties as {
            sessionID?: string;
              part?: {
                id?: string;
                messageID?: string;
                type?: string;
                text?: string;
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
          if (part.id && part.type) partTypes.set(part.id, part.type);
          const pendingDelta = part.id ? pendingPartDeltas.get(part.id) : undefined;
          if (part.id && pendingDelta !== undefined) {
            pendingPartDeltas.delete(part.id);
          }

          if (pendingDelta && part.type === "reasoning") {
            yield { type: "text_delta", content: pendingDelta, isThinking: true };
          }

          if (part.type === "text") {
            if (part.messageID && messageRoles.get(part.messageID) !== "assistant") {
              continue;
            }
            sawProviderEvidence = true;
            if (pendingDelta) {
              emittedAssistantText = true;
              yield { type: "text_delta", content: pendingDelta };
            }
            const text = typeof part.text === "string" ? part.text : "";
            if (text.length > 0) {
              const prior = part.id ? textPartSnapshots.get(part.id) ?? "" : "";
              const delta = part.id && text.startsWith(prior) ? text.slice(prior.length) : text;
              if (part.id) textPartSnapshots.set(part.id, text);
              if (delta.length > 0) {
                emittedAssistantText = true;
                yield { type: "text_delta", content: delta };
              }
            }
            continue;
          }

          if (part.type === "tool") {
            sawProviderEvidence = true;
            if (part.state?.status === "pending" || part.state?.status === "running") {
              const toolName = part.tool ?? "unknown";
              const identity = toolIdentity.start(toolName, part.callID ?? part.id);
              if (!identity.emit) continue;
              const isMcpTool = knownMcpToolNames.has(toolName);
              yield {
                type: "tool_use",
                toolCallId: identity.toolCallId,
                toolCallScopeId: identity.toolCallScopeId,
                toolName,
                input: part.state?.input ?? {},
                ...(isMcpTool
                  ? { source: "mcp" as const, mcpSelector: normalizeMcpSelector(toolName) }
                  : {}),
              };
            } else if (part.state?.status === "completed") {
              const completion = toolIdentity.complete(part.tool ?? "unknown", part.callID ?? part.id);
              if (!completion.emit) continue;
              const output = part.state?.output;
              const outputStr =
                output !== undefined
                  ? output
                  : part.state?.metadata?.output !== undefined
                    ? String(part.state.metadata.output)
                    : "";
              if (completion.startRequired) yield {
                  type: "tool_use",
                  toolCallId: completion.toolCallId,
                  toolCallScopeId: completion.toolCallScopeId,
                  toolName: completion.toolName,
                  input: part.state?.input ?? {},
                };
              yield {
                type: "tool_result",
                toolCallId: completion.toolCallId,
                toolCallScopeId: completion.toolCallScopeId,
                toolName: completion.toolName,
                output: outputStr,
              };
            } else if (part.state?.status === "error") {
              if (isOpenCodeWriteTool(part.tool)) {
                yield {
                  type: "write_decision",
                  status: "denied",
                  providerRequestId: part.callID,
                  actor: "opencode-policy",
                  reason: part.state.error ?? "OpenCode denied write tool execution",
                };
              }
              const completion = toolIdentity.complete(part.tool ?? "unknown", part.callID ?? part.id);
              if (!completion.emit) continue;
              if (completion.startRequired) yield {
                  type: "tool_use",
                  toolCallId: completion.toolCallId,
                  toolCallScopeId: completion.toolCallScopeId,
                  toolName: completion.toolName,
                  input: part.state?.input ?? {},
                };
              yield {
                type: "tool_result",
                toolCallId: completion.toolCallId,
                toolCallScopeId: completion.toolCallScopeId,
                toolName: completion.toolName,
                output: part.state.error ?? "Tool failed",
                isError: true,
              };
            }
          }
          continue;
        }

        if (event.payload.type === "session.diff") {
          const props = event.payload.properties as {
            sessionID?: string;
            diff?: Array<{
              file?: string;
              additions?: number;
              deletions?: number;
              status?: "added" | "deleted" | "modified";
            }>;
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;

          for (const diff of props.diff ?? []) {
            if (typeof diff.file !== "string" || diff.file.trim().length === 0) continue;
            const path = normalizeOpenCodeDiffPath(cwd, diff.file);
            sawProviderEvidence = true;
            const additions = diff.additions;
            const deletions = diff.deletions;
            yield {
              type: "file_changed",
              path,
              changeType: mapOpenCodeDiffStatus(diff.status),
              ...(typeof additions === "number" && Number.isInteger(additions) && additions >= 0 ? { linesAdded: additions } : {}),
              ...(typeof deletions === "number" && Number.isInteger(deletions) && deletions >= 0 ? { linesRemoved: deletions } : {}),
              diffTruncated: true,
            };
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

        if (event.payload.type === "session.idle") {
          const props = event.payload.properties as { sessionID?: string } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          break;
        }

        if (event.payload.type === "session.compacted") {
          const props = event.payload.properties as {
            sessionID?: string;
            tokens?: number;
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          sawProviderEvidence = true;
          const output = props?.tokens !== undefined
            ? `Context compacted to approximately ${props.tokens} tokens`
            : "Context compacted";
          const completion = toolIdentity.complete("session.compacted");
          yield {
            type: "tool_use",
            toolCallId: completion.toolCallId,
            toolCallScopeId: completion.toolCallScopeId,
            toolName: completion.toolName,
            input: {},
          };
          yield {
            type: "tool_result",
            toolCallId: completion.toolCallId,
            toolCallScopeId: completion.toolCallScopeId,
            toolName: completion.toolName,
            output,
          };
          continue;
        }

        if (event.payload.type === "question.asked") {
          const props = event.payload.properties as {
            sessionID?: string;
            question?: string;
          } | undefined;
          if (props?.sessionID !== this._remoteSessionId) continue;
          if (props?.question) {
            sawProviderEvidence = true;
            emittedAssistantText = true;
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
          const nextMcpToolNames = new Set<string>();
          for (const tool of props?.tools ?? []) {
            if (typeof tool?.name === "string" && tool.name.length > 0) {
              nextMcpToolNames.add(tool.name);
            }
          }
          knownMcpToolNames.clear();
          for (const toolName of nextMcpToolNames) {
            knownMcpToolNames.add(toolName);
          }
          const toolList = props?.tools?.map((t) => t.name).join(", ") ?? "";
          sawProviderEvidence = true;
          const completion = toolIdentity.complete("mcp.tools.changed");
          yield {
            type: "tool_use",
            toolCallId: completion.toolCallId,
            toolCallScopeId: completion.toolCallScopeId,
            toolName: completion.toolName,
            input: {},
          };
          yield {
            type: "tool_result",
            toolCallId: completion.toolCallId,
            toolCallScopeId: completion.toolCallScopeId,
            toolName: completion.toolName,
            output: toolList,
          };
          continue;
        }
      }

      if (!emittedAssistantText) {
        const promptText = extractTextFromParts(promptResult?.data?.parts);
        if (promptText.length > 0) {
          emittedAssistantText = true;
          sawProviderEvidence = true;
          yield { type: "text_delta", content: promptText };
        }
      }

      if (!emittedAssistantText && typeof client.session.messages === "function") {
        const messageResult = await client.session
          .messages(
            { sessionID: this._remoteSessionId!, directory: cwd, limit: 20 },
            { throwOnError: false },
          )
          .catch(() => ({ data: undefined }));
        const messageText = extractAssistantTextFromMessages(messageResult?.data);
        if (messageText.length > 0) {
          emittedAssistantText = true;
          sawProviderEvidence = true;
          yield { type: "text_delta", content: messageText };
        }
      }

      const stopReason = promptResult?.data?.info?.stopReason;
      const emptyResponse = !sawProviderEvidence && !emittedAssistantText;
      if (emptyResponse) {
        yield {
          type: "error",
          code: "OPENCODE_EMPTY_RESPONSE",
          message: "OpenCode session reached idle without assistant text, usage, tool, or file-change evidence.",
          isRetryable: true,
        };
      }
      const outcome = stopReason === "cancelled" || options.abortSignal?.aborted
        ? "cancelled"
        : emptyResponse
          ? "failed"
          : "completed";
      yield {
        type: "completed",
        totalUsd: this._lastCostUsd,
        durationMs: Date.now() - startTime,
        outcome,
        isPreflightCrash: false,
      };
      if (this._config.sessionLedgerOwner !== "host") try {
        const store = new SessionStore(this._config.cwd);
        const completedAt = new Date().toISOString();
        const metadata = deriveSessionMetadata({
          task: this._config.task,
          provider: "opencode",
          model: this._config.model,
          hasError: outcome !== "completed",
        });
        await store.append({
          sessionId: this._remoteSessionId ?? this.sessionId,
          provider: "opencode",
          task: this._config.task,
          title: metadata.title,
          summary: metadata.summary,
          tags: metadata.tags,
          completedAt,
          cost: this._lastCostUsd,
          projectPath: this._config.cwd,
          providerThread: this._remoteSessionId
            ? { provider: "opencode", nativeSessionId: this._remoteSessionId }
            : undefined,
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
  ): Promise<number> {
    const opencodePath = this._findOpencodePath();
    const args = ["serve", "--port", String(port)];
    const spawnEnv = buildOpenCodeRuntimeConfigEnv({ ...process.env, ...env }, this._config);

    debug(`[opencode] spawning: ${opencodePath} ${args.join(" ")}`);
    debug(`[opencode] cwd: ${cwd}`);

    const proc = spawn(opencodePath, args, {
      cwd,
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this.serveProcess = proc;

    let actualPort = port;
    let stderrOutput = "";
    const portRegex = /listening on (?:http:\/\/)?[^:]*:(\d+)/i;

    const portPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`opencode serve failed to start within 15 seconds\nStderr: ${stderrOutput}`));
      }, 15_000);

      const handleData = (data: Buffer) => {
        const line = data.toString();
        debug(`[opencode] stdout/stderr: ${line.trim()}`);
        const match = line.match(portRegex);
        if (match?.[1]) {
          actualPort = parseInt(match[1], 10);
          clearTimeout(timeout);
          proc.stdout?.removeListener("data", handleData);
          resolve();
        }
      };

      proc.stdout?.on("data", handleData);
      proc.stderr?.on("data", (data: Buffer) => {
        stderrOutput += data.toString();
        handleData(data);
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn opencode serve: ${err.message}\nStderr: ${stderrOutput}`));
      });

      proc.on("exit", (code: number | null) => {
        clearTimeout(timeout);
        debug(`[opencode] serve exited with code ${code}`);
        if (code !== 0 && code !== null) {
          reject(new Error(`opencode serve exited with code ${code}\nStderr: ${stderrOutput}`));
        }
      });
    });

    await portPromise;
    return actualPort;
  }

  private _findOpencodePath(): string {
    const homedir = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return resolveNativeCliExecutable({
      command: "opencode",
      fallbackPaths: [`${homedir}\\.bun\\bin\\opencode.exe`],
    });
  }

  private _killServeProcess(): void {
    if (this.serveProcess && !this.serveProcess.killed) {
      const pid = this.serveProcess.pid;
      if (process.platform === "win32" && typeof pid === "number") {
        try {
          execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          return;
        } catch {
          // Fall back to Node's kill below.
        }
      }
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

function isOpenCodeWriteTool(toolName: string | undefined): boolean {
  const normalized = toolName?.trim().toLowerCase();
  return normalized === "edit" ||
    normalized === "write" ||
    normalized === "apply_patch" ||
    normalized === "multiedit" ||
    normalized === "notebookedit";
}

function formatOpenCodeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    const message = error.message ?? error.error ?? error.data;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function normalizeOpenCodeDiffPath(cwd: string, file: string): string {
  const trimmed = file.trim();
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

function mapOpenCodeDiffStatus(status: "added" | "deleted" | "modified" | undefined): "created" | "modified" | "deleted" {
  if (status === "added") return "created";
  if (status === "deleted") return "deleted";
  return "modified";
}
