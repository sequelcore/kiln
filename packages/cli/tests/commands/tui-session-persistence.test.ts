import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionRecord } from "../../src/wrapper/session-store.js";

vi.mock("@kilnai/tui", () => ({ GatewaySession: vi.fn(), waitForGateway: vi.fn(), startTui: vi.fn() }));
vi.mock("@kilnai/runtime", () => ({ startTuiGateway: vi.fn() }));

// We test makeResumableSessionFactory via a lightweight re-implementation
// that mirrors the exported function's logic — this keeps tests fast and
// isolated without requiring the full runtime to be importable.
//
// The actual function is tested by importing it directly once exported.
import { makeResumableSessionFactory } from "../../src/commands/tui.js";

function makeStore(lastRecord: SessionRecord | null = null) {
  const appended: SessionRecord[] = [];
  return {
    store: {
      last: vi.fn().mockResolvedValue(lastRecord),
      append: vi.fn().mockImplementation(async (r: SessionRecord) => {
        appended.push(r);
      }),
      clearLast: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("../../src/wrapper/session-store.js").SessionStore,
    appended,
  };
}

function makeRegistry(sessionId = "sess-abc") {
  const sessions: { sessionId: string; resumeSessionId?: string; dispose: () => Promise<void> }[] = [];
  const registry = {
    createSession: vi.fn().mockImplementation(
      (_provider: string, opts: { resumeSessionId?: string }) => {
        const session = {
          sessionId,
          resumeSessionId: opts.resumeSessionId,
          dispose: vi.fn().mockResolvedValue(undefined),
        };
        sessions.push(session);
        return session;
      },
    ),
  } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
  return { registry, sessions };
}

describe("makeResumableSessionFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes resumeSessionId from store.last() on startup", async () => {
    const { store } = makeStore({ sessionId: "prev-session", provider: "claude", task: "interactive", completedAt: "2026-01-01T00:00:00.000Z", cost: 0, projectPath: "/p" });
    const { registry } = makeRegistry();

    const { factory } = await makeResumableSessionFactory("claude", "/p", registry, store);
    factory("sys", "/p");

    expect(registry.createSession).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({ resumeSessionId: "prev-session" }),
    );
  });

  it("initializes with undefined resumeSessionId when store is empty", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();

    const { factory } = await makeResumableSessionFactory("claude", "/p", registry, store);
    factory("sys", "/p");

    expect(registry.createSession).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({ resumeSessionId: undefined }),
    );
  });

  it("calls store.append() after session dispose", async () => {
    const { store, appended } = makeStore(null);
    const { registry } = makeRegistry("sess-1");

    const { factory } = await makeResumableSessionFactory("claude", "/proj", registry, store);
    const session = factory("sys", "/proj");
    await session.dispose();

    expect(store.append).toHaveBeenCalledOnce();
    expect(appended[0]).toMatchObject({
      sessionId: "sess-1",
      provider: "claude",
      task: "interactive",
      projectPath: "/proj",
    });
    expect(typeof appended[0]!.completedAt).toBe("string");
  });

  it("passes captured sessionId as resumeSessionId on next turn", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry("sess-first");

    const { factory } = await makeResumableSessionFactory("claude", "/proj", registry, store);
    const first = factory("sys", "/proj");
    await first.dispose();

    // Second call should resume from first session
    factory("sys", "/proj");

    expect(registry.createSession).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(registry.createSession).mock.calls[1]!;
    expect(secondCall[1]).toMatchObject({ resumeSessionId: "sess-first" });
  });

  it("onClear resets resumeSessionId to undefined", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry("sess-abc");

    const { factory, onClear } = await makeResumableSessionFactory("claude", "/proj", registry, store);

    // Establish a session so resumeSessionId gets set
    const session = factory("sys", "/proj");
    await session.dispose();

    // After clear, next session should have no resumeSessionId
    await onClear();
    factory("sys", "/proj");

    // calls[0] = first factory call, calls[1] = post-clear factory call
    const postClearCall = vi.mocked(registry.createSession).mock.calls[1]!;
    expect(postClearCall[1]).toMatchObject({ resumeSessionId: undefined });
  });

  it("onClear calls sessionStore.clearLast with the provider", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    store.clearLast = vi.fn().mockResolvedValue(undefined);

    const { onClear } = await makeResumableSessionFactory("claude", "/proj", registry, store);
    await onClear();

    expect(store.clearLast).toHaveBeenCalledWith("claude");
  });
});
