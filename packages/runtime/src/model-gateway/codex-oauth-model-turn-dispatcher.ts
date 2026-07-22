import {
  validateModelTurn,
  validateModelTurnResult,
  type AccountRef,
  type ModelGatewayOneRoundDispatcher,
  type ModelGatewayOneRoundDispatchInput,
  type ModelImagePart,
  type ModelJsonObject,
  type ModelPart,
  type ModelTurn,
  type ModelTurnResult,
} from "@kilnai/core";

export const CODEX_OAUTH_SSE_LIMITS = { maxBytes: 16 * 1024 * 1024, maxEvents: 100_000 } as const;
export const CODEX_OAUTH_RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

export type CodexOAuthModelTurnErrorCode =
  | "account-mismatch" | "route-mismatch" | "unsupported-capability" | "aborted"
  | "network-error" | "http-error" | "malformed-sse" | "provider-failed"
  | "provider-incomplete" | "incomplete-stream" | "unsupported-output" | "response-too-large" | "too-many-events";

export class CodexOAuthModelTurnError extends Error {
  override name = "CodexOAuthModelTurnError";
  readonly retryable = false;
  constructor(
    readonly code: CodexOAuthModelTurnErrorCode,
    message: string,
    readonly status?: number,
    readonly providerRequestId?: string,
  ) { super(message); }
}

export interface CodexOAuthResolvedCredential {
  readonly accessToken: string;
  readonly chatgptAccountId?: string;
}
export interface CodexOAuthModelTurnDispatcherOptions {
  readonly account: AccountRef;
  readonly credential: CodexOAuthResolvedCredential;
  readonly fetch: typeof fetch;
  /** Testable safety bounds; production callers should use the pinned defaults. */
  readonly sseLimits?: CodexOAuthSseLimits;
}
export interface CodexOAuthSseLimits { readonly maxBytes: number; readonly maxEvents: number; }

type WireRecord = Record<string, unknown>;
type WireInput = WireRecord;
type WireContent = WireRecord;

function unsupported(message: string): never {
  throw new CodexOAuthModelTurnError("unsupported-capability", message);
}
function imageContent(image: ModelImagePart): WireContent {
  return image.source.kind === "url"
    ? { type: "input_image", image_url: image.source.url }
    : { type: "input_image", image_url: `data:${image.source.mediaType};base64,${image.source.data}` };
}
function textContent(text: string, role: ModelTurn["history"][number]["role"]): WireContent {
  return { type: role === "assistant" ? "output_text" : "input_text", text };
}
function toolResultOutput(content: readonly ({ type: "text"; text: string } | ModelImagePart)[]): string | WireContent[] {
  if (content.length === 1 && content[0]?.type === "text") return content[0].text;
  return content.map((part) => part.type === "text" ? { type: "input_text", text: part.text } : imageContent(part));
}

