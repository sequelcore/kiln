import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { ModelGatewayConfig } from "@kilnai/core";
import { createOpenAIResponsesRoutes } from "../gateway/openai-responses-routes.js";
import { createAnthropicMessagesRoutes } from "./anthropic-messages-routes.js";
import { createModelGatewayIngress } from "./model-gateway-ingress.js";
import type {
  ModelGatewayExecutionCandidatePort,
  ModelGatewayExecutionRoutingPort,
} from "./model-gateway-ingress.js";
import type { ExecutionCatalog } from "@kilnai/core";
import type { OperatorSessionAccountCapacityAuthority } from "../execution-routing/operator-session-execution-routing-service.js";
import pkg from "../../package.json" with { type: "json" };

export const MODEL_GATEWAY_HEALTH_PATH = "/.well-known/kiln/model-gateway/ready";
export const MODEL_GATEWAY_HEALTH_PROTOCOL_VERSION = 1;

export interface ModelGatewayListenerIdentityInput {
  readonly instanceId: string;
  readonly version: string;
  readonly configDigest: string;
  readonly pid?: number;
}

export interface ModelGatewayListenerIdentity {
  readonly service: "kiln-model-gateway";
  readonly status: "ready";
  readonly protocolVersion: 1;
  readonly instanceId: string;
  readonly pid: number;
  readonly version: string;
  readonly configDigest: string;
  readonly port: number;
}

export interface StartModelGatewayListenerOptions {
  readonly config: ModelGatewayConfig;
  readonly executionCatalog: ExecutionCatalog;
  readonly executionRouting: ModelGatewayExecutionRoutingPort;
  readonly executionCandidates: ModelGatewayExecutionCandidatePort;
  readonly accountCapacityAuthority: OperatorSessionAccountCapacityAuthority;
  readonly databasePath: string;
  readonly credentialRootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly providerFetch?: typeof fetch;
  readonly identity?: ModelGatewayListenerIdentityInput;
  readonly listen?: (input: {
    readonly hostname: "127.0.0.1";
    readonly port: number;
    readonly fetch: (request: Request) => Response | Promise<Response>;
  }) => { stop(force?: boolean): void };
}

export type ModelGatewayListenerInspection =
  | { readonly state: "ready"; readonly identity: ModelGatewayListenerIdentity }
  | { readonly state: "foreign"; readonly reason: "unauthorized" | "identity-mismatch" | "unexpected-response" }
  | { readonly state: "stopped" };

/** Starts only the private model ingress and owns its listener/store lifecycle. */
export async function startModelGatewayListener(options: StartModelGatewayListenerOptions): Promise<{ close(): void }> {
  const env = options.env ?? process.env;
  const handle = await createModelGatewayIngress({
    config: options.config,
    executionCatalog: options.executionCatalog,
    executionRouting: options.executionRouting,
    executionCandidates: options.executionCandidates,
    accountCapacityAuthority: options.accountCapacityAuthority,
    databasePath: options.databasePath,
    ...(options.credentialRootDir === undefined ? {} : { credentialRootDir: options.credentialRootDir }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.providerFetch === undefined ? {} : { fetch: options.providerFetch }),
  });
  let listener: { stop(force?: boolean): void } | undefined;
  try {
    const modelApp = new Hono();
    mountHealthRoute(modelApp, options.config, options.identity ?? {
      instanceId: randomUUID(),
      version: pkg.version,
      configDigest: createModelGatewayConfigDigest(options.config),
    }, env);
    if (handle.openAIResponses) modelApp.route("/", createOpenAIResponsesRoutes(handle.openAIResponses));
    if (handle.anthropicMessages) modelApp.route("/", createAnthropicMessagesRoutes(handle.anthropicMessages));
    listener = options.listen
      ? options.listen({ hostname: "127.0.0.1", port: options.config.port, fetch: modelApp.fetch })
      : Bun.serve({ hostname: "127.0.0.1", port: options.config.port, fetch: modelApp.fetch });
  } catch (error) {
    handle.close();
    throw error;
  }
  let closed = false;
  return { close: () => { if (closed) return; closed = true; try { listener.stop(true); } finally { handle.close(); } } };
}

export function createModelGatewayConfigDigest(config: ModelGatewayConfig): string {
  return createHash("sha256").update(stableSerialize(config), "utf8").digest("hex");
}

