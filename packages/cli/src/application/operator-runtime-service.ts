import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { ManagedEconomicSettlement } from "@kilnai/core";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import {
  OPERATOR_RUNTIME_AUDIENCE,
  OPERATOR_RUNTIME_PROTOCOL_VERSION,
  OperatorSessionClaimsSchema,
  OperatorRuntimeApplicationRequestSchema,
  type OperatorRuntimeApplicationRequest,
  type OperatorRuntimeApplicationResponse,
  type OperatorProjectBinding,
  type OperatorRuntimePrincipal,
  type OperatorSessionClaims,
} from "@kilnai/gateway-contracts";
import {
  OPERATOR_SESSION_MAX_LIFETIME_SECONDS,
  ProjectRuntimeRegistry,
  defineEffectiveAuthorityAdmissionBundle,
  signOperatorSessionCredential,
  type ManagedEconomicCommitmentAcquireInput,
} from "@kilnai/runtime";
import { NativeHarnessMcpTools, type AgentTaskApplicationPort } from "../native-harness/native-harness-mcp-tools.js";
import { createNativeHarnessInspectionService } from "./native-harness-inspection.js";
import { readConfigStatusSnapshot } from "./config-status.js";
import { createConfigSettingsApplication } from "./config-settings-application.js";
import {
  createOperatorProjectAgentTaskApplicationComposition,
  createOperatorGlobalManagedAccountComposition,
  type OperatorProjectAgentTaskApplicationComposition,
} from "./operator-project-agent-tasks.js";
import {
  closeManagedAccountRuntimeComposition,
} from "../config/managed-agent-routes.js";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import { resolveKilnHomePath } from "../config/global-config/path.js";
import { resolveGlobalEconomicAuthorityDatabasePath } from "../config/global-economic-authority.js";
import {
  resolveTrustedWorkspace,
  type TrustedProcessContext,
  type TrustedWorkspaceResolution,
} from "./trusted-workspace-resolution.js";

const DEFAULT_MAX_SESSIONS = 1_024;
const DEFAULT_SESSION_LIFETIME_SECONDS = OPERATOR_SESSION_MAX_LIFETIME_SECONDS;
const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

interface OperatorRuntimeSessionRecord {
  readonly canonicalRoot: string;
  readonly binding: OperatorProjectBinding;
  readonly principal: OperatorRuntimePrincipal;
  readonly sessionId: string;
  claims: OperatorSessionClaims;
}

export interface OperatorRuntimeMcpRequest {
  readonly claims: OperatorSessionClaims;
  readonly request: Request;
}

export interface OperatorRuntimeApplicationCommand {
  readonly claims: OperatorSessionClaims;
  readonly request: OperatorRuntimeApplicationRequest;
}

export interface OperatorRuntimeSessionOpenInput {
  readonly schemaVersion: 3;
  readonly canonicalRoot: string;
  readonly binding: OperatorProjectBinding;
  readonly principal: OperatorRuntimePrincipal;
  readonly sessionId: string;
}

export interface OperatorRuntimeSessionOpenResult {
  readonly credential: string;
  readonly expiresAt: number;
}

interface McpServerInstance {
  setRequestHandler(method: "tools/list" | "tools/call", handler: (request: { params: Record<string, unknown> }) => unknown): void;
  close(): Promise<void>;
}

