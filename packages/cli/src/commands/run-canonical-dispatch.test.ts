import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineEffectiveAuthorityAdmissionBundle, type EffectiveAuthorityAdmissionBundle } from "@kilnai/runtime";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core/engine";

const compositionState = vi.hoisted(() => ({
  bind: vi.fn(),
  dispatchTurn: vi.fn(),
  close: vi.fn(),
  modelRoundActionClaims: { claim: vi.fn(), settle: vi.fn() },
}));
const runSessionMock = vi.hoisted(() => vi.fn());
const authorityEvidenceStore = vi.hoisted(() => ({
  persist: vi.fn(),
  loadSessionFacet: vi.fn(),
  readAdmission: vi.fn(),
}));
const preparedResources = vi.hoisted(() => ({
  dispose: vi.fn(),
  disconnect: vi.fn(),
}));
const authorityCoordinatorState = vi.hoisted(() => ({ options: undefined as unknown }));

const READ_AUTHORITY: AuthorityDescriptor = { level: 1, allowed: true, requiresApproval: false, reason: "model-only" };
const READ_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};

function routedAdmission(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly routeId: string;
  readonly providerModelId: string;
  readonly accountId: string;
  readonly credentialId: string;
  readonly credentialRevision: string;
}): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: input.sessionId,
    turnId: input.turnId,
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "sha256:session-revision", revisions: { routes: "r1" } },
      turnRevision: { revisionSetId: "sha256:turn-revision", revisions: { routes: "r1" } },
    },
    session: {
      skillCatalog: { catalogId: "operator", revision: "skills-r1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "audited", reason: "canonical test", subjectId: input.sessionId },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "audited",
        admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection",
        reason: "canonical test",
        completeness: "authoritative",
        toolCount: 0,
        deniedToolCount: 0,
        sandboxProjection: "workspace_write",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: READ_EFFECT,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: input.routeId,
          providerId: "codex-oauth",
          providerModelId: input.providerModelId,
          accountSelection: { kind: "operator-override", accountPolicyId: "fixture-policy", accountId: input.accountId },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "canonical test" } },
        binding: {
          status: "bound",
          routeId: input.routeId,
          accountId: input.accountId,
          credentialId: input.credentialId,
          credentialRevision: input.credentialRevision,
        },
      },
    },
  });
}

vi.mock("../application/operator-turn-dispatch-composition.js", () => ({
  createOperatorTurnDispatchComposition: vi.fn(() => ({
    bridge: { bind: compositionState.bind },
    authorityAdmissionBridge: { bind: vi.fn() },
    dispatcher: { dispatchTurn: compositionState.dispatchTurn },
    modelRoundActionClaims: compositionState.modelRoundActionClaims,
    close: compositionState.close,
  })),
}));

vi.mock("../application/run-session.js", () => ({
  runSession: runSessionMock,
}));

vi.mock("@kilnai/runtime", async () => {
  const actual = await vi.importActual<typeof import("@kilnai/runtime")>("@kilnai/runtime");
  return {
    ...actual,
    OperatorAuthorityAdmissionCoordinator: class {
      constructor(options: unknown) { authorityCoordinatorState.options = options; }
      consume(_executionId: string, _bundle: unknown) {
        return {
          runtimeSession: { id: "runtime-session-1" },
          builtinToolSurface: { dispose: preparedResources.dispose },
          mcpClients: [{ disconnect: preparedResources.disconnect }],
          mcpCapabilities: [],
          perCallConfig: {},
        };
      }
    },
  };
});

import { createCanonicalRunSessionDispatcher } from "../application/canonical-run-session-dispatcher.js";

