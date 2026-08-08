import {
  OPERATOR_RUNTIME_AUDIENCE,
  OPERATOR_RUNTIME_PROTOCOL_VERSION,
  OperatorSessionClaimsSchema,
  type OperatorProjectBinding,
  type OperatorRuntimeHarness,
  type OperatorSessionClaims,
} from "@kilnai/gateway-contracts";
import {
  OPERATOR_SESSION_MAX_LIFETIME_SECONDS,
  ProjectRuntimeRegistry,
  signOperatorSessionCredential,
} from "@kilnai/runtime";
import { NativeHarnessMcpTools, type ManagedJobApplicationPort } from "../native-harness/native-harness-mcp-tools.js";
import { createNativeHarnessInspectionService } from "./native-harness-inspection.js";
import {
  createOperatorProjectManagedJobApplicationComposition,
  type OperatorProjectManagedJobApplicationComposition,
} from "./operator-project-managed-jobs.js";
import {
  resolveTrustedWorkspace,
  type TrustedProcessContext,
  type TrustedWorkspaceResolution,
} from "./trusted-workspace-resolution.js";

const DEFAULT_MAX_SESSIONS = 1_024;
const DEFAULT_SESSION_LIFETIME_SECONDS = OPERATOR_SESSION_MAX_LIFETIME_SECONDS;

interface OperatorRuntimeSessionRecord {
  readonly canonicalRoot: string;
  readonly binding: OperatorProjectBinding;
  readonly harness: OperatorRuntimeHarness;
  readonly sessionId: string;
  claims: OperatorSessionClaims;
}

export interface OperatorRuntimeMcpRequest {
  readonly claims: OperatorSessionClaims;
  readonly request: Request;
}

export interface OperatorRuntimeSessionOpenInput {
  readonly schemaVersion: 1;
  readonly canonicalRoot: string;
  readonly binding: OperatorProjectBinding;
  readonly harness: OperatorRuntimeHarness;
  readonly sessionId: string;
}

export interface OperatorRuntimeSessionOpenResult {
  readonly credential: string;
  readonly expiresAt: number;
}

interface McpServerInstance {
  setRequestHandler(schema: unknown, handler: (request: { params: Record<string, unknown> }) => unknown): void;
  connect(transport: McpTransport): Promise<void>;
  close(): Promise<void>;
}

interface McpTransport {
  handleRequest(request: Request): Promise<Response>;
  close?(): Promise<void>;
}

export interface OperatorRuntimeMcpSdk {
  readonly Server: new (
    info: { readonly name: string; readonly version: string },
    options: { readonly capabilities: Record<string, unknown> },
  ) => McpServerInstance;
  readonly WebStandardStreamableHTTPServerTransport: new (options: {
    readonly sessionIdGenerator?: (() => string) | undefined;
    readonly enableJsonResponse?: boolean;
  }) => McpTransport;
  readonly ListToolsRequestSchema: unknown;
  readonly CallToolRequestSchema: unknown;
}

export interface OperatorRuntimeServiceOptions {
  readonly sessionSecret: Uint8Array;
  readonly nowEpochSeconds?: () => number;
  readonly sessionLifetimeSeconds?: number;
  readonly maxSessions?: number;
  readonly resolveWorkspace?: (context: TrustedProcessContext) => TrustedWorkspaceResolution;
  readonly createComposition?: (options: {
    readonly projectPath: string;
  }) => Promise<OperatorProjectManagedJobApplicationComposition>;
  readonly registry?: ProjectRuntimeRegistry<OperatorProjectManagedJobApplicationComposition>;
  readonly sdkLoader?: () => Promise<OperatorRuntimeMcpSdk>;
}

export interface OperatorRuntimeService {
  onSessionOpen(input: OperatorRuntimeSessionOpenInput): Promise<OperatorRuntimeSessionOpenResult>;
  onMcpRequest(input: OperatorRuntimeMcpRequest): Promise<Response>;
  close(): Promise<void>;
}

/**
 * Owns authenticated native-harness sessions and routes them to one lazy,
 * project-scoped application composition per canonical project identity.
 */