export function encodeCodexOAuthResponsesRequest(input: ModelGatewayOneRoundDispatchInput): WireRecord {
  validateModelTurn(input.turn);
  const wireInput: WireInput[] = []; const calls = new Map<string, "function" | "custom">();
  for (const message of input.turn.history) {
    const normal: WireContent[] = [];
    for (const part of message.parts) {
      if (part.type === "text") normal.push(textContent(part.text, message.role));
      else if (part.type === "image") {
        if (message.role === "assistant") unsupported("Assistant image history is not representable by the pinned Codex transport.");
        normal.push(imageContent(part));
      } else {
        if (normal.length > 0) { wireInput.push({ type: "message", role: message.role, content: normal.splice(0) }); }
        if (part.type === "reasoning-summary") wireInput.push({ type: "reasoning", summary: [{ type: "summary_text", text: part.text }] });
        else if (part.type === "tool-call") {
          calls.set(part.call.id, part.call.kind);
          if (part.call.kind === "function") wireInput.push({ type: "function_call", call_id: part.call.id, name: part.call.name, arguments: JSON.stringify(part.call.input.value) });
          else wireInput.push({ type: "custom_tool_call", call_id: part.call.id, name: part.call.name, input: part.call.input.value });
        } else {
          if (part.isError === true) unsupported("Error tool results are not representable without changing their semantics.");
          const kind = calls.get(part.callId); if (!kind) unsupported("Tool results must reference an earlier call.");
          wireInput.push({ type: kind === "function" ? "function_call_output" : "custom_tool_call_output", call_id: part.callId, output: toolResultOutput(part.content) });
        }
      }
    }
    if (normal.length > 0) wireInput.push({ type: "message", role: message.role, content: normal });
  }
  const tools = input.turn.tools?.map((tool): WireRecord => tool.kind === "function" ? {
    type: "function", name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }),
    parameters: structuredClone(tool.inputSchema), ...(tool.strict === undefined ? {} : { strict: tool.strict }),
  } : {
    type: "custom", name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }),
    format: { type: "grammar", syntax: "lark", definition: tool.grammar.source },
  });
  let toolChoice: unknown = "auto";
  if (input.turn.toolChoice?.kind === "none" || input.turn.toolChoice?.kind === "required" || input.turn.toolChoice?.kind === "auto") toolChoice = input.turn.toolChoice.kind;
  else if (input.turn.toolChoice?.kind === "tool") {
    const selectedName = input.turn.toolChoice.name;
    const selected = input.turn.tools?.find((tool) => tool.name === selectedName);
    if (!selected) unsupported("Selected tool is unavailable.");
    toolChoice = { type: selected.kind === "function" ? "function" : "custom", name: selected.name };
  }
  const body: WireRecord = {
    model: input.route.providerModelId,
    ...(input.turn.maxOutputTokens === undefined ? {} : { max_output_tokens: input.turn.maxOutputTokens }),
    ...(input.turn.instructions === undefined ? {} : { instructions: input.turn.instructions }),
    input: wireInput,
    ...(tools === undefined ? {} : { tools }), tool_choice: toolChoice,
    parallel_tool_calls: input.turn.parallelToolCalls ?? false,
    ...(input.turn.reasoning === undefined ? {} : { reasoning: structuredClone(input.turn.reasoning) }),
    store: false, stream: true, stream_options: { reasoning_summary_delivery: "sequential_cutoff" },
    include: ["reasoning.encrypted_content"], prompt_cache_key: input.sessionId,
  };
  if (input.turn.textVerbosity !== undefined || input.turn.responseFormat !== undefined) body.text = {
    ...(input.turn.textVerbosity === undefined ? {} : { verbosity: input.turn.textVerbosity }),
    ...(input.turn.responseFormat === undefined ? {} : { format: { type: "json_schema", name: input.turn.responseFormat.name, schema: structuredClone(input.turn.responseFormat.schema), strict: input.turn.responseFormat.strict ?? false } }),
  };
  return body;
}

function safeRequestId(headers: Headers): string | undefined {
  for (const name of ["x-request-id", "request-id", "openai-request-id"]) {
    const value = headers.get(name); if (value && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) return value;
  }
  return undefined;
}
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function object(value: unknown): WireRecord | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as WireRecord : undefined; }

interface DecodedOutputItem { readonly id: string; readonly parts: readonly ModelPart[]; readonly callId?: string; }

function decodeDoneItem(itemValue: unknown): DecodedOutputItem {
  const item = object(itemValue); if (!item || typeof item.type !== "string") throw new CodexOAuthModelTurnError("malformed-sse", "A recognized output event was malformed.");
  if (typeof item.id !== "string" || item.id.length === 0) throw new CodexOAuthModelTurnError("malformed-sse", "A recognized output item had no identity.");
  if (item.type === "message") {
    if (item.role !== "assistant" || !Array.isArray(item.content)) throw new CodexOAuthModelTurnError("malformed-sse", "A recognized message output was malformed.");
    const parts: ModelPart[] = [];
    for (const raw of item.content) { const content = object(raw); if (!content || content.type !== "output_text" || typeof content.text !== "string") throw new CodexOAuthModelTurnError("unsupported-output", "The provider returned unsupported message content."); parts.push({ type: "text", text: content.text }); }
    return { id: item.id, parts };
  }
  if (item.type === "reasoning") {
    if (!Array.isArray(item.summary)) throw new CodexOAuthModelTurnError("malformed-sse", "A recognized reasoning output was malformed.");
    return { id: item.id, parts: item.summary.map((raw): ModelPart => { const summary = object(raw); if (!summary || summary.type !== "summary_text" || typeof summary.text !== "string") throw new CodexOAuthModelTurnError("unsupported-output", "The provider returned unsupported reasoning content."); return { type: "reasoning-summary", text: summary.text }; }) };
  }
  if (item.type === "function_call") {
    if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string") throw new CodexOAuthModelTurnError("malformed-sse", "A recognized function call was malformed.");
    let value: unknown; try { value = JSON.parse(item.arguments); } catch { throw new CodexOAuthModelTurnError("malformed-sse", "A function call contained invalid JSON arguments."); }
    if (!object(value)) throw new CodexOAuthModelTurnError("malformed-sse", "Function arguments must be a JSON object.");
    return { id: item.id, callId: item.call_id, parts: [{ type: "tool-call", call: { kind: "function", id: item.call_id, name: item.name, input: { kind: "json-object", value: value as ModelJsonObject } } }] };
  }
  if (item.type === "custom_tool_call") {
    if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.input !== "string") throw new CodexOAuthModelTurnError("malformed-sse", "A recognized custom tool call was malformed.");
    return { id: item.id, callId: item.call_id, parts: [{ type: "tool-call", call: { kind: "custom", id: item.call_id, name: item.name, input: { kind: "raw-text", value: item.input } } }] };
  }
  throw new CodexOAuthModelTurnError("unsupported-output", "The provider returned an unsupported output item.");
}