describe("createCanonicalRunSessionDispatcher", () => {
  beforeEach(() => {
    compositionState.bind.mockReset();
    compositionState.dispatchTurn.mockReset();
    compositionState.close.mockReset();
    runSessionMock.mockReset();
    authorityEvidenceStore.readAdmission.mockReset();
    authorityCoordinatorState.options = undefined;
    preparedResources.dispose.mockReset();
    preparedResources.disconnect.mockReset();
  });

  it("passes one committed route/account/credential binding to runSession", async () => {
    const authorityAdmission = routedAdmission({
      sessionId: "session-1",
      turnId: "turn-1",
      routeId: "terra",
      providerModelId: "gpt-5.6-terra",
      accountId: "account-terra",
      credentialId: "credential-terra",
      credentialRevision: "post-fence-revision",
    });
    authorityEvidenceStore.readAdmission.mockReturnValue(authorityAdmission);
    let committedHandler: ((input: unknown) => Promise<unknown>) | undefined;
    compositionState.bind.mockImplementation((handler: (input: unknown) => Promise<unknown>) => {
      committedHandler = handler;
    });
    compositionState.dispatchTurn.mockImplementation(async (request: { readonly payload: unknown }) => {
      if (!committedHandler) throw new Error("missing committed handler");
      return {
        result: await committedHandler({
          admission: {
            targetId: "terra",
            providerId: "codex-oauth",
            providerModelId: "gpt-5.6-terra",
          },
          binding: {
            status: "bound",
            routeId: "terra",
            accountId: "account-terra",
            credentialId: "credential-terra",
            credentialRevision: "post-fence-revision",
          },
          credential: {
            credentialId: "credential-terra",
            accessToken: "synthetic-access-token",
            chatgptAccountId: "synthetic-account",
          },
          authorityAdmission,
          executionId: "execution-1",
          payload: request.payload,
        }),
      };
    });
    runSessionMock.mockImplementation(async (options: { readonly sessionConfig: { readonly authorityAdmissionContext?: { readonly perCallConfig: { readonly runtimeModelRoundDispatch?: { readonly readAdmission: () => unknown } } } } }) => {
      await options.sessionConfig.authorityAdmissionContext?.perCallConfig.runtimeModelRoundDispatch?.readAdmission();
      return { sessionSucceeded: true };
    });

    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "/repo",
      executionId: "execution-1",
      targetId: "terra",
      authorityAdmissionEvidenceStore: authorityEvidenceStore,
      captureCatalogSnapshot: () => ({ catalog: {} as never, configurationRevision: { revisionSetId: "sha256:test", revisions: {} } }),
      configurationRevision: {
        revisionSetId: "sha256:test",
        revisions: { global: "global", project: "project" },
      },
    });
    const payload = {
      marker: "session-options",
      sessionConfig: { task: "test", permissionPolicy: {}, requestedAuthority: "audited" },
    };

    await expect(dispatcher.dispatch(payload as never)).resolves.toEqual({ sessionSucceeded: true });
    expect(compositionState.bind).toHaveBeenCalledTimes(1);
    expect(compositionState.dispatchTurn).toHaveBeenCalledWith(expect.objectContaining({
      executionId: "execution-1",
      intent: { targetId: "terra" },
      intentFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      payload,
    }));
    expect(runSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      routeCandidates: [{
        provider: "codex-oauth",
        model: "gpt-5.6-terra",
        credentialBinding: {
          routeId: "terra",
          accountId: "account-terra",
          credentialId: "credential-terra",
          credentialRevision: "post-fence-revision",
        },
        executionCredential: {
          credentialId: "credential-terra",
          accessToken: "synthetic-access-token",
          chatgptAccountId: "synthetic-account",
        },
      }],
    }));
  });

  it("rejects a non-direct admitted provider before runSession", async () => {
    let committedHandler: ((input: unknown) => Promise<unknown>) | undefined;
    compositionState.bind.mockImplementation((handler: (input: unknown) => Promise<unknown>) => {
      committedHandler = handler;
    });
    compositionState.dispatchTurn.mockImplementation(async (request: { readonly payload: unknown }) => ({
      result: await committedHandler?.({
        admission: { targetId: "native", providerId: "codex", providerModelId: "native-model" },
        binding: {
          status: "bound",
          routeId: "native",
          accountId: "account",
          credentialId: "credential",
          credentialRevision: "revision",
        },
        credential: {},
        authorityAdmission: { admissionId: "admission-1" },
        executionId: "execution-2",
        payload: request.payload,
      }),
    }));
    runSessionMock.mockResolvedValue({ sessionSucceeded: true });

    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "/repo",
      executionId: "execution-2",
      targetId: "native",
      authorityAdmissionEvidenceStore: authorityEvidenceStore,
      captureCatalogSnapshot: () => ({ catalog: {} as never, configurationRevision: { revisionSetId: "sha256:test", revisions: {} } }),
      configurationRevision: {
        revisionSetId: "sha256:test",
        revisions: { global: "global", project: "project" },
      },
    });

    await expect(dispatcher.dispatch({} as never)).rejects.toThrow("unsupported direct provider");
    expect(runSessionMock).not.toHaveBeenCalled();
  });

  it("disposes consumed prepared resources when session creation throws", async () => {
    const authorityAdmission = routedAdmission({
      sessionId: "runtime-session-1",
      turnId: "turn-1",
      routeId: "terra",
      providerModelId: "gpt-5.6-terra",
      accountId: "account",
      credentialId: "credential",
      credentialRevision: "revision",
    });
    authorityEvidenceStore.readAdmission.mockReturnValue(authorityAdmission);
    let committedHandler: ((input: unknown) => Promise<unknown>) | undefined;
    compositionState.bind.mockImplementation((handler: (input: unknown) => Promise<unknown>) => {
      committedHandler = handler;
    });
    compositionState.dispatchTurn.mockImplementation(async (request: { readonly payload: unknown }) => ({
      result: await committedHandler?.({
        admission: { targetId: "terra", providerId: "codex-oauth", providerModelId: "gpt-5.6-terra" },
        binding: { status: "bound", routeId: "terra", accountId: "account", credentialId: "credential", credentialRevision: "revision" },
        credential: {},
        authorityAdmission,
        executionId: "execution-3",
        payload: request.payload,
      }),
    }));
    runSessionMock.mockRejectedValue(new Error("session creation failed"));
    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "/repo",
      executionId: "execution-3",
      targetId: "terra",
      authorityAdmissionEvidenceStore: authorityEvidenceStore,
      captureCatalogSnapshot: () => ({ catalog: {} as never, configurationRevision: { revisionSetId: "sha256:test", revisions: {} } }),
      configurationRevision: { revisionSetId: "sha256:test", revisions: { global: "global", project: "project" } },
    });

    await expect(dispatcher.dispatch({ sessionConfig: { task: "test", permissionPolicy: {} } } as never)).rejects.toThrow("session creation failed");
    expect(preparedResources.dispose).toHaveBeenCalledTimes(1);
    expect(preparedResources.disconnect).toHaveBeenCalledTimes(1);
  });

  it("passes the session budget to canonical Runtime preflight exactly once", () => {
    const sessionTurnBudget = { admit: vi.fn() };
    createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "/repo",
      executionId: "execution-budget",
      targetId: "terra",
      authorityAdmissionEvidenceStore: authorityEvidenceStore,
      captureCatalogSnapshot: () => ({ catalog: {} as never, configurationRevision: { revisionSetId: "sha256:test", revisions: {} } }),
      configurationRevision: { revisionSetId: "sha256:test", revisions: { global: "global", project: "project" } },
      sessionTurnBudget: sessionTurnBudget as never,
    });
    expect((authorityCoordinatorState.options as { sessionTurnBudget?: unknown }).sessionTurnBudget).toBe(sessionTurnBudget);
  });
});