export function createOperatorRuntimeService(options: OperatorRuntimeServiceOptions): OperatorRuntimeService {
  const nowEpochSeconds = options.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1_000));
  const sessionLifetimeSeconds = options.sessionLifetimeSeconds ?? DEFAULT_SESSION_LIFETIME_SECONDS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  if (!Number.isSafeInteger(sessionLifetimeSeconds) || sessionLifetimeSeconds < 1 || sessionLifetimeSeconds > OPERATOR_SESSION_MAX_LIFETIME_SECONDS) {
    throw new Error("Operator runtime session lifetime must be between 1 and 300 seconds.");
  }
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 100_000) {
    throw new Error("Operator runtime session capacity is invalid.");
  }

  const resolveWorkspace = options.resolveWorkspace ?? resolveTrustedWorkspace;
  const createComposition = options.createComposition ?? createOperatorProjectManagedJobApplicationComposition;
  const registry = options.registry ?? new ProjectRuntimeRegistry((descriptor) =>
    createComposition({ projectPath: descriptor.canonicalRoot }));
  const sdkLoader = options.sdkLoader ?? loadMcpSdk;
  const sessions = new Map<string, OperatorRuntimeSessionRecord>();
  const activeRequests = new Map<string, number>();
  const drainWaiters = new Map<string, Set<() => void>>();
  const projectOperations = new Map<string, Promise<void>>();
  const evictions = new Map<string, Promise<void>>();
  const requestCompletions = new Set<Promise<void>>();
  let requestSequence = 0;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  const runProjectOperation = <T>(projectRuntimeId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = projectOperations.get(projectRuntimeId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    projectOperations.set(projectRuntimeId, tail);
    void tail.then(() => {
      if (projectOperations.get(projectRuntimeId) === tail)
        projectOperations.delete(projectRuntimeId);
    });
    return result;
  };

  const waitForProjectDrain = (projectRuntimeId: string): Promise<void> => {
    if ((activeRequests.get(projectRuntimeId) ?? 0) === 0)
      return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = drainWaiters.get(projectRuntimeId) ?? new Set<() => void>();
      waiters.add(resolve);
      drainWaiters.set(projectRuntimeId, waiters);
    });
  };

  const hasProjectSession = (projectRuntimeId: string): boolean =>
    [...sessions.values()].some((session) => session.binding.projectRuntimeId === projectRuntimeId);

  const evictUnusedProject = async (
    projectRuntimeId: string,
    expectedMarkerDigest: string,
  ): Promise<void> => {
    if (hasProjectSession(projectRuntimeId)) return;
    await waitForProjectDrain(projectRuntimeId);
    if (hasProjectSession(projectRuntimeId)) return;
    const pending = evictions.get(projectRuntimeId);
    if (pending) return pending;
    const eviction = registry.close(projectRuntimeId, expectedMarkerDigest);
    evictions.set(projectRuntimeId, eviction);
    try {
      await eviction;
    } finally {
      if (evictions.get(projectRuntimeId) === eviction)
        evictions.delete(projectRuntimeId);
    }
  };

  const expireSessions = async (now: number): Promise<void> => {
    const expiredProjects = new Map<string, string>();
    for (const session of sessions.values()) {
      if (now > session.claims.expiresAt)
        expiredProjects.set(session.binding.projectRuntimeId, session.binding.markerDigest);
    }
    await Promise.allSettled([...expiredProjects].map(([projectRuntimeId, markerDigest]) =>
      runProjectOperation(projectRuntimeId, async () => {
        for (const [sessionId, session] of sessions) {
          if (session.binding.projectRuntimeId === projectRuntimeId && now > session.claims.expiresAt)
            sessions.delete(sessionId);
        }
        await evictUnusedProject(projectRuntimeId, markerDigest);
      })));
  };

  const scheduleExpiry = (): void => {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (closed || sessions.size === 0) return;
    const now = safeNow(nowEpochSeconds);
    if (now === undefined) return;
    const nextExpiry = Math.min(...[...sessions.values()].map((session) => session.claims.expiresAt));
    const delayMilliseconds = Math.min(
      Math.max(0, nextExpiry - now + 1) * 1_000,
      2_147_483_647,
    );
    expiryTimer = setTimeout(() => {
      expiryTimer = undefined;
      const current = safeNow(nowEpochSeconds);
      if (current === undefined) return;
      void expireSessions(current).finally(scheduleExpiry);
    }, delayMilliseconds);
  };

  const onSessionOpen = async (input: OperatorRuntimeSessionOpenInput): Promise<OperatorRuntimeSessionOpenResult> => {
    if (closed) throw unavailable();
    const issuedAt = checkedNow(nowEpochSeconds);
    await expireSessions(issuedAt);
    return runProjectOperation(input.binding.projectRuntimeId, async () => {
      if (closed) throw unavailable();
      const resolution = resolveWorkspace({ cwd: () => input.canonicalRoot });
      if (!isExactResolution(resolution, input.canonicalRoot, input.binding)) throw unavailable();

      const existing = sessions.get(input.sessionId);
      if (existing && !sameSessionAuthority(existing, input)) throw unavailable();
      let removedStaleBinding = false;
      let staleMarkerDigest: string | undefined;
      for (const [sessionId, session] of sessions) {
        if (session.binding.projectRuntimeId === input.binding.projectRuntimeId
          && session.binding.markerDigest !== input.binding.markerDigest) {
          sessions.delete(sessionId);
          removedStaleBinding = true;
          staleMarkerDigest = session.binding.markerDigest;
        }
      }
      if (removedStaleBinding) {
        if (staleMarkerDigest !== undefined)
          await evictUnusedProject(input.binding.projectRuntimeId, staleMarkerDigest).catch(() => {
            throw unavailable();
          });
        else
          await waitForProjectDrain(input.binding.projectRuntimeId);
      } else {
        const pendingEviction = evictions.get(input.binding.projectRuntimeId);
        if (pendingEviction) {
          await pendingEviction.catch(() => {
            throw unavailable();
          });
        }
      }
      if (closed) throw unavailable();
      if (!existing && sessions.size >= maxSessions) throw unavailable();

      const claims: OperatorSessionClaims = {
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        audience: OPERATOR_RUNTIME_AUDIENCE,
        projectRuntimeId: input.binding.projectRuntimeId,
        markerDigest: input.binding.markerDigest,
        harness: input.harness,
        sessionId: input.sessionId,
        issuedAt,
        expiresAt: issuedAt + sessionLifetimeSeconds,
      };
      const credential = signOperatorSessionCredential(claims, options.sessionSecret);
      sessions.set(input.sessionId, {
        canonicalRoot: resolution.canonicalRoot,
        binding: { ...input.binding },
        harness: input.harness,
        sessionId: input.sessionId,
        claims,
      });
      scheduleExpiry();
      return { credential, expiresAt: claims.expiresAt };
    });
  };

  const onMcpRequest = async (input: OperatorRuntimeMcpRequest): Promise<Response> => {
    if (closed) return deniedResponse();
    const parsedClaims = OperatorSessionClaimsSchema.safeParse(input.claims);
    if (!parsedClaims.success) return deniedResponse();
    const claims = parsedClaims.data;
    const session = sessions.get(claims.sessionId);
    const now = safeNow(nowEpochSeconds);
    if (!session || now === undefined) return deniedResponse();
    if (now > session.claims.expiresAt) {
      sessions.delete(session.sessionId);
      void runProjectOperation(session.binding.projectRuntimeId, () =>
        evictUnusedProject(session.binding.projectRuntimeId, session.binding.markerDigest)).catch(() => undefined);
      scheduleExpiry();
      return deniedResponse();
    }
    if (!sameClaims(session.claims, claims)) {
      return deniedResponse();
    }

    const resolution = resolveWorkspace({ cwd: () => session.canonicalRoot });
    if (!isExactResolution(resolution, session.canonicalRoot, session.binding)) {
      await runProjectOperation(session.binding.projectRuntimeId, async () => {
        for (const [sessionId, candidate] of sessions) {
          if (candidate.binding.projectRuntimeId === session.binding.projectRuntimeId
            && candidate.binding.markerDigest === session.binding.markerDigest)
            sessions.delete(sessionId);
        }
        await evictUnusedProject(
          session.binding.projectRuntimeId,
          session.binding.markerDigest,
        ).catch(() => undefined);
      });
      scheduleExpiry();
      return deniedResponse();
    }

    const projectRuntimeId = session.binding.projectRuntimeId;
    activeRequests.set(projectRuntimeId, (activeRequests.get(projectRuntimeId) ?? 0) + 1);
    let completeRequest!: () => void;
    const requestCompletion = new Promise<void>((resolve) => {
      completeRequest = resolve;
    });
    requestCompletions.add(requestCompletion);
    try {
      return await handleMcpRequest({
        request: input.request,
        session,
        registry,
        sdkLoader,
        requestId: `operator-runtime:${session.sessionId}:${++requestSequence}`,
      });
    } finally {
      try {
        const remaining = (activeRequests.get(projectRuntimeId) ?? 1) - 1;
        if (remaining === 0) {
          activeRequests.delete(projectRuntimeId);
          const waiters = drainWaiters.get(projectRuntimeId);
          drainWaiters.delete(projectRuntimeId);
          for (const resolve of waiters ?? []) resolve();
        } else {
          activeRequests.set(projectRuntimeId, remaining);
        }
        const releasedAt = safeNow(nowEpochSeconds);
        if (releasedAt !== undefined)
          await expireSessions(releasedAt);
        if (!hasProjectSession(projectRuntimeId))
          await runProjectOperation(projectRuntimeId, () =>
            evictUnusedProject(projectRuntimeId, session.binding.markerDigest)).catch(() => undefined);
      } finally {
        requestCompletions.delete(requestCompletion);
        completeRequest();
      }
    }
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    sessions.clear();
    closePromise = (async () => {
      await Promise.allSettled([...requestCompletions]);
      await Promise.allSettled([...evictions.values()]);
      await registry.closeAll();
    })();
    return closePromise;
  };

  return { onSessionOpen, onMcpRequest, close };
}