async function decodeCodexSse(response: Response, limits: CodexOAuthSseLimits): Promise<ModelTurnResult> {
  if (!response.body) throw new CodexOAuthModelTurnError("incomplete-stream", "The provider response stream was unavailable.");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = ""; let bytes = 0; let events = 0; let terminal: ModelTurnResult | undefined; const streamedItems: DecodedOutputItem[] = []; const streamedIds = new Set<string>(); const streamedCallIds = new Set<string>();
  const processBlock = (block: string): void => {
    if (block.trim().length === 0) return;
    events++; if (events > limits.maxEvents) throw new CodexOAuthModelTurnError("too-many-events", "The provider response exceeded the event bound.");
    let eventName: string | undefined; const data: string[] = [];
    for (const line of block.split(/\r?\n/)) { if (line.startsWith("event:")) eventName = line.slice(6).trim(); else if (line.startsWith("data:")) data.push(line.slice(5).trimStart()); }
    const joined = data.join("\n"); if (joined === "[DONE]") return;
    let parsed: unknown; try { parsed = JSON.parse(joined); } catch { throw new CodexOAuthModelTurnError("malformed-sse", "A provider SSE event was malformed."); }
    const frame = object(parsed); if (!frame || typeof frame.type !== "string" || (eventName && eventName !== frame.type)) throw new CodexOAuthModelTurnError("malformed-sse", "A provider SSE event was malformed.");
    if (terminal) throw new CodexOAuthModelTurnError("malformed-sse", "Events were received after the terminal response.");
    if (frame.type === "response.output_item.done") {
      const item = decodeDoneItem(frame.item);
      if (streamedIds.has(item.id) || (item.callId !== undefined && streamedCallIds.has(item.callId))) throw new CodexOAuthModelTurnError("malformed-sse", "The provider repeated an output item.");
      streamedIds.add(item.id); if (item.callId !== undefined) streamedCallIds.add(item.callId); streamedItems.push(item);
    }
    else if (frame.type === "response.failed" || frame.type === "error") throw new CodexOAuthModelTurnError("provider-failed", "The provider reported a failed response.");
    else if (frame.type === "response.incomplete") throw new CodexOAuthModelTurnError("provider-incomplete", "The provider reported an incomplete response.");
    else if (frame.type === "response.completed") {
      const completed = object(frame.response); const usage = object(completed?.usage); const details = object(usage?.input_tokens_details);
      const inputTokens = number(usage?.input_tokens); const outputTokens = number(usage?.output_tokens); const total = number(usage?.total_tokens); const cached = details === undefined ? 0 : number(details.cached_tokens);
      if (inputTokens === undefined || outputTokens === undefined || total !== inputTokens + outputTokens || cached === undefined) throw new CodexOAuthModelTurnError("malformed-sse", "The completed response usage was malformed.");
      if (!Array.isArray(completed?.output)) throw new CodexOAuthModelTurnError("malformed-sse", "The completed response output was missing.");
      const terminalItems = completed.output.map(decodeDoneItem); const terminalIds = new Set<string>(); const terminalCallIds = new Set<string>();
      for (const item of terminalItems) {
        if (terminalIds.has(item.id) || (item.callId !== undefined && terminalCallIds.has(item.callId))) throw new CodexOAuthModelTurnError("malformed-sse", "The completed response repeated an output item.");
        terminalIds.add(item.id); if (item.callId !== undefined) terminalCallIds.add(item.callId);
      }
      if (streamedItems.length > 0) {
        const matches = terminalItems.length === streamedItems.length && terminalItems.every((item, index) => {
          const streamed = streamedItems[index];
          return streamed !== undefined && item.id === streamed.id && JSON.stringify(item.parts) === JSON.stringify(streamed.parts);
        });
        if (!matches) throw new CodexOAuthModelTurnError("malformed-sse", "The completed response did not match streamed output.");
      }
      const authoritativeItems = streamedItems.length > 0 ? streamedItems : terminalItems;
      const parts = authoritativeItems.flatMap((item) => structuredClone(item.parts));
      terminal = {
        parts,
        usage: { inputTokens, outputTokens, cacheReadTokens: cached, cacheWriteTokens: 0 },
        stopReason: parts.some((part) => part.type === "tool-call") ? "tool_use" : "completed",
      };
    }
  };
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (bytes > limits.maxBytes) throw new CodexOAuthModelTurnError("response-too-large", "The provider response exceeded the byte bound.");
      buffer += decoder.decode(next.value, { stream: true });
      while (true) { const match = /\r?\n\r?\n/.exec(buffer); if (!match || match.index === undefined) break; const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length); processBlock(block); }
    }
    buffer += decoder.decode(); if (buffer.trim().length > 0) processBlock(buffer);
  } catch (error) {
    if (error instanceof CodexOAuthModelTurnError) throw error;
    throw new CodexOAuthModelTurnError("malformed-sse", "The provider response stream could not be decoded.");
  }
  if (!terminal) throw new CodexOAuthModelTurnError("incomplete-stream", "The provider stream ended before response.completed.");
  try { validateModelTurnResult(terminal); }
  catch { throw new CodexOAuthModelTurnError("malformed-sse", "The provider response violated the model-turn contract."); }
  return terminal;
}

