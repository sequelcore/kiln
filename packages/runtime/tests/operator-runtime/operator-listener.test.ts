import { describe, expect, it, vi } from "vitest";
import {
  OPERATOR_RUNTIME_AUDIENCE,
  OPERATOR_RUNTIME_PROTOCOL_VERSION,
  type OperatorSessionClaims,
  type OperatorSupervisorIdentity,
} from "@kilnai/gateway-contracts";
import { signOperatorSessionCredential } from "../../src/operator-runtime/operator-session-auth.js";
import {
  OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER,
  OPERATOR_RUNTIME_APPLICATION_PATH,
  OPERATOR_RUNTIME_HEALTH_PATH,
  OPERATOR_RUNTIME_MCP_PATH,
  OPERATOR_RUNTIME_REQUEST_MAX_BYTES,
  OPERATOR_RUNTIME_SESSION_PATH,
  OPERATOR_RUNTIME_SESSION_REQUEST_MAX_BYTES,
  OPERATOR_RUNTIME_SHUTDOWN_PATH,
  type OperatorRuntimeListenerFetch,
  inspectOperatorRuntimeListener,
  requestOperatorRuntimeShutdown,
  startOperatorRuntimeListener,
} from "../../src/operator-runtime/operator-listener.js";
import { createTestFetch } from "../fetch-fixture.js";

const port = 47_321;
const origin = `http://127.0.0.1:${port}`;
const sessionSecret = Buffer.alloc(32, 7);
const controlToken = "control-token-that-is-at-least-32-bytes-long";
const now = 1_780_000_000;
const identity: OperatorSupervisorIdentity = {
  protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
  service: OPERATOR_RUNTIME_AUDIENCE,
  instanceId: "operator-runtime-test",
  version: "3.0.0-beta.1",
  pid: 12_345,
  startedAt: now - 5,
  port,
};
const claims: OperatorSessionClaims = {
  protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
  audience: OPERATOR_RUNTIME_AUDIENCE,
  projectRuntimeId: `krp_${"a".repeat(64)}`,
  compositionRevision: `sha256:${"b".repeat(64)}`,
  principal: { kind: "native-harness", harness: "codex" },
  sessionId: "session-1",
  issuedAt: now - 1,
  expiresAt: now + 60,
};

interface StartedTestListener {
  readonly fetch: OperatorRuntimeListenerFetch;
  readonly close: () => void;
  readonly stop: ReturnType<typeof vi.fn>;
  readonly handler: ReturnType<typeof vi.fn>;
  readonly sessionOpen: ReturnType<typeof vi.fn>;
  readonly applicationHandler: ReturnType<typeof vi.fn>;
  readonly shutdownRequested: Promise<void>;
  readonly bound: { readonly hostname: string; readonly port: number };
}

async function startTestListener(): Promise<StartedTestListener> {
  let listenerFetch: OperatorRuntimeListenerFetch | undefined;
  let bound: { readonly hostname: string; readonly port: number } | undefined;
  const stop = vi.fn();
  const handler = vi.fn(async ({ request }: { request: Request }) => new Response(await request.text(), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "set-cookie": "sid=downstream",
    },
  }));
  const sessionOpen = vi.fn(async () => ({
    credential: signOperatorSessionCredential(claims, sessionSecret),
    expiresAt: claims.expiresAt,
  }));
  const applicationHandler = vi.fn(async ({ request }: { request: unknown }) => ({
    schemaVersion: 1 as const,
    status: "ok" as const,
    result: request,
  }));
  const runtime = await startOperatorRuntimeListener({
    port,
    identity,
    controlToken,
    sessionSecret,
    nowEpochSeconds: () => now,
    onMcpRequest: handler,
    onApplicationRequest: applicationHandler,
    onSessionOpen: sessionOpen,
    listen: (input) => {
      listenerFetch = input.fetch;
      bound = { hostname: input.hostname, port: input.port };
      return { stop };
    },
  });
  if (!listenerFetch || !bound) throw new Error("listener was not bound");
  return { fetch: listenerFetch, close: runtime.close, stop, handler, sessionOpen, applicationHandler, shutdownRequested: runtime.shutdownRequested, bound };
}