export async function inspectModelGatewayListener(input: {
  readonly config: ModelGatewayConfig;
  readonly token: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<ModelGatewayListenerInspection> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 1_000);
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(`http://127.0.0.1:${input.config.port}${MODEL_GATEWAY_HEALTH_PATH}`, {
      headers: { authorization: `Bearer ${input.token}` },
      signal: controller.signal,
    });
  } catch (error) {
    return isConnectionRefused(error)
      ? { state: "stopped" }
      : { state: "foreign", reason: "unexpected-response" };
  } finally {
    clearTimeout(timeout);
  }
  if (response.headers.get("x-kiln-service") !== "model-gateway") {
    return { state: "foreign", reason: "unexpected-response" };
  }
  if (response.status === 401) return { state: "foreign", reason: "unauthorized" };
  if (!response.ok) return { state: "foreign", reason: "unexpected-response" };
  let identity: unknown;
  try { identity = await response.json(); } catch { return { state: "foreign", reason: "unexpected-response" }; }
  if (!isModelGatewayListenerIdentity(identity)) return { state: "foreign", reason: "unexpected-response" };
  if (identity.configDigest !== createModelGatewayConfigDigest(input.config) || identity.port !== input.config.port) {
    return { state: "foreign", reason: "identity-mismatch" };
  }
  return { state: "ready", identity };
}

function mountHealthRoute(
  app: Hono,
  config: ModelGatewayConfig,
  input: ModelGatewayListenerIdentityInput,
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (!input.version.trim()) throw new Error("Model gateway listener version must not be empty.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.instanceId)) throw new Error("Model gateway listener instance id must be canonical.");
  if (!/^[a-f0-9]{64}$/.test(input.configDigest)) throw new Error("Model gateway listener config digest must be a SHA-256 hex digest.");
  if (!Number.isSafeInteger(input.pid ?? process.pid) || (input.pid ?? process.pid) <= 0) throw new Error("Model gateway listener pid must be a positive safe integer.");
  const identity: ModelGatewayListenerIdentity = {
    service: "kiln-model-gateway",
    status: "ready",
    protocolVersion: MODEL_GATEWAY_HEALTH_PROTOCOL_VERSION,
    instanceId: input.instanceId,
    pid: input.pid ?? process.pid,
    version: input.version,
    configDigest: input.configDigest,
    port: config.port,
  };
  const tokenDigests = config.principals.map((principal) => {
    const token = env[principal.tokenEnv];
    if (!token) throw new Error(`Model gateway authentication token environment value '${principal.tokenEnv}' is missing.`);
    return createHash("sha256").update(token, "utf8").digest();
  });
  app.get(MODEL_GATEWAY_HEALTH_PATH, (context) => {
    context.header("x-kiln-service", "model-gateway");
    const token = readHealthToken(context.req.header("authorization"), context.req.header("x-api-key"));
    if (!token || !tokenDigests.some((digest) => timingSafeEqual(digest, createHash("sha256").update(token, "utf8").digest()))) {
      return context.json({ error: "unauthorized" }, 401);
    }
    return context.json(identity);
  });
}

function readHealthToken(authorization: string | undefined, apiKey: string | undefined): string | undefined {
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  return apiKey;
}

function isModelGatewayListenerIdentity(value: unknown): value is ModelGatewayListenerIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<ModelGatewayListenerIdentity>;
  return identity.service === "kiln-model-gateway"
    && identity.status === "ready"
    && identity.protocolVersion === MODEL_GATEWAY_HEALTH_PROTOCOL_VERSION
    && typeof identity.instanceId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(identity.instanceId)
    && Number.isSafeInteger(identity.pid) && (identity.pid ?? 0) > 0
    && typeof identity.version === "string" && identity.version.length > 0
    && typeof identity.configDigest === "string" && /^[a-f0-9]{64}$/.test(identity.configDigest)
    && Number.isSafeInteger(identity.port) && (identity.port ?? 0) > 0;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : stableSerialize(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Model gateway configuration contains an unsupported value.");
  return serialized;
}

/**
 * Node reports a refused connection as `ECONNREFUSED`; Bun reports
 * `ConnectionRefused`. Recognising only the Node spelling classifies a stopped
 * gateway as a foreign listener, which blocks start.
 */
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
