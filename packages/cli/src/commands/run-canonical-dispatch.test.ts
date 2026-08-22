import { beforeEach, describe, expect, it, vi } from "vitest";

const compositionState = vi.hoisted(() => ({
  bind: vi.fn(),
  dispatchTurn: vi.fn(),
  close: vi.fn(),
}));
const runSessionMock = vi.hoisted(() => vi.fn());
const authorityEvidenceStore = vi.hoisted(() => ({
  persist: vi.fn(),
  loadSessionFacet: vi.fn(),
}));
const preparedResources = vi.hoisted(() => ({
  dispose: vi.fn(),
  disconnect: vi.fn(),
}));
const authorityCoordinatorState = vi.hoisted(() => ({ options: undefined as unknown }));

vi.mock("../application/operator-turn-dispatch-composition.js", () => ({
  createOperatorTurnDispatchComposition: vi.fn(() => ({
    bridge: { bind: compositionState.bind },
    authorityAdmissionBridge: { bind: vi.fn() },
    dispatcher: { dispatchTurn: compositionState.dispatchTurn },
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
    authorityCoordinatorState.options = undefined;
    preparedResources.dispose.mockReset();
    preparedResources.disconnect.mockReset();
  });

  it("passes one committed route/account/credential binding to runSession", async () => {
    let committedHandler: ((input: unknown) => Promise<unknown>) | undefined;
    compositionState.bind.mockImplementation((handler: (input: unknown) => Promise<unknown>) => {
      committedHandler = handler;
    });
    compositionState.dispatchTurn.mockImplementation(async (request: { readonly payload: unknown }) => {
      if (!committedHandler) throw new Error("missing committed handler");
      return {
        result: await committedHandler({
          admission: {
            routeId: "terra",
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
          authorityAdmission: { admissionId: "admission-1" },
          executionId: "execution-1",
          payload: request.payload,
        }),
      };
    });
    runSessionMock.mockResolvedValue({ sessionSucceeded: true });

    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "/repo",
      executionId: "execution-1",
      routeId: "terra",
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
      intent: { routeId: "terra" },
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
        admission: { routeId: "native", providerId: "codex", providerModelId: "native-model" },
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
      routeId: "native",
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
    let committedHandler: ((input: unknown) => Promise<unknown>) | undefined;
    compositionState.bind.mockImplementation((handler: (input: unknown) => Promise<unknown>) => {
      committedHandler = handler;
    });
    compositionState.dispatchTurn.mockImplementation(async (request: { readonly payload: unknown }) => ({
      result: await committedHandler?.({
        admission: { routeId: "terra", providerId: "codex-oauth", providerModelId: "gpt-5.6-terra" },
        binding: { status: "bound", routeId: "terra", accountId: "account", credentialId: "credential", credentialRevision: "revision" },
        credential: {},
        authorityAdmission: { admissionId: "admission-1" },
        executionId: "execution-3",
        payload: request.payload,
      }),
    }));
    runSessionMock.mockRejectedValue(new Error("session creation failed"));
    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "/repo",
      executionId: "execution-3",
      routeId: "terra",
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
      routeId: "terra",
      authorityAdmissionEvidenceStore: authorityEvidenceStore,
      captureCatalogSnapshot: () => ({ catalog: {} as never, configurationRevision: { revisionSetId: "sha256:test", revisions: {} } }),
      configurationRevision: { revisionSetId: "sha256:test", revisions: { global: "global", project: "project" } },
      sessionTurnBudget: sessionTurnBudget as never,
    });
    expect((authorityCoordinatorState.options as { sessionTurnBudget?: unknown }).sessionTurnBudget).toBe(sessionTurnBudget);
  });
});