export class CodexOAuthModelTurnDispatcher implements ModelGatewayOneRoundDispatcher {
  readonly #account: AccountRef; readonly #credential: CodexOAuthResolvedCredential; readonly #fetch: typeof fetch; readonly #sseLimits: CodexOAuthSseLimits;
  constructor(options: CodexOAuthModelTurnDispatcherOptions) {
    if (typeof options.credential.accessToken !== "string" || options.credential.accessToken.length === 0 || /[\r\n]/.test(options.credential.accessToken)) throw new TypeError("A resolved access token is required.");
    if (options.credential.chatgptAccountId !== undefined && !/^[A-Za-z0-9._:-]{1,256}$/.test(options.credential.chatgptAccountId)) throw new TypeError("A safe ChatGPT account ID is required.");
    const limits = options.sseLimits ?? CODEX_OAUTH_SSE_LIMITS;
    if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || !Number.isSafeInteger(limits.maxEvents) || limits.maxEvents < 1) throw new TypeError("Positive SSE bounds are required.");
    this.#account = options.account; this.#credential = { ...options.credential }; this.#fetch = options.fetch; this.#sseLimits = { ...limits };
  }
  async dispatchOneRound(input: ModelGatewayOneRoundDispatchInput): Promise<ModelTurnResult> {
    if (input.account !== this.#account) throw new CodexOAuthModelTurnError("account-mismatch", "The dispatcher is bound to a different account.");
    if (input.route.providerId !== "codex-oauth" || typeof input.route.providerModelId !== "string" || input.route.providerModelId.length === 0) throw new CodexOAuthModelTurnError("route-mismatch", "The dispatcher requires a Codex OAuth provider route.");
    if (input.signal?.aborted) throw new CodexOAuthModelTurnError("aborted", "The invocation was aborted.");
    const body = encodeCodexOAuthResponsesRequest(input);
    let response: Response;
    try {
      response = await this.#fetch(CODEX_OAUTH_RESPONSES_ENDPOINT, { method: "POST", headers: {
        authorization: `Bearer ${this.#credential.accessToken}`, "content-type": "application/json", accept: "text/event-stream",
        ...(this.#credential.chatgptAccountId === undefined ? {} : { "ChatGPT-Account-ID": this.#credential.chatgptAccountId }),
      }, body: JSON.stringify(body), signal: input.signal });
    } catch {
      if (input.signal?.aborted) throw new CodexOAuthModelTurnError("aborted", "The invocation was aborted.");
      throw new CodexOAuthModelTurnError("network-error", "The provider request could not be completed.");
    }
    const requestId = safeRequestId(response.headers);
    if (!response.ok) throw new CodexOAuthModelTurnError("http-error", "The provider rejected the request.", response.status, requestId);
    try { return await decodeCodexSse(response, this.#sseLimits); }
    catch (error) {
      if (input.signal?.aborted) throw new CodexOAuthModelTurnError("aborted", "The invocation was aborted.");
      if (error instanceof CodexOAuthModelTurnError && requestId && error.providerRequestId === undefined) throw new CodexOAuthModelTurnError(error.code, error.message, error.status, requestId);
      throw error;
    }
  }
}
