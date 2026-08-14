import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync,
  zstdDecompressSync,
} from "node:zlib";
import type { ModelGatewayConfig, ModelGatewayVirtualModelConfig } from "@kilnai/core";
import { claimModelGatewayRequestLifetime } from "./model-gateway-request-lifetime.js";

export const CODEX_COMPOSITE_PATH_PREFIX = "/.well-known/kiln/codex-composite";
const CODEX_NATIVE_BASE_URL = "https://chatgpt.com/backend-api/codex";
const CAPABILITY_CONTEXT = "kiln-codex-composite-v1";

const NATIVE_HEADER_ALLOWLIST = new Set([
  "authorization",
  "chatgpt-account-id",
  "content-encoding",
  "content-type",
  "openai-beta",
  "originator",
  "session-id",
  "thread-id",
  "x-client-request-id",
  "x-codex-beta-features",
  "x-codex-installation-id",
  "x-codex-parent-thread-id",
  "x-codex-turn-metadata",
  "x-codex-turn-state",
  "x-codex-window-id",
  "x-oai-attestation",
  "x-openai-subagent",
  "x-responsesapi-include-timing-metrics",
]);

const COMPOSITE_POST_PATHS = new Set([
  "/v1/responses",
  "/v1/responses/compact",
  "/v1/alpha/search",
  "/v1/images/edits",
  "/v1/images/generations",
]);
const MODEL_ROUTED_PATHS = new Set(["/v1/responses", "/v1/responses/compact"]);
const COMPACTION_SUMMARY_PROMPT = "Create a concise checkpoint summary that preserves the task, decisions, completed work, current state, blockers, and exact next actions for another coding agent. Do not continue the task.";
const MAX_COMPACTION_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_RETAINED_USER_TEXT_CHARS = 80_000;
// Queue waiters retain only their Request stream; bodies are read only after admission.

export interface CodexCompositeFetchOptions {
  readonly config: ModelGatewayConfig;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly canonicalFetch: (request: Request) => Response | Promise<Response>;
  readonly nativeFetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly nativeBaseUrl?: string;
  readonly ingressCapacityEvidence?: { record(evidence: CodexCompositeIngressCapacityEvidence): Promise<void> };
}

export type CodexCompositeRequestClass = "responses" | "compact" | "search" | "image-edits" | "image-generations";
export interface CodexCompositeIngressCapacityEvidence {
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly requestClass: CodexCompositeRequestClass;
  readonly outcome: "queue-full" | "queue-timeout";
  readonly origin: "ingress";
  readonly phase: "pre-dispatch";
  readonly retryable: true;
  readonly retryAfterSeconds: number;
  readonly waitMs: number;
}

export function createCodexCompositeCapability(principalToken: string): string {
  if (Buffer.byteLength(principalToken, "utf8") < 32) {
    throw new Error("Codex composite routing requires a principal token containing at least 32 bytes.");
  }
  return createHmac("sha256", principalToken).update(CAPABILITY_CONTEXT, "utf8").digest("base64url");
}