const sessionOpenInput = {
  schemaVersion: 3,
  canonicalRoot: "C:\\Projects\\kiln",
  binding: {
    projectRuntimeId: claims.projectRuntimeId,
    compositionRevision: claims.compositionRevision,
  },
  principal: claims.principal,
  sessionId: claims.sessionId,
} as const;

function sessionRequest(overrides: {
  readonly method?: string;
  readonly url?: string;
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit | null;
} = {}): Request {
  return new Request(overrides.url ?? `${origin}${OPERATOR_RUNTIME_SESSION_PATH}`, {
    method: overrides.method ?? "POST",
    headers: {
      host: `127.0.0.1:${port}`,
      origin,
      [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: controlToken,
      "content-type": "application/json",
      ...overrides.headers,
    },
    body: overrides.body === undefined ? JSON.stringify(sessionOpenInput) : overrides.body,
  });
}

function mcpRequest(overrides: {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit | null;
} = {}): Request {
  const credential = signOperatorSessionCredential(claims, sessionSecret);
  return new Request(overrides.url ?? `${origin}${OPERATOR_RUNTIME_MCP_PATH}`, {
    method: overrides.method ?? "POST",
    headers: {
      host: `127.0.0.1:${port}`,
      origin,
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
      "x-kiln-project-runtime-id": claims.projectRuntimeId,
      "x-kiln-composition-revision": claims.compositionRevision,
      "x-kiln-principal-kind": claims.principal.kind,
      "x-kiln-principal-id": claims.principal.kind === "native-harness"
        ? claims.principal.harness
        : claims.principal.surface,
      "x-kiln-session-id": claims.sessionId,
      ...overrides.headers,
    },
    body: overrides.body === undefined ? "{}" : overrides.body,
  });
}

async function expectDenied(
  started: StartedTestListener,
  request: Request,
  status: number,
  code: string,
): Promise<Response> {
  const response = await started.fetch(request);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code } });
  expect(started.handler).not.toHaveBeenCalled();
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  return response;
}

