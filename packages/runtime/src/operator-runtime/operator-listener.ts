import { createHash, timingSafeEqual } from "node:crypto";
import { posix, win32 } from "node:path";
import {
  OperatorRuntimeApplicationRequestSchema,
  OperatorRuntimeApplicationResponseSchema,
  OperatorRuntimePrincipalSchema,
  OperatorProjectBindingSchema,
  OperatorSupervisorIdentitySchema,
  type OperatorRuntimePrincipal,
  type OperatorRuntimeApplicationRequest,
  type OperatorRuntimeApplicationResponse,
  type OperatorSessionClaims,
  type OperatorSupervisorIdentity,
} from "@kilnai/gateway-contracts";
import { verifyOperatorSessionCredential } from "./operator-session-auth.js";

export const OPERATOR_RUNTIME_MCP_PATH = "/.well-known/kiln/operator-runtime/mcp";
export const OPERATOR_RUNTIME_APPLICATION_PATH = "/.well-known/kiln/operator-runtime/application";
export const OPERATOR_RUNTIME_HEALTH_PATH = "/.well-known/kiln/operator-runtime/ready";
export const OPERATOR_RUNTIME_SESSION_PATH = "/.well-known/kiln/operator-runtime/session";
export const OPERATOR_RUNTIME_SHUTDOWN_PATH = "/.well-known/kiln/operator-runtime/shutdown";
export const OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER = "x-kiln-control-token";
export const OPERATOR_RUNTIME_REQUEST_MAX_BYTES = 1_048_576;
export const OPERATOR_RUNTIME_SESSION_REQUEST_MAX_BYTES = 16_384;
export const OPERATOR_RUNTIME_INSPECTION_MAX_RESPONSE_BYTES = 16_384;
export const OPERATOR_RUNTIME_INSPECTION_MAX_TIMEOUT_MS = 5_000;

export const OPERATOR_RUNTIME_BINDING_HEADERS = {
  projectRuntimeId: "x-kiln-project-runtime-id",
  compositionRevision: "x-kiln-composition-revision",
  principalKind: "x-kiln-principal-kind",
  principalId: "x-kiln-principal-id",
  sessionId: "x-kiln-session-id",
} as const;

const CONTROL_TOKEN_MIN_BYTES = 32;
const CONTROL_TOKEN_MAX_BYTES = 512;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ALLOWED_MCP_METHODS: ReadonlySet<string> = new Set(["POST", "GET", "DELETE"]);

export type OperatorRuntimeListenerFetch = (request: Request) => Response | Promise<Response>;

export interface OperatorRuntimeMcpRequest {
  readonly claims: OperatorSessionClaims;
  /** Bounded request with listener credentials and binding headers removed. */
  readonly request: Request;
}

export interface OperatorRuntimeApplicationCommand {
  readonly claims: OperatorSessionClaims;
  readonly request: OperatorRuntimeApplicationRequest;
}

export interface OperatorRuntimeSessionOpenInput {
  readonly schemaVersion: 3;
  readonly canonicalRoot: string;
  readonly binding: {
    readonly projectRuntimeId: string;
    readonly compositionRevision: string;
  };
  readonly principal: OperatorRuntimePrincipal;
  readonly sessionId: string;
}

export interface OperatorRuntimeSessionOpenResult {
  readonly credential: string;
  readonly expiresAt: number;
}

export interface StartOperatorRuntimeListenerOptions {
  readonly port: number;
  readonly identity: OperatorSupervisorIdentity;
  readonly controlToken: string;
  readonly sessionSecret: Uint8Array;
  readonly onMcpRequest: (input: OperatorRuntimeMcpRequest) => Response | Promise<Response>;
  readonly onApplicationRequest: (
    input: OperatorRuntimeApplicationCommand,
  ) => OperatorRuntimeApplicationResponse | Promise<OperatorRuntimeApplicationResponse>;
  readonly onSessionOpen: (
    input: OperatorRuntimeSessionOpenInput,
  ) => OperatorRuntimeSessionOpenResult | Promise<OperatorRuntimeSessionOpenResult>;
  readonly nowEpochSeconds?: () => number;
  readonly listen?: (input: {
    readonly hostname: "127.0.0.1";
    readonly port: number;
    readonly fetch: OperatorRuntimeListenerFetch;
  }) => { stop(force?: boolean): void };
}