async function handleMcpRequest(input: {
  readonly request: Request;
  readonly session: OperatorRuntimeSessionRecord;
  readonly registry: ProjectRuntimeRegistry<OperatorProjectManagedJobApplicationComposition>;
  readonly sdkLoader: () => Promise<OperatorRuntimeMcpSdk>;
  readonly requestId: string;
}): Promise<Response> {
  let sdk: OperatorRuntimeMcpSdk;
  try {
    sdk = await input.sdkLoader();
  } catch {
    return unavailableResponse();
  }

  const managedJobs = createLazyManagedJobPort(input.registry, input.session);
  const adapter = new NativeHarnessMcpTools({
    harness: input.session.harness,
    inspection: createNativeHarnessInspectionService({
      harness: input.session.harness,
      readProjectRoot: async () => ({ status: "resolved", rootPath: input.session.canonicalRoot }),
      readBridgeProjection: async () => "current",
    }),
    managedJobs,
    requestIdentity: () => ({
      callerId: `operator-project:${input.session.binding.projectRuntimeId}`,
      requestId: input.requestId,
    }),
  });
  const server = new sdk.Server(
    { name: "kiln-operator-runtime", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({ tools: adapter.listTools() }));
  server.setRequestHandler(sdk.CallToolRequestSchema, async (request) => {
    const params = request.params as { readonly name?: unknown; readonly arguments?: unknown };
    return adapter.callTool(typeof params.name === "string" ? params.name : "", params.arguments ?? {});
  });
  const transport = new sdk.WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(input.request);
  } catch {
    return unavailableResponse();
  } finally {
    await server.close().catch(async () => {
      await transport.close?.().catch(() => undefined);
    });
  }
}