describe("startOperatorRuntimeListener", () => {
  it("routes authenticated operator-surface application commands outside MCP", async () => {
    const surfacePrincipal = { kind: "operator-surface", surface: "gui" } as const;
    const surfaceClaims: OperatorSessionClaims = {
      ...claims,
      principal: surfacePrincipal,
      sessionId: "gui-session-1",
    };
    const credential = signOperatorSessionCredential(surfaceClaims, sessionSecret);
    const started = await startTestListener();
    const response = await started.fetch(new Request(`${origin}${OPERATOR_RUNTIME_APPLICATION_PATH}`, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${port}`,
        origin,
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        "x-kiln-project-runtime-id": surfaceClaims.projectRuntimeId,
        "x-kiln-composition-revision": surfaceClaims.compositionRevision,
        "x-kiln-principal-kind": surfaceClaims.principal.kind,
        "x-kiln-principal-id": surfacePrincipal.surface,
        "x-kiln-session-id": surfaceClaims.sessionId,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        operation: "managed-economic.release-pre-fence",
        jobId: "job-1",
        economicAttemptId: "attempt-1",
      }),
    }));
    expect(response.status).toBe(200);
    expect(started.applicationHandler).toHaveBeenCalledOnce();
    expect(started.handler).not.toHaveBeenCalled();
  });
  it("binds exactly to the configured IPv4 loopback port", async () => {
    const started = await startTestListener();
    expect(started.bound).toEqual({ hostname: "127.0.0.1", port });
    started.close();
  });

  it.each([
    ["spoofed Host", mcpRequest({ headers: { host: `localhost:${port}` } }), 421, "invalid_host"],
    ["DNS-rebound URL", mcpRequest({ url: `http://evil.example:${port}${OPERATOR_RUNTIME_MCP_PATH}` }), 421, "invalid_host"],
    ["wrong URL port", mcpRequest({ url: `http://127.0.0.1:9000${OPERATOR_RUNTIME_MCP_PATH}` }), 421, "invalid_host"],
    ["query-bearing route", mcpRequest({ url: `${origin}${OPERATOR_RUNTIME_MCP_PATH}?redirect=evil` }), 421, "invalid_host"],
    ["missing Origin", mcpRequest({ headers: { origin: "" } }), 403, "invalid_origin"],
    ["localhost Origin", mcpRequest({ headers: { origin: `http://localhost:${port}` } }), 403, "invalid_origin"],
    ["browser Origin", mcpRequest({ headers: { origin: "https://example.com" } }), 403, "invalid_origin"],
    ["cookie", mcpRequest({ headers: { cookie: "sid=secret" } }), 400, "browser_state_rejected"],
    ["WebSocket upgrade", mcpRequest({ headers: { upgrade: "websocket" } }), 400, "upgrade_rejected"],
  ])("rejects %s before dispatch", async (_name, request, status, code) => {
    await expectDenied(await startTestListener(), request, status as number, code as string);
  });

  it.each([
    ["missing bearer", { authorization: "" }],
    ["wrong bearer scheme", { authorization: "Basic abc" }],
    ["tampered credential", { authorization: "Bearer v3.abc.def" }],
    ["retired marker binding header", {
      "x-kiln-composition-revision": "",
      "x-kiln-marker-digest": claims.compositionRevision,
    }],
    ["mismatched project", { "x-kiln-project-runtime-id": `krp_${"c".repeat(64)}` }],
    ["malformed principal", { "x-kiln-principal-id": "Codex" }],
    ["missing session", { "x-kiln-session-id": "" }],
  ])("rejects %s without exposing authentication detail", async (_name, headers) => {
    await expectDenied(await startTestListener(), mcpRequest({ headers }), 401, "unauthorized");
  });

  it("rejects an expired credential", async () => {
    const expired = signOperatorSessionCredential({ ...claims, issuedAt: now - 100, expiresAt: now - 10 }, sessionSecret);
    await expectDenied(
      await startTestListener(),
      mcpRequest({ headers: { authorization: `Bearer ${expired}` } }),
      401,
      "unauthorized",
    );
  });

  it.each([
    ["OPTIONS", `${origin}${OPERATOR_RUNTIME_MCP_PATH}`, 405, "method_not_allowed"],
    ["PUT", `${origin}${OPERATOR_RUNTIME_MCP_PATH}`, 405, "method_not_allowed"],
    ["POST", `${origin}/unknown`, 404, "not_found"],
  ])("rejects %s and wrong paths", async (method, url, status, code) => {
    await expectDenied(await startTestListener(), mcpRequest({ method, url }), status, code);
  });

  it("rejects oversized declared bodies", async () => {
    await expectDenied(
      await startTestListener(),
      mcpRequest({ headers: { "content-length": String(OPERATOR_RUNTIME_REQUEST_MAX_BYTES + 1) } }),
      413,
      "payload_too_large",
    );
  });

  it("rejects oversized streamed bodies without a Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(OPERATOR_RUNTIME_REQUEST_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const base = mcpRequest({ body: null });
    const request = new Request(base.url, {
      method: "POST",
      headers: base.headers,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expectDenied(await startTestListener(), request, 413, "payload_too_large");
  });

  it("forwards only a bounded request and verified claims", async () => {
    const started = await startTestListener();
    const response = await started.fetch(mcpRequest({ body: "{\"jsonrpc\":\"2.0\"}" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("{\"jsonrpc\":\"2.0\"}");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(started.handler).toHaveBeenCalledOnce();
    const input = started.handler.mock.calls[0]![0] as { claims: OperatorSessionClaims; request: Request };
    expect(input.claims).toEqual(claims);
    expect(input.request.headers.get("authorization")).toBeNull();
    expect(input.request.headers.get("x-kiln-project-runtime-id")).toBeNull();
    expect(input.request.headers.get("content-length")).toBe(String(Buffer.byteLength("{\"jsonrpc\":\"2.0\"}")));
  });

  it("protects health with a distinct control token and strict identity response", async () => {
    const started = await startTestListener();
    const sessionCredential = signOperatorSessionCredential(claims, sessionSecret);
    const baseHeaders = { host: `127.0.0.1:${port}`, origin };
    const missingControl = await expectDenied(started, new Request(`${origin}${OPERATOR_RUNTIME_HEALTH_PATH}`, {
      headers: { ...baseHeaders, authorization: `Bearer ${sessionCredential}` },
    }), 401, "unauthorized");
    expect(missingControl.headers.get("x-kiln-service")).toBe("operator-runtime");
    const wrongControl = await expectDenied(started, new Request(`${origin}${OPERATOR_RUNTIME_HEALTH_PATH}`, {
      headers: { ...baseHeaders, [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: "wrong-control-token-that-is-32-bytes" },
    }), 401, "unauthorized");
    expect(wrongControl.headers.get("x-kiln-service")).toBe("operator-runtime");
    const response = await started.fetch(new Request(`${origin}${OPERATOR_RUNTIME_HEALTH_PATH}`, {
      headers: { ...baseHeaders, [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: controlToken },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-kiln-service")).toBe("operator-runtime");
    expect(await response.json()).toEqual(identity);
    expect(started.handler).not.toHaveBeenCalled();
  });

  it("accepts shutdown only for the authenticated exact runtime instance", async () => {
    const started = await startTestListener();
    const headers = {
      host: `127.0.0.1:${port}`,
      origin,
      [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: controlToken,
      "x-kiln-instance-id": identity.instanceId,
    };
    const mismatch = await started.fetch(new Request(`${origin}${OPERATOR_RUNTIME_SHUTDOWN_PATH}`, {
      method: "POST",
      headers: { ...headers, "x-kiln-instance-id": "another-instance" },
    }));
    expect(mismatch.status).toBe(409);

    const response = await started.fetch(new Request(`${origin}${OPERATOR_RUNTIME_SHUTDOWN_PATH}`, {
      method: "POST",
      headers,
    }));
    expect(response.status).toBe(202);
    expect(response.headers.get("x-kiln-service")).toBe("operator-runtime");
    await started.shutdownRequested;
  });

  it("closes idempotently and remains closed when stop throws", async () => {
    const started = await startTestListener();
    started.stop.mockImplementationOnce(() => { throw new Error("stop failed"); });
    expect(() => started.close()).toThrow("stop failed");
    expect(() => started.close()).not.toThrow();
    expect(started.stop).toHaveBeenCalledTimes(1);
    expect(started.stop).toHaveBeenCalledWith(false);
  });

  it("propagates listener startup failure without invoking the MCP handler", async () => {
    const handler = vi.fn();
    await expect(startOperatorRuntimeListener({
      port,
      identity,
      controlToken,
      sessionSecret,
      onMcpRequest: handler,
      onApplicationRequest: vi.fn(),
      onSessionOpen: vi.fn(),
      listen: () => { throw new Error("bind failed"); },
    })).rejects.toThrow("bind failed");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("operator runtime private session-open route", () => {
  it.each([
    ["spoofed Host", sessionRequest({ headers: { host: `localhost:${port}` } }), 421, "invalid_host"],
    ["wrong Origin", sessionRequest({ headers: { origin: "https://example.com" } }), 403, "invalid_origin"],
    ["wrong method", sessionRequest({ method: "PUT" }), 405, "method_not_allowed"],
    ["missing control token", sessionRequest({ headers: { [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: "" } }), 401, "unauthorized"],
    ["wrong control token", sessionRequest({ headers: { [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: "not-the-control-token" } }), 401, "unauthorized"],
    ["wrong content type", sessionRequest({ headers: { "content-type": "text/plain" } }), 415, "unsupported_media_type"],
    ["parameterized content type", sessionRequest({ headers: { "content-type": "application/json; charset=utf-8" } }), 415, "unsupported_media_type"],
    ["malformed JSON", sessionRequest({ body: "{" }), 400, "invalid_request"],
    ["array JSON", sessionRequest({ body: "[]" }), 400, "invalid_request"],
    ["relative root", sessionRequest({ body: JSON.stringify({ ...sessionOpenInput, canonicalRoot: "relative/root" }) }), 400, "invalid_request"],
    ["NUL root", sessionRequest({ body: JSON.stringify({ ...sessionOpenInput, canonicalRoot: "C:\\root\0child" }) }), 400, "invalid_request"],
    ["unknown key", sessionRequest({ body: JSON.stringify({ ...sessionOpenInput, unexpected: true }) }), 400, "invalid_request"],
    ["unknown binding key", sessionRequest({ body: JSON.stringify({
      ...sessionOpenInput,
      binding: { ...sessionOpenInput.binding, canonicalRoot: "C:/leak" },
    }) }), 400, "invalid_request"],
  ])("rejects %s without invoking session admission", async (_name, request, status, code) => {
    const started = await startTestListener();
    await expectDenied(started, request, status as number, code as string);
    expect(started.sessionOpen).not.toHaveBeenCalled();
  });

  it("rejects oversized declared and streamed session requests", async () => {
    const declared = await startTestListener();
    await expectDenied(declared, sessionRequest({
      headers: { "content-length": String(OPERATOR_RUNTIME_SESSION_REQUEST_MAX_BYTES + 1) },
    }), 413, "payload_too_large");
    expect(declared.sessionOpen).not.toHaveBeenCalled();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(OPERATOR_RUNTIME_SESSION_REQUEST_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const base = sessionRequest({ body: null });
    const request = new Request(base.url, {
      method: "POST",
      headers: base.headers,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const streamed = await startTestListener();
    await expectDenied(streamed, request, 413, "payload_too_large");
    expect(streamed.sessionOpen).not.toHaveBeenCalled();
  });

  it("forwards one bounded strict admission input and returns only credential evidence", async () => {
    const started = await startTestListener();
    const response = await started.fetch(sessionRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      credential: signOperatorSessionCredential(claims, sessionSecret),
      expiresAt: claims.expiresAt,
    });
    expect(started.sessionOpen).toHaveBeenCalledOnce();
    expect(started.sessionOpen).toHaveBeenCalledWith(sessionOpenInput);
    expect(started.handler).not.toHaveBeenCalled();
  });

  it("returns a safe unavailable denial when admission fails", async () => {
    const started = await startTestListener();
    started.sessionOpen.mockRejectedValueOnce(new Error(`failed for ${sessionOpenInput.canonicalRoot} with ${controlToken}`));
    const response = await started.fetch(sessionRequest());
    expect(response.status).toBe(503);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual({ error: { code: "unavailable" } });
    expect(responseText).not.toContain(sessionOpenInput.canonicalRoot);
    expect(responseText).not.toContain(controlToken);
  });

  it("rejects bodies on private health without invoking either callback", async () => {
    const started = await startTestListener();
    const response = await started.fetch(new Request(`${origin}${OPERATOR_RUNTIME_HEALTH_PATH}`, {
      headers: {
        host: `127.0.0.1:${port}`,
        origin,
        [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: controlToken,
        "content-length": "1",
      },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "body_not_allowed" } });
    expect(response.headers.get("x-kiln-service")).toBe("operator-runtime");
    expect(started.sessionOpen).not.toHaveBeenCalled();
    expect(started.handler).not.toHaveBeenCalled();
  });
});

describe("inspectOperatorRuntimeListener", () => {
  it("sends the exact private loopback boundary headers and returns a strict ready identity", async () => {
    const fetchMock = createTestFetch(vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>(
      async () => new Response(JSON.stringify(identity), {
        headers: { "content-type": "application/json", "x-kiln-service": "operator-runtime" },
      }),
    ));
    await expect(inspectOperatorRuntimeListener({
      port,
      controlToken,
      expectedIdentity: identity,
      fetch: fetchMock,
    })).resolves.toEqual({ state: "ready", identity });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${origin}${OPERATOR_RUNTIME_HEALTH_PATH}`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    expect(new Headers(init?.headers).get("host")).toBe(`127.0.0.1:${port}`);
    expect(new Headers(init?.headers).get("origin")).toBe(origin);
    expect(new Headers(init?.headers).get(OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER)).toBe(controlToken);
  });

  it("classifies an authenticated service denial without returning its payload", async () => {
    const inspection = await inspectOperatorRuntimeListener({
      port,
      controlToken,
      fetch: createTestFetch(async () => new Response(JSON.stringify({ secret: "must-not-escape" }), {
        status: 401,
        headers: { "x-kiln-service": "operator-runtime" },
      })),
    });
    expect(inspection).toEqual({ state: "foreign", reason: "unauthorized" });
    expect(JSON.stringify(inspection)).not.toContain("must-not-escape");
  });

  it.each([
    ["wrong service", new Response(JSON.stringify(identity), { headers: { "x-kiln-service": "other" } })],
    ["invalid JSON", new Response("not-json", { headers: { "x-kiln-service": "operator-runtime" } })],
    ["invalid identity", new Response(JSON.stringify({ ...identity, privatePath: "C:/secret" }), {
      headers: { "x-kiln-service": "operator-runtime" },
    })],
  ])("classifies %s as an unexpected foreign response", async (_name, response) => {
    await expect(inspectOperatorRuntimeListener({
      port,
      controlToken,
      fetch: createTestFetch(async () => response),
    })).resolves.toEqual({ state: "foreign", reason: "unexpected-response" });
  });

  it("classifies a strict identity that claims another port as an identity mismatch", async () => {
    await expect(inspectOperatorRuntimeListener({
      port,
      controlToken,
      fetch: createTestFetch(async () => new Response(JSON.stringify({ ...identity, port: port + 1 }), {
        headers: { "x-kiln-service": "operator-runtime" },
      })),
    })).resolves.toEqual({ state: "foreign", reason: "identity-mismatch" });
  });

  it("classifies an unexpected persisted instance as an identity mismatch", async () => {
    await expect(inspectOperatorRuntimeListener({
      port,
      controlToken,
      expectedIdentity: { ...identity, instanceId: "expected-instance" },
      fetch: createTestFetch(async () => new Response(JSON.stringify(identity), {
        headers: { "x-kiln-service": "operator-runtime" },
      })),
    })).resolves.toEqual({ state: "foreign", reason: "identity-mismatch" });
  });

  it("bounds inspection time and classifies timeout as unexpected", async () => {
    const hangingFetch = createTestFetch(vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>(
      (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
      }),
    ));
    await expect(inspectOperatorRuntimeListener({
      port,
      controlToken,
      timeoutMs: 5,
      fetch: hangingFetch,
    })).resolves.toEqual({ state: "foreign", reason: "unexpected-response" });
  });

  it.each(["ECONNREFUSED", "ConnectionRefused"])("recognises stopped listeners reported as %s", async (code) => {
    await expect(inspectOperatorRuntimeListener({
      port,
      controlToken,
      fetch: createTestFetch(async () => { throw Object.assign(new Error("private error"), { cause: { code } }); }),
    })).resolves.toEqual({ state: "stopped" });
  });
});

describe("requestOperatorRuntimeShutdown", () => {
  it("binds the control token and exact instance identity to the private request", async () => {
    const fetchMock = createTestFetch(vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>(
      async () => new Response(null, {
        status: 202,
        headers: { "x-kiln-service": "operator-runtime" },
      }),
    ));
    await expect(requestOperatorRuntimeShutdown({
      port,
      controlToken,
      identity,
      fetch: fetchMock,
    })).resolves.toEqual({ state: "accepted" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${origin}${OPERATOR_RUNTIME_SHUTDOWN_PATH}`);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(new Headers(init?.headers).get("x-kiln-instance-id")).toBe(identity.instanceId);
    expect(new Headers(init?.headers).get(OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER)).toBe(controlToken);
  });
});