export interface OperatorRuntimeListener {
  close(): void;
  readonly shutdownRequested: Promise<void>;
}

export type OperatorRuntimeListenerInspection =
  | { readonly state: "ready"; readonly identity: OperatorSupervisorIdentity }
  | { readonly state: "foreign"; readonly reason: "unauthorized" | "identity-mismatch" | "unexpected-response" }
  | { readonly state: "stopped" };

export type OperatorRuntimeShutdownResult =
  | { readonly state: "accepted" }
  | { readonly state: "foreign"; readonly reason: "unauthorized" | "identity-mismatch" | "unexpected-response" }
  | { readonly state: "stopped" };

/**
 * Starts the authenticated loopback boundary for the operator runtime.
 * Project lookup and MCP composition remain behind the injected handler.
 */
export async function startOperatorRuntimeListener(
  options: StartOperatorRuntimeListenerOptions,
): Promise<OperatorRuntimeListener> {
  const identity = parseIdentity(options.identity, options.port);
  const controlTokenDigest = digestControlToken(options.controlToken);
  requireSessionSecret(options.sessionSecret);
  let resolveShutdownRequested!: () => void;
  const shutdownRequested = new Promise<void>((resolve) => { resolveShutdownRequested = resolve; });

  const fetchHandler: OperatorRuntimeListenerFetch = (request) => handleRequest({
    request,
    port: options.port,
    identity,
    controlTokenDigest,
    sessionSecret: options.sessionSecret,
    nowEpochSeconds: options.nowEpochSeconds,
    onMcpRequest: options.onMcpRequest,
    onApplicationRequest: options.onApplicationRequest,
    onSessionOpen: options.onSessionOpen,
    requestShutdown: () => queueMicrotask(resolveShutdownRequested),
  });

  const listener = options.listen
    ? options.listen({ hostname: "127.0.0.1", port: options.port, fetch: fetchHandler })
    : Bun.serve({ hostname: "127.0.0.1", port: options.port, fetch: fetchHandler });

  let closed = false;
  return {
    shutdownRequested,
    close(): void {
      if (closed) return;
      closed = true;
      listener.stop(false);
    },
  };
}

