import {
  assertValidToolCallIds,
  type ExecutionAccountRef,
  type AgentMessage,
  type AgentResponse,
  type ContentPart,
  type CreateMessageOptions,
  type DirectProviderId,
  type FunctionModelTool,
  type OneRoundModelDispatcher,
  type OneRoundModelDispatchInput,
  type ModelJsonObject,
  type ModelPart,
  type ModelTool,
  type ModelTurn,
  type ModelTurnMessage,
  type ModelTurnResult,
  type ProviderAdapter,
  type ProviderRequestIdentity,
  type ProviderTransportEvent,
  type ToolChoiceOption,
  type ToolDefinition,
} from "@kilnai/core";
import { ProviderDispatchTerminalError } from "../provider-dispatch-terminal-error.js";

export type ProviderAdapterOneRoundErrorCode =
  | "account-mismatch"
  | "route-mismatch"
  | "unsupported-capability"
  | "unsupported-output";

export class ProviderAdapterOneRoundError extends Error {
  override readonly name = "ProviderAdapterOneRoundError";

  constructor(readonly code: ProviderAdapterOneRoundErrorCode, message: string) {
    super(message);
  }
}

export interface ProviderAdapterOneRoundDispatcherOptions {
  readonly account: ExecutionAccountRef;
  readonly providerId: Exclude<DirectProviderId, "codex-oauth">;
  readonly adapter: ProviderAdapter;
  readonly requestIdentity?: ProviderRequestIdentity;
  readonly now?: () => Date;
}

/**
 * Capability-limited bridge for exactly one call through an already-bound raw
 * provider adapter. Credential selection and retry policy belong outside this
 * class; callers must construct the adapter with internal retries disabled.
 */
export class ProviderAdapterOneRoundDispatcher implements OneRoundModelDispatcher {
  readonly #account: ExecutionAccountRef;
  readonly #providerId: Exclude<DirectProviderId, "codex-oauth">;
  readonly #adapter: ProviderAdapter;
  readonly #requestIdentity: ProviderRequestIdentity | undefined;
  readonly #now: () => Date;

  constructor(options: ProviderAdapterOneRoundDispatcherOptions) {
    this.#account = options.account;
    this.#providerId = options.providerId;
    this.#adapter = options.adapter;
    this.#requestIdentity = options.requestIdentity;
    this.#now = options.now ?? (() => new Date());
  }