export function createCodexCompositeFetch(options: CodexCompositeFetchOptions): (request: Request) => Promise<Response> {
  const env = options.env ?? process.env;
  const principals = options.config.principals.filter(
    (principal) => principal.ingress === "openai-responses" && principal.nativeHarness === "codex",
  );
  if (principals.length !== 1) {
    throw new Error("Codex composite routing requires exactly one Codex Responses principal.");
  }
  const principal = principals[0]!;
  const principalToken = env[principal.tokenEnv];
  if (!principalToken) throw new Error(`Codex principal token '${principal.tokenEnv}' is missing.`);
  const capability = createCodexCompositeCapability(principalToken);
  const prefix = `${CODEX_COMPOSITE_PATH_PREFIX}/${capability}`;
  const virtualModelIds = new Set(principal.virtualModelIds);
  const virtualModels = new Map(options.config.virtualModels.map((model) => [model.id, model]));
  const surface = options.config.surfaces.openAIResponses;
  if (!surface) throw new Error("Codex composite routing requires the OpenAI Responses surface.");
  const maxBodyBytes = surface.maxBodyBytes;
  const backpressure = options.config.codexComposite;
  if (!backpressure) throw new Error("Codex composite routing requires codexComposite ingress policy.");
  const capacityByClass = new Map<CodexCompositeRequestClass, CompositeBackpressure>();
  for (const requestClass of COMPOSITE_REQUEST_CLASSES) {
    capacityByClass.set(requestClass, new CompositeBackpressure(
      surface.maxConcurrentRequests,
      backpressure.maxQueuedRequests,
      backpressure.queueTimeoutMs,
    ));
  }
  const nativeFetch = options.nativeFetch ?? fetch;
  const nativeBaseUrl = (options.nativeBaseUrl ?? CODEX_NATIVE_BASE_URL).replace(/\/+$/u, "");

  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${CODEX_COMPOSITE_PATH_PREFIX}/`)) {
      return options.canonicalFetch(request);
    }
    const routePath = authenticateCompositePath(url.pathname, prefix);
    if (!routePath) return jsonError(401, "invalid_composite_capability");
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return new Response(null, { status: 426, headers: { connection: "close" } });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (request.method !== "POST" || !COMPOSITE_POST_PATHS.has(routePath)) {
      return jsonError(404, "unsupported_composite_route");
    }

    const requestClass = classifyCompositeRequest(routePath);
    const correlationId = randomUUID();
    const admission = await capacityByClass.get(requestClass)!.acquire(request.signal);
    if (admission.kind !== "acquired") {
      const retryAfterSeconds = Math.max(1, Math.ceil(backpressure.queueTimeoutMs / 1_000));
      try {
        await options.ingressCapacityEvidence?.record({
          occurredAt: new Date().toISOString(), correlationId, requestClass,
          outcome: admission.kind, origin: "ingress", phase: "pre-dispatch",
          retryable: true, retryAfterSeconds, waitMs: admission.waitMs,
        });
      } catch {
        // Capacity evidence is observability; it must never replace the stable ingress response.
      }
      return ingressCapacityError(admission.kind, correlationId, retryAfterSeconds);
    }
    let releaseOnFailure = true;
    try {
      let encodedBody: Buffer;
      try {
        encodedBody = await readBoundedRequestBody(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof CompositeRequestError) return compositeError(error, maxBodyBytes);
        throw error;
      }
      let decodedBody: Buffer;
      try {
        decodedBody = decodeBody(encodedBody, request.headers.get("content-encoding"), maxBodyBytes);
      } catch (error) {
        if (error instanceof CompositeRequestError) return compositeError(error, maxBodyBytes);
        throw error;
      }
      let requestedModel: string | undefined;
      let parsed: Record<string, unknown> | undefined;
      if (MODEL_ROUTED_PATHS.has(routePath)) {
        try {
          parsed = parseRequestObject(decodedBody);
        } catch (error) {
          if (error instanceof CompositeRequestError) return jsonError(error.status, error.type);
          throw error;
        }
        if (typeof parsed.model !== "string" || parsed.model.length === 0) {
          return jsonError(400, "model_required");
        }
        requestedModel = parsed.model;
      }

      if (!requestedModel || !virtualModelIds.has(requestedModel)) {
        const authorization = request.headers.get("authorization");
        if (!authorization?.startsWith("Bearer ")) return jsonError(401, "native_authentication_required");
      }
      claimModelGatewayRequestLifetime(request);

      let response: Response;
      if (requestedModel && virtualModelIds.has(requestedModel)) {
        const virtualModel = virtualModels.get(requestedModel);
        if (!virtualModel) return jsonError(422, "virtual_model_not_configured");
        const normalized = normalizeVirtualRequest(parsed!, virtualModel);
        const headers = new Headers(request.headers);
        headers.set("authorization", `Bearer ${principalToken}`);
        headers.set("content-type", "application/json");
        headers.delete("content-encoding");
        headers.delete("content-length");
        const canonicalUrl = new URL(request.url);
        canonicalUrl.pathname = "/v1/responses";
        canonicalUrl.search = "";
        if (routePath === "/v1/responses/compact") {
          try {
            response = await compactVirtualRequest({
              request: normalized,
              canonicalUrl,
              headers,
              canonicalFetch: options.canonicalFetch,
              signal: request.signal,
            });
          } catch (error) {
            if (error instanceof CompositeRequestError) return jsonError(error.status, error.type);
            throw error;
          }
        } else {
          response = await options.canonicalFetch(new Request(canonicalUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(normalized),
            signal: request.signal,
          }));
        }
      } else {
        const headers = copyAllowedNativeHeaders(request.headers);
        const upstreamPath = routePath.replace(/^\/v1(?=\/|$)/u, "");
        const search = routePath === "/v1/alpha/search" && url.searchParams.get("source") === "codex"
          ? "?source=codex"
          : "";
        response = await nativeFetch(`${nativeBaseUrl}${upstreamPath}${search}`, {
          method: "POST",
          headers,
          body: Uint8Array.from(encodedBody),
          signal: request.signal,
        });
      }
      releaseOnFailure = false;
      return retainResponseCapacity(response, admission.release, request.signal);
    } finally {
      if (releaseOnFailure) admission.release();
    }
  };
}

const COMPOSITE_REQUEST_CLASSES: readonly CodexCompositeRequestClass[] = ["responses", "compact", "search", "image-edits", "image-generations"];
function classifyCompositeRequest(path: string): CodexCompositeRequestClass {
  if (path === "/v1/responses") return "responses";
  if (path === "/v1/responses/compact") return "compact";
  if (path === "/v1/alpha/search") return "search";
  if (path === "/v1/images/edits") return "image-edits";
  return "image-generations";
}

function retainResponseCapacity(response: Response, release: () => void, signal: AbortSignal): Response {
  const upstreamBody = response.body;
  if (!upstreamBody) {
    release();
    return response;
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    signal.removeEventListener("abort", finish);
    release();
  };
  const body = new ReadableStream<Uint8Array>({
    start() {
      reader = upstreamBody.getReader();
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    },
    async pull(controller) {
      try {
        const part = await reader!.read();
        if (part.done) {
          controller.close();
          finish();
        } else {
          controller.enqueue(part.value);
        }
      } catch (error) {
        controller.error(error);
        finish();
      }
    },
    async cancel(reason) {
      try {
        await reader!.cancel(reason);
      } finally {
        finish();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

type CapacityAdmission =
  | { readonly kind: "acquired"; readonly release: () => void }
  | { readonly kind: "queue-full" | "queue-timeout"; readonly waitMs: number };
type CapacityWaiter = {
  startedAt: number;
  resolve: (value: CapacityAdmission) => void;
  signal: AbortSignal;
  timeout: ReturnType<typeof setTimeout>;
  abort: () => void;
};
class CompositeBackpressure {
  readonly #queue: CapacityWaiter[] = [];
  #active = 0;
  constructor(readonly maximum: number, readonly maxQueued: number, readonly timeoutMs: number) {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new TypeError("Codex composite maxConcurrentRequests is invalid.");
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) throw new TypeError("Codex composite maxQueuedRequests is invalid.");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("Codex composite queueTimeoutMs is invalid.");
  }
  async acquire(signal: AbortSignal): Promise<CapacityAdmission> {
    if (signal.aborted) throw signal.reason ?? new DOMException("The request was aborted.", "AbortError");
    if (this.#active < this.maximum) {
      this.#active += 1;
      return { kind: "acquired", release: this.#release() };
    }
    if (this.#queue.length >= this.maxQueued) return { kind: "queue-full", waitMs: 0 };
    return new Promise<CapacityAdmission>((resolve, reject) => {
      const startedAt = Date.now();
      const waiter = {} as CapacityWaiter;
      const remove = () => {
        const index = this.#queue.indexOf(waiter);
        if (index >= 0) this.#queue.splice(index, 1);
      };
      waiter.startedAt = startedAt;
      waiter.resolve = resolve;
      waiter.signal = signal;
      waiter.abort = () => {
        clearTimeout(waiter.timeout);
        remove();
        reject(signal.reason ?? new DOMException("The request was aborted.", "AbortError"));
      };
      waiter.timeout = setTimeout(() => {
        signal.removeEventListener("abort", waiter.abort);
        remove();
        resolve({ kind: "queue-timeout", waitMs: Date.now() - startedAt });
      }, this.timeoutMs);
      signal.addEventListener("abort", waiter.abort, { once: true });
      this.#queue.push(waiter);
    });
  }
  #release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.#queue.shift();
      if (waiter) {
        clearTimeout(waiter.timeout);
        waiter.signal.removeEventListener("abort", waiter.abort);
        waiter.resolve({ kind: "acquired", release: this.#release() });
      } else {
        this.#active -= 1;
      }
    };
  }
}

async function compactVirtualRequest(input: {
  readonly request: Record<string, unknown>;
  readonly canonicalUrl: URL;
  readonly headers: Headers;
  readonly canonicalFetch: CodexCompositeFetchOptions["canonicalFetch"];
  readonly signal: AbortSignal;
}): Promise<Response> {
  const history = Array.isArray(input.request.input) ? structuredClone(input.request.input) : [];
  const summaryRequest: Record<string, unknown> = {
    model: input.request.model,
    input: [...history, { type: "message", role: "user", content: [{ type: "input_text", text: COMPACTION_SUMMARY_PROMPT }] }],
    tools: [],
    tool_choice: "none",
    parallel_tool_calls: false,
    store: false,
    stream: true,
  };
  if (typeof input.request.instructions === "string") summaryRequest.instructions = input.request.instructions;
  if (typeof input.request.prompt_cache_key === "string") summaryRequest.prompt_cache_key = `${input.request.prompt_cache_key}:compact`;
  if (input.request.client_metadata && typeof input.request.client_metadata === "object" && !Array.isArray(input.request.client_metadata)) {
    summaryRequest.client_metadata = structuredClone(input.request.client_metadata);
  }
  const response = await input.canonicalFetch(new Request(input.canonicalUrl, {
    method: "POST",
    headers: input.headers,
    body: JSON.stringify(summaryRequest),
    signal: input.signal,
  }));
  if (!response.ok) return response;
  const text = await readBoundedResponse(response, MAX_COMPACTION_RESPONSE_BYTES);
  const summary = extractSseText(text).trim();
  if (!summary) return jsonError(502, "empty_compaction_summary");
  return Response.json({ output: compactedHistory(history, summary) });
}

async function readBoundedResponse(response: Response, maximum: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > maximum) {
      await reader.cancel();
      throw new CompositeRequestError(502, "compaction_response_too_large");
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return text + decoder.decode();
}

function extractSseText(text: string): string {
  let output = "";
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith("data:") || line === "data: [DONE]") continue;
    let event: unknown;
    try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const record = event as Record<string, unknown>;
    if (record.type === "response.output_text.delta" && typeof record.delta === "string") output += record.delta;
  }
  return output;
}

function compactedHistory(history: readonly unknown[], summary: string): Record<string, unknown>[] {
  const retained: string[] = [];
  let remaining = MAX_RETAINED_USER_TEXT_CHARS;
  for (let index = history.length - 1; index >= 0 && remaining > 0; index--) {
    const item = history[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "message" || record.role !== "user") continue;
    const value = messageText(record.content);
    if (!value.trim()) continue;
    const selected = value.length <= remaining ? value : value.slice(value.length - remaining);
    retained.push(selected);
    remaining -= selected.length;
  }
  retained.reverse();
  return [...retained, `[Kiln checkpoint]\n${summary}`].map((text) => ({
    type: "message", role: "user", content: [{ type: "input_text", text }],
  }));
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => part && typeof part === "object" && !Array.isArray(part)
    && (part as Record<string, unknown>).type === "input_text"
    && typeof (part as Record<string, unknown>).text === "string"
    ? [(part as Record<string, unknown>).text as string]
    : []).join("");
}

function normalizeVirtualRequest(
  request: Record<string, unknown>,
  model: ModelGatewayVirtualModelConfig,
): Record<string, unknown> {
  const normalized = structuredClone(request);
  const capabilities = new Set(model.capabilities);
  if (Array.isArray(normalized.tools)) {
    normalized.tools = normalized.tools.filter((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
      const type = (raw as Record<string, unknown>).type;
      if (type === "function" || type === "namespace") return capabilities.has("function-tools");
      if (type === "custom") return capabilities.has("custom-tools-lark");
      return false;
    });
  }
  if (!capabilities.has("parallel-tool-calls")) normalized.parallel_tool_calls = false;
  if (!capabilities.has("reasoning-controls")) delete normalized.reasoning;
  if (normalized.text && typeof normalized.text === "object" && !Array.isArray(normalized.text)) {
    const text = { ...(normalized.text as Record<string, unknown>) };
    if (!capabilities.has("text-verbosity")) delete text.verbosity;
    if (!capabilities.has("json-schema-response")) delete text.format;
    if (Object.keys(text).length === 0) delete normalized.text;
    else normalized.text = text;
  }
  return normalized;
}

function authenticateCompositePath(pathname: string, expectedPrefix: string): string | undefined {
  const prefixLength = expectedPrefix.length;
  if (pathname.length <= prefixLength || pathname[prefixLength] !== "/") return undefined;
  const presented = pathname.slice(0, prefixLength);
  const actualBytes = Buffer.from(presented, "utf8");
  const expectedBytes = Buffer.from(expectedPrefix, "utf8");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return undefined;
  return pathname.slice(prefixLength);
}

function decodeBody(encoded: Buffer, contentEncoding: string | null, maxBodyBytes: number): Buffer {
  const encodings = (contentEncoding ?? "")
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter((encoding) => encoding && encoding !== "identity")
    .reverse();
  let decoded = encoded;
  try {
    for (const encoding of encodings) {
      const limits = { maxOutputLength: maxBodyBytes };
      if (encoding === "zstd") decoded = zstdDecompressSync(decoded, limits);
      else if (encoding === "gzip" || encoding === "x-gzip") decoded = gunzipSync(decoded, limits);
      else if (encoding === "deflate") decoded = inflateSync(decoded, limits);
      else if (encoding === "br") decoded = brotliDecompressSync(decoded, limits);
      else throw new CompositeRequestError(415, "unsupported_content_encoding");
    }
  } catch (error) {
    if (error instanceof CompositeRequestError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") {
      throw new CompositeRequestError(413, "request_too_large");
    }
    throw new CompositeRequestError(400, "invalid_content_encoding");
  }
  if (decoded.byteLength > maxBodyBytes) throw new CompositeRequestError(413, "request_too_large");
  return decoded;
}

async function readBoundedRequestBody(request: Request, maxBodyBytes: number): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maxBodyBytes)) {
    throw new CompositeRequestError(413, "request_too_large");
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        throw new CompositeRequestError(413, "request_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function parseRequestObject(body: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString("utf8")); }
  catch { throw new CompositeRequestError(400, "invalid_json"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CompositeRequestError(400, "invalid_json");
  }
  return parsed as Record<string, unknown>;
}

function copyAllowedNativeHeaders(source: Headers): Headers {
  const headers = new Headers({ accept: "text/event-stream", "accept-encoding": "identity" });
  for (const [name, value] of source) {
    if (NATIVE_HEADER_ALLOWLIST.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

function jsonError(status: number, type: string): Response {
  return Response.json({ error: { type } }, { status });
}

function ingressCapacityError(
  outcome: "queue-full" | "queue-timeout",
  correlationId: string,
  retryAfterSeconds: number,
): Response {
  const code = outcome === "queue-full" ? "ingress_queue_full" : "ingress_queue_timeout";
  return Response.json({ error: {
    type: code,
    code,
    origin: "ingress",
    phase: "pre-dispatch",
    retryable: true,
    retry_after_seconds: retryAfterSeconds,
    correlation_id: correlationId,
  } }, {
    status: 503,
    headers: {
      "retry-after": String(retryAfterSeconds),
      "x-kiln-error-origin": "ingress",
      "x-kiln-error-phase": "pre-dispatch",
      "x-kiln-correlation-id": correlationId,
    },
  });
}

function compositeError(error: CompositeRequestError, maxBodyBytes: number): Response {
  if (error.type !== "request_too_large") return jsonError(error.status, error.type);
  return Response.json({ error: {
    type: error.type,
    message: `The request body exceeds Kiln's configured ${maxBodyBytes}-byte limit.`,
    max_body_bytes: maxBodyBytes,
  } }, {
    status: error.status,
    headers: { "x-kiln-request-body-limit-bytes": String(maxBodyBytes) },
  });
}

class CompositeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
  ) {
    super(type);
  }
}