export async function requestOperatorRuntimeShutdown(input: {
  readonly port: number;
  readonly controlToken: string;
  readonly identity: OperatorSupervisorIdentity;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<OperatorRuntimeShutdownResult> {
  const identity = OperatorSupervisorIdentitySchema.parse(input.identity);
  if (identity.port !== input.port) return { state: "foreign", reason: "identity-mismatch" };
  const authority = `127.0.0.1:${input.port}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 1_000);
  try {
    const response = await (input.fetch ?? fetch)(`http://${authority}${OPERATOR_RUNTIME_SHUTDOWN_PATH}`, {
      method: "POST",
      headers: {
        host: authority,
        origin: `http://${authority}`,
        [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: input.controlToken,
        "x-kiln-instance-id": identity.instanceId,
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.headers.get("x-kiln-service") !== "operator-runtime") {
      discardResponseBody(response);
      return { state: "foreign", reason: "unexpected-response" };
    }
    if (response.status === 401) return { state: "foreign", reason: "unauthorized" };
    if (response.status === 409) return { state: "foreign", reason: "identity-mismatch" };
    return response.status === 202
      ? { state: "accepted" }
      : { state: "foreign", reason: "unexpected-response" };
  } catch (error) {
    return isConnectionRefused(error)
      ? { state: "stopped" }
      : { state: "foreign", reason: "unexpected-response" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Inspects only the authenticated private health route and returns closed, non-sensitive states. */
export async function inspectOperatorRuntimeListener(input: {
  readonly port: number;
  readonly controlToken: string;
  readonly expectedIdentity?: OperatorSupervisorIdentity;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<OperatorRuntimeListenerInspection> {
  if (!Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new Error("Operator runtime inspection port must be an explicit valid TCP port.");
  }
  const timeoutMs = input.timeoutMs ?? 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > OPERATOR_RUNTIME_INSPECTION_MAX_TIMEOUT_MS) {
    throw new Error(`Operator runtime inspection timeout must be between 1 and ${OPERATOR_RUNTIME_INSPECTION_MAX_TIMEOUT_MS} milliseconds.`);
  }
  const expectedIdentity = input.expectedIdentity === undefined
    ? undefined
    : OperatorSupervisorIdentitySchema.parse(input.expectedIdentity);
  const authority = `127.0.0.1:${input.port}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (input.fetch ?? fetch)(`http://${authority}${OPERATOR_RUNTIME_HEALTH_PATH}`, {
      method: "GET",
      headers: {
        host: authority,
        origin: `http://${authority}`,
        [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: input.controlToken,
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.headers.get("x-kiln-service") !== "operator-runtime") {
      discardResponseBody(response);
      return { state: "foreign", reason: "unexpected-response" };
    }
    if (response.status === 401) {
      discardResponseBody(response);
      return { state: "foreign", reason: "unauthorized" };
    }
    if (!response.ok) {
      discardResponseBody(response);
      return { state: "foreign", reason: "unexpected-response" };
    }
    const value = await readBoundedJson(response, OPERATOR_RUNTIME_INSPECTION_MAX_RESPONSE_BYTES);
    const parsed = OperatorSupervisorIdentitySchema.safeParse(value);
    if (!parsed.success) return { state: "foreign", reason: "unexpected-response" };
    if (
      parsed.data.port !== input.port ||
      (expectedIdentity !== undefined && !identitiesEqual(parsed.data, expectedIdentity))
    ) {
      return { state: "foreign", reason: "identity-mismatch" };
    }
    return { state: "ready", identity: parsed.data };
  } catch (error) {
    return isConnectionRefused(error)
      ? { state: "stopped" }
      : { state: "foreign", reason: "unexpected-response" };
  } finally {
    clearTimeout(timeout);
  }
}

interface HandleRequestInput {
  readonly request: Request;
  readonly port: number;
  readonly identity: OperatorSupervisorIdentity;
  readonly controlTokenDigest: Buffer;
  readonly sessionSecret: Uint8Array;
  readonly nowEpochSeconds?: () => number;
  readonly onMcpRequest: (input: OperatorRuntimeMcpRequest) => Response | Promise<Response>;
  readonly onApplicationRequest: (
    input: OperatorRuntimeApplicationCommand,
  ) => OperatorRuntimeApplicationResponse | Promise<OperatorRuntimeApplicationResponse>;
  readonly onSessionOpen: (
    input: OperatorRuntimeSessionOpenInput,
  ) => OperatorRuntimeSessionOpenResult | Promise<OperatorRuntimeSessionOpenResult>;
  readonly requestShutdown: () => void;
}

async function handleRequest(input: HandleRequestInput): Promise<Response> {
  const isHealthRequest = requestPathname(input.request) === OPERATOR_RUNTIME_HEALTH_PATH;
  const isShutdownRequest = requestPathname(input.request) === OPERATOR_RUNTIME_SHUTDOWN_PATH;
  const boundaryError = validateLoopbackBoundary(input.request, input.port);
  if (boundaryError) return isHealthRequest || isShutdownRequest ? withOperatorServiceHeader(boundaryError) : boundaryError;

  const url = new URL(input.request.url);
  if (url.pathname === OPERATOR_RUNTIME_HEALTH_PATH) {
    if (input.request.method !== "GET") {
      return withOperatorServiceHeader(errorResponse(405, "method_not_allowed"));
    }
    if (hasRequestBody(input.request)) {
      return withOperatorServiceHeader(errorResponse(400, "body_not_allowed"));
    }
    if (!hasValidControlToken(input.request.headers, input.controlTokenDigest)) {
      return withOperatorServiceHeader(errorResponse(401, "unauthorized"));
    }
    return withOperatorServiceHeader(jsonResponse(input.identity, 200));
  }

  if (url.pathname === OPERATOR_RUNTIME_SHUTDOWN_PATH) {
    if (input.request.method !== "POST") {
      return withOperatorServiceHeader(errorResponse(405, "method_not_allowed"));
    }
    if (hasRequestBody(input.request)) {
      return withOperatorServiceHeader(errorResponse(400, "body_not_allowed"));
    }
    if (!hasValidControlToken(input.request.headers, input.controlTokenDigest)) {
      return withOperatorServiceHeader(errorResponse(401, "unauthorized"));
    }
    if (input.request.headers.get("x-kiln-instance-id") !== input.identity.instanceId) {
      return withOperatorServiceHeader(errorResponse(409, "identity_mismatch"));
    }
    input.requestShutdown();
    return withOperatorServiceHeader(jsonResponse({ status: "accepted" }, 202));
  }

  if (url.pathname === OPERATOR_RUNTIME_SESSION_PATH) {
    return handleSessionOpen(input);
  }

  const isMcp = url.pathname === OPERATOR_RUNTIME_MCP_PATH;
  const isApplication = url.pathname === OPERATOR_RUNTIME_APPLICATION_PATH;
  if (!isMcp && !isApplication) return errorResponse(404, "not_found");
  if (isMcp ? !ALLOWED_MCP_METHODS.has(input.request.method) : input.request.method !== "POST") {
    return errorResponse(405, "method_not_allowed");
  }

  const binding = readExpectedBinding(input.request.headers);
  const credential = readBearerCredential(input.request.headers.get("authorization"));
  if (!binding || !credential) return errorResponse(401, "unauthorized");

  let claims: OperatorSessionClaims;
  try {
    claims = verifyOperatorSessionCredential(credential, input.sessionSecret, binding, {
      ...(input.nowEpochSeconds === undefined ? {} : { nowEpochSeconds: input.nowEpochSeconds() }),
    });
  } catch {
    return errorResponse(401, "unauthorized");
  }

  const declaredLength = readContentLength(input.request.headers.get("content-length"));
  if (declaredLength === "invalid") return errorResponse(400, "invalid_content_length");
  if (declaredLength !== undefined && declaredLength > OPERATOR_RUNTIME_REQUEST_MAX_BYTES) {
    return errorResponse(413, "payload_too_large");
  }

  const body = await readBoundedBody(input.request, OPERATOR_RUNTIME_REQUEST_MAX_BYTES);
  if (body === "too_large") return errorResponse(413, "payload_too_large");

  if (isApplication) {
    if (claims.principal.kind !== "operator-surface") return errorResponse(403, "principal_denied");
    if (input.request.headers.get("content-type")?.trim().toLowerCase() !== "application/json") {
      return errorResponse(415, "unsupported_media_type");
    }
    const request = parseApplicationRequest(body);
    if (!request) return errorResponse(400, "invalid_request");
    try {
      const response = OperatorRuntimeApplicationResponseSchema.safeParse(
        await input.onApplicationRequest({ claims, request }),
      );
      return response.success
        ? jsonResponse(response.data, 200)
        : errorResponse(503, "unavailable");
    } catch {
      return errorResponse(500, "internal");
    }
  }

  const boundedRequest = reconstructRequest(input.request, body);
  try {
    const response = await input.onMcpRequest({ claims, request: boundedRequest });
    return stripBrowserResponseHeaders(response);
  } catch {
    return errorResponse(500, "internal");
  }
}

function parseApplicationRequest(body: Uint8Array): OperatorRuntimeApplicationRequest | undefined {
  try {
    const parsed = OperatorRuntimeApplicationRequestSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function handleSessionOpen(input: HandleRequestInput): Promise<Response> {
  if (input.request.method !== "POST") return errorResponse(405, "method_not_allowed");
  if (!hasValidControlToken(input.request.headers, input.controlTokenDigest)) {
    return errorResponse(401, "unauthorized");
  }
  if (input.request.headers.get("content-type")?.trim().toLowerCase() !== "application/json") {
    return errorResponse(415, "unsupported_media_type");
  }
  const declaredLength = readContentLength(input.request.headers.get("content-length"));
  if (declaredLength === "invalid") return errorResponse(400, "invalid_content_length");
  if (declaredLength !== undefined && declaredLength > OPERATOR_RUNTIME_SESSION_REQUEST_MAX_BYTES) {
    return errorResponse(413, "payload_too_large");
  }
  const body = await readBoundedBody(input.request, OPERATOR_RUNTIME_SESSION_REQUEST_MAX_BYTES);
  if (body === "too_large") return errorResponse(413, "payload_too_large");
  const sessionInput = parseSessionOpenInput(body);
  if (!sessionInput) return errorResponse(400, "invalid_request");
  try {
    const result = parseSessionOpenResult(await input.onSessionOpen(sessionInput));
    return result ? jsonResponse(result, 200) : errorResponse(503, "unavailable");
  } catch {
    return errorResponse(503, "unavailable");
  }
}

function validateLoopbackBoundary(request: Request, port: number): Response | undefined {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return errorResponse(421, "invalid_host");
  }
  const expectedAuthority = `127.0.0.1:${port}`;
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== String(port) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    request.headers.get("host") !== expectedAuthority
  ) {
    return errorResponse(421, "invalid_host");
  }
  if (request.headers.get("origin") !== `http://${expectedAuthority}`) {
    return errorResponse(403, "invalid_origin");
  }
  if (request.headers.has("cookie")) return errorResponse(400, "browser_state_rejected");
  if (request.headers.has("upgrade")) return errorResponse(400, "upgrade_rejected");
  return undefined;
}

function readExpectedBinding(headers: Headers): {
  readonly projectRuntimeId: string;
  readonly compositionRevision: string;
  readonly principal: OperatorRuntimePrincipal;
  readonly sessionId: string;
} | undefined {
  const projectRuntimeId = headers.get(OPERATOR_RUNTIME_BINDING_HEADERS.projectRuntimeId);
  const compositionRevision = headers.get(OPERATOR_RUNTIME_BINDING_HEADERS.compositionRevision);
  const principalKind = headers.get(OPERATOR_RUNTIME_BINDING_HEADERS.principalKind);
  const principalId = headers.get(OPERATOR_RUNTIME_BINDING_HEADERS.principalId);
  const sessionId = headers.get(OPERATOR_RUNTIME_BINDING_HEADERS.sessionId);
  const projectBinding = OperatorProjectBindingSchema.safeParse({ projectRuntimeId, compositionRevision });
  const principal = OperatorRuntimePrincipalSchema.safeParse(
    principalKind === "native-harness"
      ? { kind: principalKind, harness: principalId }
      : { kind: principalKind, surface: principalId },
  );
  if (
    !projectBinding.success ||
    !principal.success ||
    !sessionId ||
    !SESSION_ID_PATTERN.test(sessionId)
  ) {
    return undefined;
  }
  return { ...projectBinding.data, principal: principal.data, sessionId };
}

function readBearerCredential(authorization: string | null): string | undefined {
  if (!authorization || authorization.length > 2_055) return undefined;
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
  return match?.[1];
}

function hasValidControlToken(headers: Headers, expectedDigest: Buffer): boolean {
  const supplied = headers.get(OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER);
  if (!supplied || Buffer.byteLength(supplied, "utf8") > CONTROL_TOKEN_MAX_BYTES) return false;
  return timingSafeEqual(expectedDigest, createHash("sha256").update(supplied, "utf8").digest());
}

function readContentLength(raw: string | null): number | "invalid" | undefined {
  if (raw === null) return undefined;
  if (!/^(0|[1-9][0-9]{0,15})$/.test(raw)) return "invalid";
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : "invalid";
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array | "too_large"> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return "too_large";
      }
      chunks.push(next.value);
    }
  } catch {
    return "too_large";
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function hasRequestBody(request: Request): boolean {
  if (request.body !== null) return true;
  const contentLength = request.headers.get("content-length");
  return contentLength !== null && contentLength !== "0";
}

function parseSessionOpenInput(body: Uint8Array): OperatorRuntimeSessionOpenInput | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return undefined;
  }
  if (!isPlainRecord(value)) return undefined;
  const expectedKeys = ["binding", "canonicalRoot", "principal", "schemaVersion", "sessionId"];
  if (!hasExactKeys(value, expectedKeys)) return undefined;
  if (value.schemaVersion !== 3) return undefined;
  if (
    typeof value.canonicalRoot !== "string" ||
    value.canonicalRoot.length < 1 ||
    value.canonicalRoot.length > 4_096 ||
    value.canonicalRoot.includes("\0") ||
    (!posix.isAbsolute(value.canonicalRoot) && !win32.isAbsolute(value.canonicalRoot))
  ) {
    return undefined;
  }
  const binding = OperatorProjectBindingSchema.safeParse(value.binding);
  if (!binding.success) return undefined;
  const principal = OperatorRuntimePrincipalSchema.safeParse(value.principal);
  if (
    !principal.success ||
    typeof value.sessionId !== "string" ||
    !SESSION_ID_PATTERN.test(value.sessionId)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 3,
    canonicalRoot: value.canonicalRoot,
    binding: binding.data,
    principal: principal.data,
    sessionId: value.sessionId,
  };
}

function parseSessionOpenResult(value: unknown): OperatorRuntimeSessionOpenResult | undefined {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["credential", "expiresAt"])) return undefined;
  if (
    typeof value.credential !== "string" ||
    value.credential.length > 2_048 ||
    !/^v3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.credential) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt < 0
  ) {
    return undefined;
  }
  return { credential: value.credential, expiresAt: value.expiresAt };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function reconstructRequest(request: Request, body: Uint8Array): Request {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete(OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER);
  for (const header of Object.values(OPERATOR_RUNTIME_BINDING_HEADERS)) headers.delete(header);
  headers.delete("cookie");
  headers.delete("upgrade");
  headers.set("content-length", String(body.byteLength));
  const supportsBody = request.method !== "GET" && request.method !== "HEAD";
  const ownedBody = new Uint8Array(body.byteLength);
  ownedBody.set(body);
  return new Request(request.url, {
    method: request.method,
    headers,
    body: supportsBody && ownedBody.byteLength > 0 ? ownedBody.buffer : undefined,
  });
}

function stripBrowserResponseHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("access-control-")) headers.delete(name);
  }
  headers.delete("set-cookie");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function parseIdentity(identity: unknown, port: number): OperatorSupervisorIdentity {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Operator runtime listener port must be an explicit valid TCP port.");
  }
  const parsed = OperatorSupervisorIdentitySchema.safeParse(identity);
  if (!parsed.success || parsed.data.port !== port) {
    throw new Error("Operator runtime listener identity is invalid or bound to another port.");
  }
  return parsed.data;
}