  async dispatchOneRound(input: OneRoundModelDispatchInput): Promise<ModelTurnResult> {
    if (input.account !== this.#account) {
      throw new ProviderAdapterOneRoundError("account-mismatch", "The dispatcher is bound to a different account.");
    }
    if (input.route.providerId !== this.#providerId || input.route.providerModelId.length === 0) {
      throw new ProviderAdapterOneRoundError("route-mismatch", "The dispatcher is bound to a different provider route.");
    }
    if ((input.turn.deliberationResolution?.status === "exact"
      || input.turn.deliberationResolution?.status === "clamped")
      && this.#adapter.deliberationTransport !== "native-level") {
      throw new ProviderAdapterOneRoundError(
        "unsupported-capability",
        `Provider adapter '${this.#adapter.name}' cannot transport the resolved deliberation level.`,
      );
    }

    const projection = buildFunctionToolProjection(input.turn.tools ?? []);
    let rejectedResponse: Extract<ProviderTransportEvent, { readonly type: "response_headers" }> | undefined;
    const response = await this.#adapter.createMessage({
      ...toCreateMessageOptions(input, projection),
      ...(this.#requestIdentity === undefined ? {} : { requestIdentity: this.#requestIdentity }),
      transportObserver: {
        onEvent: (event) => {
          if (event.type === "response_headers" && event.status >= 400) rejectedResponse = event;
        },
      },
    }).catch((error: unknown) => {
      const requestId = rejectedResponse?.identity?.requestId ?? this.#requestIdentity?.requestId;
      if (rejectedResponse !== undefined && requestId !== undefined) {
        throw new ProviderDispatchTerminalError({
          outcome: "provider-error",
          requestId,
          status: rejectedResponse.status,
          observedAt: this.#now().toISOString(),
        }, error);
      }
      throw error;
    });
    // ProviderAdapter is an open boundary; this bridge projects adapter-produced tool calls
    // directly into the provider-neutral turn result, so identity must be validated here too
    // rather than trusting the adapter's own convention.
    assertValidToolCallIds(response.toolCalls, { adapter: this.#providerId });
    return toModelTurnResult(response, projection);
  }
}

interface FunctionToolProjection {
  readonly toWire: ReadonlyMap<string, string>;
  readonly fromWire: ReadonlyMap<string, FunctionModelTool>;
}

function toCreateMessageOptions(input: OneRoundModelDispatchInput, projection: FunctionToolProjection): CreateMessageOptions {
  assertSupportedTurn(input.turn);
  const system = [
    input.turn.instructions,
    ...input.turn.history
      .filter((message) => message.role === "developer")
      .map((message) => message.parts.map((part) => (part as { readonly text: string }).text).join("")),
  ].filter((value): value is string => value !== undefined && value.length > 0).join("\n\n");
  const tools = input.turn.tools?.filter((tool): tool is FunctionModelTool => tool.kind === "function").map((tool): ToolDefinition => ({
    name: requireProjectedName(projection, tool.namespace, tool.name),
    description: tool.description ?? "",
    inputSchema: tool.inputSchema as Record<string, unknown>,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema as Record<string, unknown> }),
    ...(tool.strict === true ? { strict: true as const } : {}),
    tags: new Set<string>(),
  }));
  return {
    sessionId: input.sessionId,
    system,
    messages: input.turn.history.filter((message) => message.role !== "developer").map((message) => toAgentMessage(message, projection)),
    ...(tools === undefined ? {} : { tools }),
    ...(input.turn.toolChoice === undefined ? {} : { toolChoice: toToolChoice(input.turn.toolChoice, projection) }),
    ...(input.turn.maxOutputTokens === undefined ? {} : { maxTokens: input.turn.maxOutputTokens }),
    ...(input.turn.deliberationResolution === undefined
      ? {}
      : { deliberationResolution: input.turn.deliberationResolution }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
}

function assertSupportedTurn(turn: ModelTurn): void {
  if (turn.parallelToolCalls === true) unsupported("parallel tool calls");
  if (turn.responseFormat !== undefined) unsupported("JSON-schema response formats");
  if (turn.reasoningSummary !== undefined) unsupported("reasoning summaries");
  if (turn.textVerbosity !== undefined) unsupported("text verbosity");
  if (turn.tools?.some((tool) => tool.kind !== "function")) unsupported("custom tools");
  for (const message of turn.history) {
    for (const part of message.parts) {
      if (message.role === "developer" && part.type !== "text") unsupported("non-text developer content");
      if (part.type === "reasoning-summary") unsupported("reasoning summaries");
      if (part.type === "tool-call" && part.call.kind !== "function") unsupported("custom tool calls");
    }
  }
}

function unsupported(capability: string): never {
  throw new ProviderAdapterOneRoundError("unsupported-capability", `Provider-adapter routes do not support ${capability}.`);
}

function toAgentMessage(message: ModelTurnMessage, projection: FunctionToolProjection): AgentMessage {
  return {
    role: message.role as AgentMessage["role"],
    parts: message.parts.map((part) => toContentPart(part, projection)),
  };
}

function toContentPart(part: ModelPart, projection: FunctionToolProjection): ContentPart {
  switch (part.type) {
    case "text": return { type: "text", text: part.text };
    case "image": return part.source.kind === "url"
      ? { type: "image", mimeType: "image/*", url: part.source.url }
      : { type: "image", mimeType: part.source.mediaType, data: part.source.data };
    case "tool-call":
      if (part.call.kind !== "function") return unsupported("custom tool calls");
      return { type: "tool_use", id: part.call.id, name: requireProjectedName(projection, part.call.namespace, part.call.name), input: part.call.input.value as Record<string, unknown> };
    case "tool-result": {
      const contentParts = part.content.map((content): ContentPart => toContentPart(content, projection));
      return {
        type: "tool_result",
        toolUseId: part.callId,
        content: part.content.filter((content) => content.type === "text").map((content) => content.text).join(""),
        contentParts: contentParts as Extract<ContentPart, { readonly type: "tool_result" }>["contentParts"],
        ...(part.isError === undefined ? {} : { isError: part.isError }),
      };
    }
    case "reasoning-summary": return unsupported("reasoning summaries");
  }
}

function toToolChoice(choice: NonNullable<ModelTurn["toolChoice"]>, projection: FunctionToolProjection): ToolChoiceOption {
  switch (choice.kind) {
    case "auto": return { type: "auto" };
    case "none": return { type: "none" };
    case "required": return { type: "any" };
    case "tool": return { type: "tool", name: requireProjectedName(projection, choice.namespace, choice.name) };
  }
}

function toModelTurnResult(response: AgentResponse, projection: FunctionToolProjection): ModelTurnResult {
  const parts: ModelPart[] = [];
  for (const part of response.parts) {
    if (part.type === "text") parts.push({ type: "text", text: part.text });
    else if (part.type === "image") {
      if (part.url !== undefined) parts.push({ type: "image", source: { kind: "url", url: part.url } });
      else if (part.data !== undefined) parts.push({ type: "image", source: { kind: "base64", mediaType: part.mimeType, data: part.data } });
      else throw new ProviderAdapterOneRoundError("unsupported-output", "The provider returned an image without transport data.");
    } else {
      throw new ProviderAdapterOneRoundError("unsupported-output", `The provider returned unsupported '${part.type}' content.`);
    }
  }
  for (const call of response.toolCalls) {
    const original = projection.fromWire.get(call.name);
    if (original === undefined) throw new ProviderAdapterOneRoundError("unsupported-output", "The provider returned an undeclared tool call.");
    parts.push({ type: "tool-call", call: { kind: "function", ...(original.namespace === undefined ? {} : { namespace: original.namespace }), id: call.id, name: original.name, input: { kind: "json-object", value: call.input as ModelJsonObject } } });
  }
  return {
    parts,
    usage: {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cacheReadTokens: response.cacheReadTokens,
      cacheWriteTokens: response.cacheWriteTokens,
    },
    stopReason: response.stopReason,
  };
}

function buildFunctionToolProjection(tools: readonly ModelTool[]): FunctionToolProjection {
  const functions = tools.filter((tool): tool is FunctionModelTool => tool.kind === "function");
  const occupied = new Set(functions.filter((tool) => tool.namespace === undefined).map((tool) => tool.name));
  const toWire = new Map<string, string>(); const fromWire = new Map<string, FunctionModelTool>();
  for (const [index, tool] of functions.entries()) {
    let wireName = tool.name;
    if (tool.namespace !== undefined) {
      const suffix = `${safeToolSegment(tool.namespace)}_${safeToolSegment(tool.name)}`;
      const prefix = `kiln_ns_${index}_`;
      wireName = `${prefix}${suffix}`.slice(0, 64);
      let collision = 1;
      while (occupied.has(wireName)) {
        const marker = `_${collision++}`;
        wireName = `${prefix}${suffix}`.slice(0, 64 - marker.length) + marker;
      }
    }
    occupied.add(wireName); toWire.set(toolIdentity(tool.namespace, tool.name), wireName); fromWire.set(wireName, tool);
  }
  return { toWire, fromWire };
}

function requireProjectedName(projection: FunctionToolProjection, namespace: string | undefined, name: string): string {
  const projected = projection.toWire.get(toolIdentity(namespace, name));
  if (projected === undefined) unsupported("namespaced function history without a current declaration");
  return projected;
}

function toolIdentity(namespace: string | undefined, name: string): string { return `${namespace ?? ""}\u0000${name}`; }
function safeToolSegment(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, "_") || "tool"; }
