import { randomUUID } from "node:crypto";
import type { OperatorRuntimePrincipal } from "@kilnai/gateway-contracts";
import {
  OPERATOR_RUNTIME_BINDING_HEADERS,
  OPERATOR_RUNTIME_APPLICATION_PATH,
  OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER,
  OPERATOR_RUNTIME_SESSION_PATH,
  OPERATOR_RUNTIME_MCP_PATH,
  type OperatorRuntimeBridgeCredentials,
  type OperatorRuntimeSupervisorStatus,
} from "@kilnai/runtime";
import {
  resolveTrustedWorkspace,
  type TrustedProcessContext,
  type TrustedWorkspaceResolution,
} from "./trusted-workspace-resolution.js";

const RENEWAL_WINDOW_SECONDS = 30;

export interface OperatorRuntimeClientSessionOptions {
  readonly principal: OperatorRuntimePrincipal;
  readonly supervisor: { ensure(): Promise<OperatorRuntimeSupervisorStatus> };
  readonly readBridgeCredentials: () => Promise<OperatorRuntimeBridgeCredentials | null>;
  readonly processContext?: TrustedProcessContext;
  readonly resolveWorkspace?: (context: TrustedProcessContext) => TrustedWorkspaceResolution;
  readonly fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  readonly createSessionId?: () => string;
  readonly nowEpochSeconds?: () => number;
}

interface ActiveSession {
  readonly workspace: Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }>;
  readonly sessionId: string;
  readonly port: number;
  credential: string;
  expiresAt: number;
}

export interface OperatorRuntimeClientSession {
  request(path: string, init: RequestInit): Promise<Response>;
  endpoint(path: string): Promise<{
    readonly url: URL;
    readonly fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
  }>;
  close(): void;
}

/** Shared authenticated loopback session for native adapters and operator application clients. */
export function createOperatorRuntimeClientSession(
  options: OperatorRuntimeClientSessionOptions,
): OperatorRuntimeClientSession {
  const baseFetch = options.fetch ?? globalThis.fetch;
  const resolveWorkspace = options.resolveWorkspace ?? resolveTrustedWorkspace;
  const processContext = options.processContext ?? process;
  const createSessionId = options.createSessionId ?? randomUUID;
  const nowEpochSeconds = options.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1_000));
  let active: ActiveSession | undefined;
  let ensureInFlight: Promise<ActiveSession | undefined> | undefined;
  let closed = false;

  const open = async (sessionId: string): Promise<ActiveSession | undefined> => {
    const workspace = resolveWorkspace(processContext);
    if (workspace.status !== "resolved" || closed) return undefined;
    const status = await options.supervisor.ensure();
    if (status.state !== "ready" || closed) return undefined;
    const credentials = await options.readBridgeCredentials();
    if (!credentials || closed) return undefined;
    const authority = `127.0.0.1:${status.identity.port}`;
    const response = await baseFetch(`http://${authority}${OPERATOR_RUNTIME_SESSION_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: authority,
        origin: `http://${authority}`,
        [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: credentials.controlToken,
      },
      body: JSON.stringify({
        schemaVersion: 3,
        canonicalRoot: workspace.canonicalRoot,
        binding: {
          projectRuntimeId: workspace.projectRuntimeId,
          compositionRevision: workspace.compositionRevision,
        },
        principal: options.principal,
        sessionId,
      }),
    });
    if (!response.ok) return undefined;
    const opened = parseSessionOpen(await response.json());
    return opened ? { workspace, sessionId, port: status.identity.port, ...opened } : undefined;
  };

  const ensure = (force = false): Promise<ActiveSession | undefined> => {
    if (ensureInFlight) {
      return force
        ? ensureInFlight.then(() => ensure(true))
        : ensureInFlight;
    }
    const operation = (async () => {
      if (closed) return undefined;
      const workspace = resolveWorkspace(processContext);
      if (workspace.status !== "resolved") return undefined;
      if (!force && active && sameWorkspace(active.workspace, workspace)
        && active.expiresAt - nowEpochSeconds() > RENEWAL_WINDOW_SECONDS) return active;
      const sessionId = active && sameWorkspace(active.workspace, workspace)
        ? active.sessionId
        : createSessionId();
      const opened = await open(sessionId);
      if (opened && !closed) active = opened;
      return opened;
    })().catch(() => undefined).finally(() => {
      if (ensureInFlight === operation) ensureInFlight = undefined;
    });
    ensureInFlight = operation;
    return operation;
  };

  const request = async (path: string, init: RequestInit): Promise<Response> => {
    if (path !== OPERATOR_RUNTIME_APPLICATION_PATH && path !== OPERATOR_RUNTIME_MCP_PATH) {
      throw new Error("Operator runtime client path is invalid.");
    }
    let session = await ensure();
    if (!session) throw new Error("Operator runtime is unavailable.");
    let response = await baseFetch(applicationUrl(session, path), withSessionHeaders(init, session, options.principal));
    if (response.status === 401) {
      session = await ensure(true);
      if (!session) return response;
      response = await baseFetch(applicationUrl(session, path), withSessionHeaders(init, session, options.principal));
    }
    return response;
  };

  return {
    request,
    async endpoint(path) {
      const session = await ensure();
      if (!session) throw new Error("Operator runtime is unavailable.");
      return {
        url: new URL(applicationUrl(session, path)),
        fetch: (_url, init = {}) => request(path, init),
      };
    },
    close() {
      closed = true;
      active = undefined;
    },
  };
}

function applicationUrl(session: ActiveSession, path: string): string {
  return `http://127.0.0.1:${session.port}${path}`;
}

function withSessionHeaders(
  init: RequestInit,
  session: ActiveSession,
  principal: OperatorRuntimePrincipal,
): RequestInit {
  const authority = `127.0.0.1:${session.port}`;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.credential}`);
  headers.set("host", authority);
  headers.set("origin", `http://${authority}`);
  headers.set(OPERATOR_RUNTIME_BINDING_HEADERS.projectRuntimeId, session.workspace.projectRuntimeId);
  headers.set(OPERATOR_RUNTIME_BINDING_HEADERS.compositionRevision, session.workspace.compositionRevision);
  headers.set(OPERATOR_RUNTIME_BINDING_HEADERS.principalKind, principal.kind);
  headers.set(
    OPERATOR_RUNTIME_BINDING_HEADERS.principalId,
    principal.kind === "native-harness" ? principal.harness : principal.surface,
  );
  headers.set(OPERATOR_RUNTIME_BINDING_HEADERS.sessionId, session.sessionId);
  return { ...init, headers };
}

function parseSessionOpen(value: unknown): { readonly credential: string; readonly expiresAt: number } | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "credential,expiresAt") return undefined;
  return typeof value.credential === "string"
    && /^v3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.credential)
    && typeof value.expiresAt === "number"
    && Number.isSafeInteger(value.expiresAt)
    ? { credential: value.credential, expiresAt: value.expiresAt }
    : undefined;
}

function sameWorkspace(
  left: Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }>,
  right: Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }>,
): boolean {
  return left.canonicalRoot === right.canonicalRoot
    && left.projectRuntimeId === right.projectRuntimeId
    && left.compositionRevision === right.compositionRevision;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