function digestControlToken(token: string): Buffer {
  const byteLength = typeof token === "string" ? Buffer.byteLength(token, "utf8") : 0;
  if (byteLength < CONTROL_TOKEN_MIN_BYTES || byteLength > CONTROL_TOKEN_MAX_BYTES) {
    throw new Error("Operator runtime control token must contain between 32 and 512 UTF-8 bytes.");
  }
  return createHash("sha256").update(token, "utf8").digest();
}

function requireSessionSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.byteLength < 32) {
    throw new Error("Operator runtime session secret must contain at least 32 bytes.");
  }
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse({ error: { code } }, status);
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function withOperatorServiceHeader(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-kiln-service", "operator-runtime");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function requestPathname(request: Request): string | undefined {
  try {
    return new URL(request.url).pathname;
  } catch {
    return undefined;
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
}

function identitiesEqual(left: OperatorSupervisorIdentity, right: OperatorSupervisorIdentity): boolean {
  return left.protocolVersion === right.protocolVersion
    && left.service === right.service
    && left.instanceId === right.instanceId
    && left.version === right.version
    && left.pid === right.pid
    && left.startedAt === right.startedAt
    && left.port === right.port;
}

function discardResponseBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

const CONNECTION_REFUSED_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "ConnectionRefused"]);

function isConnectionRefused(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const code = (current as { readonly code?: unknown }).code;
    if (typeof code === "string" && CONNECTION_REFUSED_CODES.has(code)) return true;
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
}
