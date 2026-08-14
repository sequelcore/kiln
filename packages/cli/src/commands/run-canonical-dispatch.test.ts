import { beforeEach, describe, expect, it, vi } from "vitest";

const compositionState = vi.hoisted(() => ({
  bind: vi.fn(),
  dispatchTurn: vi.fn(),
  close: vi.fn(),
}));
const runSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../application/operator-turn-dispatch-composition.js", () => ({
  createOperatorTurnDispatchComposition: vi.fn(() => ({
    bridge: { bind: compositionState.bind },
    dispatcher: { dispatchTurn: compositionState.dispatchTurn },
    close: compositionState.close,
  })),
}));

vi.mock("../application/run-session.js", () => ({
  runSession: runSessionMock,
}));

import { createCanonicalRunSessionDispatcher } from "../application/canonical-run-session-dispatcher.js";

describe("createCanonicalRunSessionDispatcher", () => {
  beforeEach(() => {
    compositionState.bind.mockReset();
    compositionState.dispatchTurn.mockReset();
    compositionState.close.mockReset();
    runSessionMock.mockReset();
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
    });
    const payload = { marker: "session-options" };

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
        payload: request.payload,
      }),
    }));
    runSessionMock.mockResolvedValue({ sessionSucceeded: true });

    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "/repo",
      executionId: "execution-2",
      routeId: "native",
    });

    await expect(dispatcher.dispatch({} as never)).rejects.toThrow("unsupported direct provider");
    expect(runSessionMock).not.toHaveBeenCalled();
  });
});