function createLazyManagedJobPort(
  registry: ProjectRuntimeRegistry<OperatorProjectManagedJobApplicationComposition>,
  session: OperatorRuntimeSessionRecord,
): ManagedJobApplicationPort {
  const application = async (): Promise<ManagedJobApplicationPort> =>
    (await registry.ensure({
      canonicalRoot: session.canonicalRoot,
      binding: session.binding,
    })).application;
  return {
    submit: async (value) => (await application()).submit(value),
    getStatus: async (identity, jobId) => (await application()).getStatus(identity, jobId),
    getResult: async (identity, jobId) => (await application()).getResult(identity, jobId),
    cancel: async (identity, jobId) => (await application()).cancel(identity, jobId),
    getReplay: async (identity, jobId) => (await application()).getReplay(identity, jobId),
  };
}

function isExactResolution(
  resolution: TrustedWorkspaceResolution,
  canonicalRoot: string,
  binding: OperatorProjectBinding,
): resolution is Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }> {
  return resolution.status === "resolved"
    && resolution.canonicalRoot === canonicalRoot
    && resolution.projectRuntimeId === binding.projectRuntimeId
    && resolution.markerDigest === binding.markerDigest;
}

function sameSessionAuthority(record: OperatorRuntimeSessionRecord, input: OperatorRuntimeSessionOpenInput): boolean {
  return record.canonicalRoot === input.canonicalRoot
    && record.harness === input.harness
    && record.binding.projectRuntimeId === input.binding.projectRuntimeId
    && record.binding.markerDigest === input.binding.markerDigest;
}

function sameClaims(left: OperatorSessionClaims, right: OperatorSessionClaims): boolean {
  return left.protocolVersion === right.protocolVersion
    && left.audience === right.audience
    && left.projectRuntimeId === right.projectRuntimeId
    && left.markerDigest === right.markerDigest
    && left.harness === right.harness
    && left.sessionId === right.sessionId
    && left.issuedAt === right.issuedAt
    && left.expiresAt === right.expiresAt;
}

function checkedNow(now: () => number): number {
  const value = safeNow(now);
  if (value === undefined) throw unavailable();
  return value;
}

function safeNow(now: () => number): number | undefined {
  try {
    const value = now();
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function deniedResponse(): Response {
  return jsonError(401, "unauthorized");
}

function unavailableResponse(): Response {
  return jsonError(503, "unavailable");
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function unavailable(): Error {
  return new Error("Operator runtime session is unavailable.");
}

async function loadMcpSdk(): Promise<OperatorRuntimeMcpSdk> {
  const [serverModule, transportModule, typesModule] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);
  return {
    Server: serverModule.Server as unknown as OperatorRuntimeMcpSdk["Server"],
    WebStandardStreamableHTTPServerTransport:
      transportModule.WebStandardStreamableHTTPServerTransport as unknown as OperatorRuntimeMcpSdk["WebStandardStreamableHTTPServerTransport"],
    ListToolsRequestSchema: typesModule.ListToolsRequestSchema,
    CallToolRequestSchema: typesModule.CallToolRequestSchema,
  };
}