interface McpHandler {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

export interface OperatorRuntimeMcpSdk {
  readonly Server: new (
    info: { readonly name: string; readonly version: string },
    options: {
      readonly capabilities: Record<string, unknown>;
      readonly supportedProtocolVersions: readonly [typeof MCP_PROTOCOL_VERSION];
    },
  ) => McpServerInstance;
  readonly createMcpHandler: (
    factory: (context: { readonly era: "modern"; readonly requestInfo?: Request }) => McpServerInstance | Promise<McpServerInstance>,
    options: { readonly legacy: "reject"; readonly responseMode: "json" },
  ) => McpHandler;
}

export interface OperatorRuntimeServiceOptions {
  readonly sessionSecret: Uint8Array;
  readonly nowEpochSeconds?: () => number;
  readonly sessionLifetimeSeconds?: number;
  /** Operator-private diagnostic sink; errors never cross the application protocol. */
  readonly onApplicationError?: (error: unknown) => void;
  readonly maxSessions?: number;
  readonly resolveWorkspace?: (context: TrustedProcessContext) => TrustedWorkspaceResolution;
  readonly createComposition?: (options: {
    readonly projectPath: string;
  }) => Promise<OperatorProjectAgentTaskApplicationComposition>;
  readonly registry?: ProjectRuntimeRegistry<OperatorProjectAgentTaskApplicationComposition>;
  readonly sdkLoader?: () => Promise<OperatorRuntimeMcpSdk>;
  readonly userHome?: string;
}

export interface OperatorRuntimeService {
  onSessionOpen(input: OperatorRuntimeSessionOpenInput): Promise<OperatorRuntimeSessionOpenResult>;
  onMcpRequest(input: OperatorRuntimeMcpRequest): Promise<Response>;
  onApplicationRequest(input: OperatorRuntimeApplicationCommand): Promise<OperatorRuntimeApplicationResponse>;
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
  const globalEconomicAuthorityDatabasePath = resolveGlobalEconomicAuthorityDatabasePath(resolveGlobalConfigPath());
  const globalEconomicRuntimeDirectory = dirname(globalEconomicAuthorityDatabasePath);
  let globalManagedAccountComposition: ReturnType<typeof createOperatorGlobalManagedAccountComposition>;
  let globalManagedAccountCompositionRevision: string | undefined;
  let globalRevisionRefresh: Promise<void> | undefined;
  const refreshGlobalCompositionRevision = async (globalConfigRevision: string): Promise<void> => {
    if (options.createComposition !== undefined || globalManagedAccountCompositionRevision === globalConfigRevision)
      return;
    if (globalRevisionRefresh) {
      await globalRevisionRefresh;
      return refreshGlobalCompositionRevision(globalConfigRevision);
    }
    const refresh = (async () => {
      // A global revision changes the authority for every project. Drain all
      // requests and owners before replacing the process-scoped SQLite owner;
      // otherwise an old project composition could retain stale global routes
      // or keep the database authority claimed while the fresh one starts.
      await Promise.allSettled([...requestCompletions]);
      await Promise.allSettled([...projectOperations.values()]);
      sessions.clear();
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = undefined;
      if (globalManagedAccountCompositionRevision !== undefined)
        await registry.closeAll();
      if (globalManagedAccountComposition !== undefined) {
        closeManagedAccountRuntimeComposition(globalEconomicRuntimeDirectory);
        globalManagedAccountComposition = undefined;
      }
      globalManagedAccountCompositionRevision = globalConfigRevision;
    })();
    globalRevisionRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (globalRevisionRefresh === refresh) globalRevisionRefresh = undefined;
    }
  };
  const createDefaultComposition = async ({
    projectPath,
  }: {
    readonly projectPath: string;
  }): Promise<OperatorProjectAgentTaskApplicationComposition> => {
    if (globalManagedAccountComposition === undefined) {
      globalManagedAccountComposition = createOperatorGlobalManagedAccountComposition({
        projectPath,
        compositionKey: globalEconomicRuntimeDirectory,
        databasePath: globalEconomicAuthorityDatabasePath,
      });
    }
    return createOperatorProjectAgentTaskApplicationComposition({
      projectPath,
      ...(options.onApplicationError ? { onDispatchError: options.onApplicationError } : {}),
      ...(globalManagedAccountComposition ? { managedAccountComposition: globalManagedAccountComposition } : {}),
    });
  };
  const registry = options.registry ?? new ProjectRuntimeRegistry((descriptor) =>
    options.createComposition
      ? options.createComposition({ projectPath: descriptor.canonicalRoot })
      : createDefaultComposition({
        projectPath: descriptor.canonicalRoot,
      }));
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
    expectedCompositionRevision: string,
  ): Promise<void> => {
    if (hasProjectSession(projectRuntimeId)) return;
    await waitForProjectDrain(projectRuntimeId);
    if (hasProjectSession(projectRuntimeId)) return;
    const pending = evictions.get(projectRuntimeId);
    if (pending) return pending;
    const eviction = registry.close(projectRuntimeId, expectedCompositionRevision);
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
        expiredProjects.set(session.binding.projectRuntimeId, session.binding.compositionRevision);
    }
    await Promise.allSettled([...expiredProjects].map(([projectRuntimeId, compositionRevision]) =>
      runProjectOperation(projectRuntimeId, async () => {
        for (const [sessionId, session] of sessions) {
          if (session.binding.projectRuntimeId === projectRuntimeId && now > session.claims.expiresAt)
            sessions.delete(sessionId);
        }
        await evictUnusedProject(projectRuntimeId, compositionRevision);
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
    const initialResolution = resolveWorkspace({ cwd: () => input.canonicalRoot });
    if (!isExactResolution(initialResolution, input.canonicalRoot, input.binding)) throw unavailable();
    try {
      if (options.createComposition === undefined)
        await refreshGlobalCompositionRevision(readGlobalConfigRevision(initialResolution));
    } catch {
      throw unavailable();
    }
    await expireSessions(issuedAt);
    return runProjectOperation(input.binding.projectRuntimeId, async () => {
      if (closed) throw unavailable();
      const resolution = resolveWorkspace({ cwd: () => input.canonicalRoot });
      if (!isExactResolution(resolution, input.canonicalRoot, input.binding)) throw unavailable();
      if (options.createComposition === undefined
        && readGlobalConfigRevision(resolution) !== globalManagedAccountCompositionRevision) throw unavailable();

      const existing = sessions.get(input.sessionId);
      if (existing && !sameSessionAuthority(existing, input)) throw unavailable();
      let removedStaleBinding = false;
      let staleCompositionRevision: string | undefined;
      for (const [sessionId, session] of sessions) {
        if (session.binding.projectRuntimeId === input.binding.projectRuntimeId
          && session.binding.compositionRevision !== input.binding.compositionRevision) {
          sessions.delete(sessionId);
          removedStaleBinding = true;
          staleCompositionRevision = session.binding.compositionRevision;
        }
      }
      if (removedStaleBinding) {
        if (staleCompositionRevision !== undefined)
          await evictUnusedProject(input.binding.projectRuntimeId, staleCompositionRevision).catch(() => {
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
        compositionRevision: input.binding.compositionRevision,
        principal: input.principal,
        sessionId: input.sessionId,
        issuedAt,
        expiresAt: issuedAt + sessionLifetimeSeconds,
      };
      const credential = signOperatorSessionCredential(claims, options.sessionSecret);
      sessions.set(input.sessionId, {
        canonicalRoot: resolution.canonicalRoot,
        binding: { ...input.binding },
        principal: input.principal,
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
        evictUnusedProject(session.binding.projectRuntimeId, session.binding.compositionRevision)).catch(() => undefined);
      scheduleExpiry();
      return deniedResponse();
    }
    if (!sameClaims(session.claims, claims)) {
      return deniedResponse();
    }
    if (session.principal.kind !== "native-harness") {
      return deniedResponse();
    }

    const resolution = resolveWorkspace({ cwd: () => session.canonicalRoot });
    if (!isExactResolution(resolution, session.canonicalRoot, session.binding)) {
      await runProjectOperation(session.binding.projectRuntimeId, async () => {
        for (const [sessionId, candidate] of sessions) {
          if (candidate.binding.projectRuntimeId === session.binding.projectRuntimeId
            && candidate.binding.compositionRevision === session.binding.compositionRevision)
            sessions.delete(sessionId);
        }
        await evictUnusedProject(
          session.binding.projectRuntimeId,
          session.binding.compositionRevision,
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
        userHome: options.userHome,
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
            evictUnusedProject(projectRuntimeId, session.binding.compositionRevision)).catch(() => undefined);
      } finally {
        requestCompletions.delete(requestCompletion);
        completeRequest();
      }
    }
  };

  const onApplicationRequest = async (
    input: OperatorRuntimeApplicationCommand,
  ): Promise<OperatorRuntimeApplicationResponse> => {
    if (closed) return applicationError("runtime_unavailable", "Operator runtime application is unavailable.");
    const parsedClaims = OperatorSessionClaimsSchema.safeParse(input.claims);
    const parsedRequest = OperatorRuntimeApplicationRequestSchema.safeParse(input.request);
    if (!parsedClaims.success || !parsedRequest.success) {
      return applicationError("invalid_request", "Operator runtime application request is invalid.");
    }
    const claims = parsedClaims.data;
    const session = sessions.get(claims.sessionId);
    const now = safeNow(nowEpochSeconds);
    if (!session || now === undefined || now > session.claims.expiresAt || !sameClaims(session.claims, claims)) {
      return applicationError("runtime_unavailable", "Operator runtime application session is unavailable.");
    }
    if (session.principal.kind !== "operator-surface") {
      return applicationError("principal_denied", "This principal cannot use the operator application protocol.");
    }
    const resolution = resolveWorkspace({ cwd: () => session.canonicalRoot });
    if (!isExactResolution(resolution, session.canonicalRoot, session.binding)) {
      return applicationError("project_unavailable", "The bound project is unavailable.");
    }

    const projectRuntimeId = session.binding.projectRuntimeId;
    activeRequests.set(projectRuntimeId, (activeRequests.get(projectRuntimeId) ?? 0) + 1);
    let completeRequest!: () => void;
    const requestCompletion = new Promise<void>((resolve) => {
      completeRequest = resolve;
    });
    requestCompletions.add(requestCompletion);
    try {
      const composition = await registry.ensure({
        canonicalRoot: session.canonicalRoot,
        binding: session.binding,
      });
      const request = parsedRequest.data;
      const callerId = deriveOperatorProjectSurfaceCallerId({
        projectRuntimeId,
        principal: session.principal,
      });
      switch (request.operation) {
        case "agent-task.submit":
          return applicationSuccess(await composition.application.accept({
            ...request.input,
            callerId,
          }, { kind: "kiln-runtime", surface: session.principal.surface, attachmentId: callerId },
          createAgentTaskAuthorityAdmission(session, request.input)));
        case "agent-task.status":
          return applicationSuccess(await composition.application.getStatus({ callerId }, request.jobId));
        case "agent-task.result":
          return applicationSuccess(await composition.application.getResult({ callerId }, request.jobId));
        case "agent-task.cancel":
          return applicationSuccess(await composition.application.cancel({ callerId }, request.jobId));
        case "agent-task.replay":
          return applicationSuccess(await composition.application.getReplay({ callerId }, request.jobId));
        case "managed-economic.acquire":
          return applicationSuccess(requireEconomicAuthority(composition).acquire(
            request.input as unknown as ManagedEconomicCommitmentAcquireInput,
          ));
        case "managed-economic.release-pre-fence":
          requireEconomicAuthority(composition).releasePreFence(request.jobId, request.economicAttemptId);
          return applicationSuccess(null);
        case "managed-economic.fence-dispatch": {
          const authority = requireEconomicAuthority(composition);
          authority.fenceDispatch(
            request.jobId,
            request.economicAttemptId,
            request.dispatchFenceId,
            request.actionClaim as unknown as Parameters<typeof authority.fenceDispatch>[3],
          );
          return applicationSuccess(null);
        }
        case "managed-economic.read-dispatch": {
          const authority = requireEconomicAuthority(composition);
          return applicationSuccess(authority.readDispatch(
            request.jobId,
            request.economicAttemptId,
            request.dispatchFenceId,
            request.actionClaim as unknown as Parameters<typeof authority.readDispatch>[3],
          ));
        }
        case "managed-economic.settle-execution":
          requireEconomicAuthority(composition).settleExecution(
            request.jobId,
            request.economicAttemptId,
            request.dispatchFenceId,
            request.settlement as unknown as ManagedEconomicSettlement,
          );
          return applicationSuccess(null);
        case "managed-economic.record-settlement-pending":
          requireEconomicAuthority(composition).recordExecutionSettlementPending(
            request.jobId,
            request.economicAttemptId,
            request.dispatchFenceId,
            request.reason,
          );
          return applicationSuccess(null);
      }
    } catch (error) {
      options.onApplicationError?.(error);
      return parsedRequest.data.operation.startsWith("agent-task.")
        ? applicationError(
            "authority_rejected",
            `Agent Task application rejected the operation (${safeApplicationDiagnostic(error)}).`,
          )
        : applicationError("authority_rejected", "Managed economic authority rejected the operation.");
    } finally {
      const remaining = (activeRequests.get(projectRuntimeId) ?? 1) - 1;
      if (remaining === 0) {
        activeRequests.delete(projectRuntimeId);
        const waiters = drainWaiters.get(projectRuntimeId);
        drainWaiters.delete(projectRuntimeId);
        for (const resolve of waiters ?? []) resolve();
      } else {
        activeRequests.set(projectRuntimeId, remaining);
      }
      requestCompletions.delete(requestCompletion);
      completeRequest();
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
      try {
        await registry.closeAll();
      } finally {
        if (options.createComposition === undefined && globalManagedAccountComposition) {
          closeManagedAccountRuntimeComposition(globalEconomicRuntimeDirectory);
          globalManagedAccountComposition = undefined;
        }
      }
    })();
    return closePromise;
  };

  return { onSessionOpen, onMcpRequest, onApplicationRequest, close };
}

/**
 * Durable AgentTask ownership binding. The project and native principal stay
 * visible for diagnostics; the stable session identity is represented by its
 * digest so the persisted caller remains within the portable identifier bound.
 */
export function deriveOperatorRuntimeCallerId(input: {
  readonly projectRuntimeId: string;
  readonly principal: OperatorRuntimePrincipal;
  readonly sessionId: string;
}): string {
  const principalId = input.principal.kind === "native-harness"
    ? input.principal.harness
    : input.principal.surface;
  const sessionDigest = createHash("sha256").update(input.sessionId, "utf8").digest("hex");
  return `operator-session:${input.projectRuntimeId}:${input.principal.kind}:${principalId}:${sessionDigest}`;
}

function applicationSuccess(result: unknown): OperatorRuntimeApplicationResponse {
  return { schemaVersion: 1, status: "ok", result };
}

function applicationError(
  code: Extract<OperatorRuntimeApplicationResponse, { readonly status: "error" }>["error"]["code"],
  message: string,
): OperatorRuntimeApplicationResponse {
  return { schemaVersion: 1, status: "error", error: { code, message } };
}

async function handleMcpRequest(input: {
  readonly request: Request;
  readonly session: OperatorRuntimeSessionRecord;
  readonly registry: ProjectRuntimeRegistry<OperatorProjectAgentTaskApplicationComposition>;
  readonly sdkLoader: () => Promise<OperatorRuntimeMcpSdk>;
  readonly requestId: string;
  readonly userHome?: string;
}): Promise<Response> {
  let sdk: OperatorRuntimeMcpSdk;
  try {
    sdk = await input.sdkLoader();
  } catch {
    return unavailableResponse();
  }

  const handler = sdk.createMcpHandler(async () => {
    const agentTasks = createLazyAgentTaskPort(input.registry, input.session);
    const adapter = new NativeHarnessMcpTools({
      harness: requireNativeHarness(input.session.principal),
      kilnHome: resolveKilnHomePath(),
      inspection: createNativeHarnessInspectionService({
        harness: requireNativeHarness(input.session.principal),
        readProjectRoot: async () => ({ status: "resolved", rootPath: input.session.canonicalRoot }),
        ...(input.userHome !== undefined ? {
          readStatus: (options) => readConfigStatusSnapshot({ ...options, userHome: input.userHome }),
        } : {}),
        readBridgeProjection: async () => "current",
        readManagedAgents: async () => (await input.registry.ensure({
          canonicalRoot: input.session.canonicalRoot,
          binding: input.session.binding,
        })).configuredAgents,
      }),
      agentTasks,
      settings: createConfigSettingsApplication({ projectPath: input.session.canonicalRoot }),
      requestIdentity: () => ({
        callerId: deriveOperatorRuntimeCallerId({
          projectRuntimeId: input.session.binding.projectRuntimeId,
          principal: input.session.principal,
          sessionId: input.session.sessionId,
        }),
        requestId: input.requestId,
      }),
    });
    const server = new sdk.Server(
      { name: "kiln-operator-runtime", version: "0.1.0" },
      { capabilities: { tools: {} }, supportedProtocolVersions: [MCP_PROTOCOL_VERSION] },
    );
    server.setRequestHandler("tools/list", async () => ({ tools: adapter.listTools() }));
    server.setRequestHandler("tools/call", async (request) => {
      const params = request.params as { readonly name?: unknown; readonly arguments?: unknown };
      return adapter.callTool(typeof params.name === "string" ? params.name : "", params.arguments ?? {});
    });
    return server;
  }, { legacy: "reject", responseMode: "json" });
  try {
    return await handler.fetch(input.request);
  } catch {
    return unavailableResponse();
  } finally {
    await handler.close().catch(() => undefined);
  }
}

function safeApplicationDiagnostic(error: unknown): string {
  if (!isRecord(error) || typeof error["code"] !== "string") return "unavailable";
  return /^[a-z][a-z0-9_-]{2,79}$/u.test(error["code"]) ? error["code"] : "unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deriveOperatorProjectSurfaceCallerId(input: {
  readonly projectRuntimeId: string;
  readonly principal: Extract<OperatorRuntimePrincipal, { readonly kind: "operator-surface" }>;
}): string {
  return `operator-project:${input.projectRuntimeId}:surface:${input.principal.surface}`;
}

function requireEconomicAuthority(
  composition: OperatorProjectAgentTaskApplicationComposition,
): NonNullable<OperatorProjectAgentTaskApplicationComposition["economicAuthority"]> {
  if (!composition.economicAuthority) {
    throw new Error("Managed economic authority is not configured for this project.");
  }
  return composition.economicAuthority;
}

function createLazyAgentTaskPort(
  registry: ProjectRuntimeRegistry<OperatorProjectAgentTaskApplicationComposition>,
  session: OperatorRuntimeSessionRecord,
): AgentTaskApplicationPort {
  const application = async (): Promise<AgentTaskApplicationPort> =>
    (await registry.ensure({
      canonicalRoot: session.canonicalRoot,
      binding: session.binding,
    })).application;
  return {
    accept: async (value, callerIdentity) => (await application()).accept(
      value,
      callerIdentity,
      createAgentTaskAuthorityAdmission(session, value),
    ),
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
    && resolution.compositionRevision === binding.compositionRevision;
}

export function createAgentTaskAuthorityAdmission(
  session: OperatorRuntimeSessionRecord,
  value: unknown,
): ReturnType<typeof defineEffectiveAuthorityAdmissionBundle> {
  const input = isRecord(value) ? value : {};
  const idempotencyKey = typeof input["idempotencyKey"] === "string"
    ? input["idempotencyKey"]
    : "invalid-request";
  const profileId = typeof input["configuredAgentProfileId"] === "string"
    ? input["configuredAgentProfileId"]
    : "invalid-profile";
  const revision = session.binding.compositionRevision;
  const turnDigest = createHash("sha256")
    .update(`${session.sessionId}\0${idempotencyKey}\0${profileId}`, "utf8")
    .digest("hex");
  const turnId = canonicalTurnId(session.sessionId, Number.parseInt(turnDigest.slice(0, 12), 16) + 1);
  const principalId = session.principal.kind === "native-harness"
    ? session.principal.harness
    : session.principal.surface;
  const operatorAdoptionDecision = createOperatorAdoptionDecisionAuthority({
    ownerSessionId: session.sessionId,
    operatorTurnId: turnId,
    actorId: `${session.principal.kind}:${principalId}`,
  });
  const effectEnvelope = {
    operation: "mutate" as const,
    boundaries: ["process", "workspace", "machine", "network", "external-system"] as const,
    reversibility: "irreversible" as const,
    dataEgress: "sensitive-data" as const,
    identityUse: "privileged" as const,
    consequences: ["local-state", "external-state", "financial", "legal", "security"] as const,
    idempotency: "non-idempotent" as const,
  };
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: session.sessionId,
    turnId,
    admittedAt: new Date().toISOString(),
    configuration: {
      sessionRevision: { revisionSetId: revision, revisions: { project: revision } },
      turnRevision: { revisionSetId: revision, revisions: { project: revision } },
    },
    session: {
      skillCatalog: { catalogId: "operator-runtime", revision, skillIds: [] },
      authorityCeiling: {
        maximumAuthority: "audited",
        reason: "Authenticated Operator Runtime Agent Task surface.",
        subjectId: session.binding.projectRuntimeId,
      },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "audited",
        admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection",
        reason: "Explicit authenticated Agent Task submission.",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "workspace_write",
      },
      workGovernance: {
        status: "required",
        kind: "work-item",
        subjectId: operatorAdoptionDecision.decisionId,
        authorityRevision: operatorAdoptionDecision.decisionId,
      },
      operatorAdoption: {
        status: "admitted",
        decision: operatorAdoptionDecision,
      },
      capabilityParticipation: { status: "not-requested" },
      tools: {
        allowedToolPermissions: [{
          toolName: "kiln_agent_task_submit",
          authority: {
            level: 3,
            allowed: true,
            requiresApproval: false,
            reason: "Explicit authenticated Agent Task submission.",
          },
          effectEnvelope,
        }],
        deniedToolNames: [],
      },
      effectCeiling: effectEnvelope,
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

function readGlobalConfigRevision(
  resolution: Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }>,
): string {
  return resolution.globalConfigRevision;
}

function sameSessionAuthority(record: OperatorRuntimeSessionRecord, input: OperatorRuntimeSessionOpenInput): boolean {
  return record.canonicalRoot === input.canonicalRoot
    && samePrincipal(record.principal, input.principal)
    && record.binding.projectRuntimeId === input.binding.projectRuntimeId
    && record.binding.compositionRevision === input.binding.compositionRevision;
}

function sameClaims(left: OperatorSessionClaims, right: OperatorSessionClaims): boolean {
  return left.protocolVersion === right.protocolVersion
    && left.audience === right.audience
    && left.projectRuntimeId === right.projectRuntimeId
    && left.compositionRevision === right.compositionRevision
    && samePrincipal(left.principal, right.principal)
    && left.sessionId === right.sessionId
    && left.issuedAt === right.issuedAt
    && left.expiresAt === right.expiresAt;
}

function samePrincipal(left: OperatorRuntimePrincipal, right: OperatorRuntimePrincipal): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "native-harness"
    ? right.kind === "native-harness" && left.harness === right.harness
    : right.kind === "operator-surface" && left.surface === right.surface;
}

function requireNativeHarness(
  principal: OperatorRuntimePrincipal,
): Extract<OperatorRuntimePrincipal, { readonly kind: "native-harness" }>["harness"] {
  if (principal.kind !== "native-harness") throw new Error("Native harness principal required.");
  return principal.harness;
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
  const serverModule = await import("@modelcontextprotocol/server");
  return {
    Server: serverModule.Server as unknown as OperatorRuntimeMcpSdk["Server"],
    createMcpHandler: serverModule.createMcpHandler as unknown as OperatorRuntimeMcpSdk["createMcpHandler"],
  };
}
