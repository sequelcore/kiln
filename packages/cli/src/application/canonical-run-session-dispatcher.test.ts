import { describe, expect, it, vi } from "vitest";
import { createCanonicalRunSessionDispatcher } from "./canonical-run-session-dispatcher.js";

const mocks = vi.hoisted(() => ({
  dispatchTurn: vi.fn(),
  close: vi.fn(),
}));

vi.mock("./operator-turn-dispatch-composition.js", () => ({
  createOperatorTurnDispatchComposition: vi.fn(() => ({
    bridge: { bind: vi.fn() },
    dispatcher: { dispatchTurn: mocks.dispatchTurn },
    close: mocks.close,
  })),
}));

describe("createCanonicalRunSessionDispatcher", () => {
  it("binds an operator-selected eligible account into the canonical turn intent", async () => {
    mocks.dispatchTurn.mockResolvedValue({ result: { sessionSucceeded: true } });
    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "C:/workspace",
      executionId: "benchmark-trial-1",
      routeId: "codex-sol",
      accountOverrideId: "subscription-a",
    });

    await dispatcher.dispatch({} as never);

    expect(mocks.dispatchTurn).toHaveBeenCalledWith(expect.objectContaining({
      executionId: "benchmark-trial-1",
      intent: {
        routeId: "codex-sol",
        accountOverrideId: "subscription-a",
      },
    }));
  });
});
