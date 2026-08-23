import { createHash, timingSafeEqual } from "node:crypto";
import {
  APP_GATEWAY_HEALTH_PATH,
  APP_GATEWAY_SERVICE,
  APP_GATEWAY_SHUTDOWN_PATH,
  AppGatewayRuntimeIdentitySchema,
  type AppGatewayRuntimeIdentity,
} from "@kilnai/gateway-contracts";

export type AppGatewayListenerInspection =
  | { readonly state: "ready"; readonly identity: AppGatewayRuntimeIdentity }
  | { readonly state: "stopped" }
  | { readonly state: "foreign"; readonly reason: "unauthorized" | "unexpected-response" | "identity-mismatch" };

export type AppGatewayShutdownResult =
  | { readonly state: "accepted" | "stopped" }
  | { readonly state: "foreign"; readonly reason: "unauthorized" | "unexpected-response" | "identity-mismatch" };

export interface GatewayDrainController {
  readonly isDraining: () => boolean;
  readonly requestShutdown: () => Promise<void>;
  readonly waitForShutdown: () => Promise<void>;
}

export function handleAppGatewayControlRequest(input: {
  readonly request: Request;
  readonly requestAddress: string | undefined;
  readonly identity: AppGatewayRuntimeIdentity;
  readonly controlToken: string;
  readonly requestShutdown: () => void;
}): Response | undefined {
  const path = new URL(input.request.url).pathname;
  if (path !== APP_GATEWAY_HEALTH_PATH && path !== APP_GATEWAY_SHUTDOWN_PATH) return undefined;
  const headers = { "x-kiln-service": APP_GATEWAY_SERVICE };
  if (!isLoopbackAddress(input.requestAddress)) {
    return Response.json({ error: "loopback-required" }, { status: 403, headers });
  }
  if (!hasControlToken(input.request.headers.get("authorization"), input.controlToken)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers });
  }
  if (path === APP_GATEWAY_HEALTH_PATH) {
    return input.request.method === "GET"
      ? Response.json(input.identity, { headers })
      : Response.json({ error: "method-not-allowed" }, { status: 405, headers });
  }
  if (input.request.method !== "POST") {
    return Response.json({ error: "method-not-allowed" }, { status: 405, headers });
  }
  if (input.request.headers.get("x-kiln-instance-id") !== input.identity.instanceId) {
    return Response.json({ error: "identity-mismatch" }, { status: 409, headers });
  }
  queueMicrotask(input.requestShutdown);
  return Response.json({ status: "accepted" }, { status: 202, headers });
}

export async function inspectAppGatewayListener(input: {
  readonly port: number;
  readonly controlToken: string;
  readonly expected?: Partial<AppGatewayRuntimeIdentity>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<AppGatewayListenerInspection> {
  const response = await controlFetch(
    `http://127.0.0.1:${input.port}${APP_GATEWAY_HEALTH_PATH}`,
    { headers: { authorization: `Bearer ${input.controlToken}` } },
    input.fetch,
    input.timeoutMs,
  );
  if (response === "stopped") return { state: "stopped" };
  if (response === "failed" || response.headers.get("x-kiln-service") !== APP_GATEWAY_SERVICE) {
    return { state: "foreign", reason: "unexpected-response" };
  }
  if (response.status === 401) return { state: "foreign", reason: "unauthorized" };
  if (!response.ok) return { state: "foreign", reason: "unexpected-response" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: "foreign", reason: "unexpected-response" };
  }
  const parsed = AppGatewayRuntimeIdentitySchema.safeParse(body);
  if (!parsed.success) return { state: "foreign", reason: "unexpected-response" };
  if (input.expected && !matchesExpectedIdentity(parsed.data, input.expected)) {
    return { state: "foreign", reason: "identity-mismatch" };
  }
  return { state: "ready", identity: parsed.data };
}

export async function requestAppGatewayShutdown(input: {
  readonly identity: AppGatewayRuntimeIdentity;
  readonly controlToken: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<AppGatewayShutdownResult> {
  const response = await controlFetch(
    `http://127.0.0.1:${input.identity.port}${APP_GATEWAY_SHUTDOWN_PATH}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.controlToken}`,
        "x-kiln-instance-id": input.identity.instanceId,
      },
    },
    input.fetch,
    input.timeoutMs,
  );
  if (response === "stopped") return { state: "stopped" };
  if (response === "failed" || response.headers.get("x-kiln-service") !== APP_GATEWAY_SERVICE) {
    return { state: "foreign", reason: "unexpected-response" };
  }
  if (response.status === 401) return { state: "foreign", reason: "unauthorized" };
  if (response.status === 409) return { state: "foreign", reason: "identity-mismatch" };
  return response.status === 202
    ? { state: "accepted" }
    : { state: "foreign", reason: "unexpected-response" };
}

export function createGatewayDrainController(input: {
  readonly server: { stop(force?: boolean): void | Promise<void> };
  readonly closeResources: () => void | Promise<void>;
  readonly timeoutMs?: number;
  readonly wait?: (ms: number) => Promise<void>;
}): GatewayDrainController {
  let shutdown: Promise<void> | undefined;
  const requestShutdown = (): Promise<void> => {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      const graceful = Promise.resolve(input.server.stop(false));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = input.wait
        ? input.wait(input.timeoutMs ?? 15_000)
        : new Promise<void>((resolve) => { timeout = setTimeout(resolve, input.timeoutMs ?? 15_000); });
      try {
        const drained = await Promise.race([
          graceful.then(() => true),
          deadline.then(() => false),
        ]);
        if (!drained) await input.server.stop(true);
      } catch {
        await input.server.stop(true);
      } finally {
        if (timeout) clearTimeout(timeout);
        await input.closeResources();
      }
    })();
    return shutdown;
  };
  return {
    isDraining: () => shutdown !== undefined,
    requestShutdown,
    waitForShutdown: () => shutdown ?? new Promise<void>(() => undefined),
  };
}

function matchesExpectedIdentity(
  actual: AppGatewayRuntimeIdentity,
  expected: Partial<AppGatewayRuntimeIdentity>,
): boolean {
  return (Object.keys(expected) as (keyof AppGatewayRuntimeIdentity)[])
    .every((key) => expected[key] === actual[key]);
}

function hasControlToken(authorization: string | null, expected: string): boolean {
  if (!authorization?.startsWith("Bearer ") || expected.length === 0) return false;
  const supplied = createHash("sha256").update(authorization.slice("Bearer ".length), "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(supplied, expectedDigest);
}

function isLoopbackAddress(value: string | undefined): boolean {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

async function controlFetch(
  url: string,
  init: RequestInit,
  fetchImplementation: typeof fetch | undefined,
  timeoutMs: number | undefined,
): Promise<Response | "stopped" | "failed"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 1_000);
  try {
    return await (fetchImplementation ?? fetch)(url, { ...init, signal: controller.signal });
  } catch (error) {
    return isConnectionRefused(error) ? "stopped" : "failed";
  } finally {
    clearTimeout(timeout);
  }
}

const CONNECTION_REFUSED_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "ConnectionRefused"]);

function isConnectionRefused(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && CONNECTION_REFUSED_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
