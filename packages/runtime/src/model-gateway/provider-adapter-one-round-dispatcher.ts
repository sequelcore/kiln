import {
  type AccountRef,
  type AgentMessage,
  type AgentResponse,
  type ContentPart,
  type CreateMessageOptions,
  type DirectProviderId,
  type FunctionModelTool,
  type ModelGatewayOneRoundDispatcher,
  type ModelGatewayOneRoundDispatchInput,
  type ModelJsonObject,
  type ModelPart,
  type ModelTurn,
  type ModelTurnMessage,
  type ModelTurnResult,
  type ProviderAdapter,
  type ToolChoiceOption,
  type ToolDefinition,
} from "@kilnai/core";

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
  readonly account: AccountRef;
  readonly providerId: Exclude<DirectProviderId, "codex-oauth">;
  readonly adapter: ProviderAdapter;
}

/**
 * Capability-limited bridge for exactly one call through an already-bound raw
 * provider adapter. Credential selection and retry policy belong outside this
 * class; callers must construct the adapter with internal retries disabled.
 */
export class ProviderAdapterOneRoundDispatcher implements ModelGatewayOneRoundDispatcher {
  readonly #account: AccountRef;
  readonly #providerId: Exclude<DirectProviderId, "codex-oauth">;
  readonly #adapter: ProviderAdapter;

  constructor(options: ProviderAdapterOneRoundDispatcherOptions) {
    this.#account = options.account;
    this.#providerId = options.providerId;
    this.#adapter = options.adapter;
  }

  async dispatchOneRound(input: ModelGatewayOneRoundDispatchInput): Promise<ModelTurnResult> {
    if (input.account !== this.#account) {
      throw new ProviderAdapterOneRoundError("account-mismatch", "The dispatcher is bound to a different account.");
    }
    if (input.route.providerId !== this.#providerId || input.route.providerModelId.length === 0) {
      throw new ProviderAdapterOneRoundError("route-mismatch", "The dispatcher is bound to a different provider route.");
    }

    const response = await this.#adapter.createMessage(toCreateMessageOptions(input));
    return toModelTurnResult(response);
  }
}

function toCreateMessageOptions(input: ModelGatewayOneRoundDispatchInput): CreateMessageOptions {
  assertSupportedTurn(input.turn);
  const system = [
    input.turn.instructions,
    ...input.turn.history
      .filter((message) => message.role === "developer")
      .map((message) => message.parts.map((part) => (part as { readonly text: string }).text).join("")),
  ].filter((value): value is string => value !== undefined && value.length > 0).join("\n\n");
  const tools = input.turn.tools?.filter((tool): tool is FunctionModelTool => tool.kind === "function").map((tool): ToolDefinition => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema as Record<string, unknown>,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema as Record<string, unknown> }),
    ...(tool.strict === true ? { strict: true as const } : {}),
    tags: new Set<string>(),
  }));
  return {
    sessionId: input.sessionId,
    system,
    messages: input.turn.history.filter((message) => message.role !== "developer").map(toAgentMessage),
    ...(tools === undefined ? {} : { tools }),
    ...(input.turn.toolChoice === undefined ? {} : { toolChoice: toToolChoice(input.turn.toolChoice) }),
    ...(input.turn.maxOutputTokens === undefined ? {} : { maxTokens: input.turn.maxOutputTokens }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
}

function assertSupportedTurn(turn: ModelTurn): void {
  if (turn.parallelToolCalls !== undefined) unsupported("parallel tool calls");
  if (turn.responseFormat !== undefined) unsupported("JSON-schema response formats");
  if (turn.reasoning !== undefined) unsupported("reasoning controls");
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

function toAgentMessage(message: ModelTurnMessage): AgentMessage {
  return {
    role: message.role as AgentMessage["role"],
    parts: message.parts.map(toContentPart),
  };
}

function toContentPart(part: ModelPart): ContentPart {
  switch (part.type) {
    case "text": return { type: "text", text: part.text };
    case "image": return part.source.kind === "url"
      ? { type: "image", mimeType: "image/*", url: part.source.url }
      : { type: "image", mimeType: part.source.mediaType, data: part.source.data };
    case "tool-call":
      if (part.call.kind !== "function") return unsupported("custom tool calls");
      return { type: "tool_use", id: part.call.id, name: part.call.name, input: part.call.input.value as Record<string, unknown> };
    case "tool-result": {
      const contentParts = part.content.map((content): ContentPart => toContentPart(content));
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

function toToolChoice(choice: NonNullable<ModelTurn["toolChoice"]>): ToolChoiceOption {
  switch (choice.kind) {
    case "auto": return { type: "auto" };
    case "none": return { type: "none" };
    case "required": return { type: "any" };
    case "tool": return { type: "tool", name: choice.name };
  }
}

function toModelTurnResult(response: AgentResponse): ModelTurnResult {
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
    parts.push({ type: "tool-call", call: { kind: "function", id: call.id, name: call.name, input: { kind: "json-object", value: call.input as ModelJsonObject } } });
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
