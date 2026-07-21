import { describe, expect, it, vi } from "vitest";
import type { UpgradeWebSocket } from "hono/ws";
import { createHarnessIngressRoutes } from "../../src/gateway/harness-ingress-routes.js";
import type { WebSocketLike } from "../../src/channels/web-channel.js";

type Handlers = ReturnType<Parameters<UpgradeWebSocket>[0]>;

function makeUpgrade() {
  let factory: Parameters<UpgradeWebSocket>[0] | undefined;
  const upgradeWebSocket: UpgradeWebSocket = (candidate) => {
    factory = candidate;
    return async (_c, next) => next();
  };
  return {
    upgradeWebSocket,
    connect(headers: Record<string, string> = {}) {
      if (!factory) throw new Error("upgrade was not registered");
      const handlers = factory({
        req: { header: (name: string) => headers[name] },
        get: () => ({
          callerId: headers["X-Caller"] ?? "caller-1",
          appName: "app-one",
          userId: headers["X-User"] ?? "user-1",
          tenantId: "tenant-1",
        }),
      } as never);
      const ws: WebSocketLike = { send: vi.fn(), readyState: 1 };
      return { handlers, ws: ws as never };
    },
  };
}

function frame(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ protocolVersion: "1", type: "turn_start", requestId: "request-1", content: "hello", ...overrides });
}

function makeRuntime() {
  return {
    appName: "app-one",
    tenant: { tenantId: "tenant-1" },
    systemPrompt: "system",
    orchestrator: { processMessage: vi.fn() },
    sessionRegistry: {},
  };
}

function createFixture(overrides: Record<string, unknown> = {}) {
  const upgrade = makeUpgrade();
  const processAdmittedTurn = vi.fn().mockResolvedValue({
    ok: true,
    result: { sessionId: "session-canonical", parts: [{ type: "text", text: "safe reply" }] },
  });
  const authenticate = vi.fn().mockResolvedValue({ callerId: "caller-1", appName: "app-one", userId: "user-1", tenantId: "tenant-1" });
  const resolveTarget = vi.fn().mockReturnValue(makeRuntime());
  const app = createHarnessIngressRoutes({
    upgradeWebSocket: upgrade.upgradeWebSocket,
    authenticate,
    resolveTarget,
    processAdmittedTurn,
    ...overrides,
  } as never);
  return { app, upgrade, processAdmittedTurn, authenticate, resolveTarget };
}

async function open(handlers: Handlers, ws: never) {
  await handlers.onOpen?.(new Event("open"), ws);
}

async function message(handlers: Handlers, ws: never, payload: string) {
  await handlers.onMessage?.({ data: payload } as MessageEvent, ws);
}

function sent(ws: { send: ReturnType<typeof vi.fn> }) {
  return ws.send.mock.calls.map(([value]) => JSON.parse(value as string));
}

describe("createHarnessIngressRoutes", () => {
  it("authenticates the Authorization bearer value before upgrade and never accepts a query token", async () => {
    const fixture = createFixture();
    const response = await fixture.app.request("http://localhost/harness/v1/ws?token=secret", { headers: { Authorization: "Bearer token-value" } });
    expect(response.status).toBe(404);
    expect(fixture.authenticate).toHaveBeenCalledWith("token-value");

    const noAuth = createFixture();
    await noAuth.app.request("http://localhost/harness/v1/ws?token=secret");
    expect(noAuth.authenticate).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated upgrades before a websocket handler exists", async () => {
    const fixture = createFixture({ authenticate: vi.fn().mockResolvedValue(undefined) });
    const response = await fixture.app.request("http://localhost/harness/v1/ws", { headers: { Authorization: "Bearer invalid" } });
    expect(response.status).toBe(401);
  });

  it("rejects malformed frames without resolving a target or running a turn", async () => {
    const fixture = createFixture();
    const { handlers, ws } = fixture.upgrade.connect({ Authorization: "Bearer ignored-after-upgrade" });
    await open(handlers, ws);
    await message(handlers, ws, "not json");
    expect(fixture.resolveTarget).not.toHaveBeenCalled();
    expect(fixture.processAdmittedTurn).not.toHaveBeenCalled();
    expect(sent(ws)).toEqual([{ protocolVersion: "1", type: "error", requestId: "invalid", code: "invalid_request", redacted: true }]);
  });

  it("rejects an unknown target before session or provider work", async () => {
    const fixture = createFixture({ resolveTarget: vi.fn().mockReturnValue(undefined) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    expect(fixture.processAdmittedTurn).not.toHaveBeenCalled();
    expect(sent(ws).at(-1)).toMatchObject({ type: "error", code: "unsupported", redacted: true });
  });

  it("rejects a transport tenant that does not exactly match the effective runtime tenant", async () => {
    const fixture = createFixture({ resolveTarget: vi.fn().mockReturnValue({ ...makeRuntime(), tenant: undefined }) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    expect(fixture.processAdmittedTurn).not.toHaveBeenCalled();
    expect(sent(ws).at(-1)).toMatchObject({ type: "error", code: "unsupported", redacted: true });
  });

  it("uses the governed admitted-turn pipeline with trusted identity and safe completion", async () => {
    const fixture = createFixture();
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame({ sessionId: "session-requested", requestedAuthority: "audited", reasoningEffort: "high" }));
    expect(fixture.processAdmittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      appName: "app-one", tenantId: "tenant-1", userId: "user-1", sessionId: "session-requested", channel: "harness", requestedAuthority: "audited",
      perCallConfig: expect.objectContaining({ turnId: "request-1", reasoningEffort: "high", abortSignal: expect.any(AbortSignal) }),
    }));
    expect(sent(ws)).toEqual([
      { protocolVersion: "1", type: "turn_accepted", requestId: "request-1", turnId: "request-1", sessionId: "session-requested" },
      { protocolVersion: "1", type: "turn_completed", requestId: "request-1", turnId: "request-1", sessionId: "session-canonical", outcome: "completed", content: "safe reply" },
    ]);
  });

  it("prevents duplicate active work and allows only the same trusted identity to cancel it", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const processAdmittedTurn = vi.fn().mockReturnValue(pending);
    const fixture = createFixture({ processAdmittedTurn });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await Promise.resolve();
    await message(handlers, ws, frame({ requestId: "request-2" }));
    await message(handlers, ws, JSON.stringify({ protocolVersion: "1", type: "turn_cancel", requestId: "cancel-1", turnId: "request-1" }));
    const frames = sent(ws);
    expect(frames).toContainEqual(expect.objectContaining({ type: "error", requestId: "request-2", code: "unsupported" }));
    expect(frames).toContainEqual({ protocolVersion: "1", type: "turn_cancel_result", requestId: "cancel-1", turnId: "request-1", status: "accepted" });
    const call = processAdmittedTurn.mock.calls[0]![0] as { perCallConfig: { abortSignal: AbortSignal } };
    expect(call.perCallConfig.abortSignal.aborted).toBe(true);
    finish({ ok: true, result: { sessionId: "session-canonical", parts: [] } });
  });

  it("redacts internal failures and does not leak them through outbound frames", async () => {
    const fixture = createFixture({ processAdmittedTurn: vi.fn().mockRejectedValue(new Error("provider secret detail")) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    const frames = sent(ws);
    expect(JSON.stringify(frames)).not.toContain("provider secret detail");
    expect(frames.at(-1)).toEqual({ protocolVersion: "1", type: "error", requestId: "request-1", code: "internal", redacted: true });
  });

  it("projects only validated safe completion parts and never forwards provider/internal parts", async () => {
    const fixture = createFixture({
      processAdmittedTurn: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          sessionId: "session-canonical",
          parts: [
            { type: "text", text: "safe response" },
            { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
            { type: "tool_call", name: "internal_tool", arguments: "secret" },
            { type: "file", mimeType: "text/plain", data: "aGVsbG8=", filename: "output.txt", providerTrace: "private" },
          ],
        },
      }),
    });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await Promise.resolve();
    const completion = sent(ws).at(-1);
    expect(completion).toEqual({
      protocolVersion: "1", type: "turn_completed", requestId: "request-1", turnId: "request-1", sessionId: "session-canonical", outcome: "completed",
      parts: [
        { type: "text", text: "safe response" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        { type: "file", mimeType: "text/plain", data: "aGVsbG8=", filename: "output.txt" },
      ],
    });
    expect(JSON.stringify(completion)).not.toContain("internal_tool");
    expect(JSON.stringify(completion)).not.toContain("providerTrace");
  });

  it("maps budget denial to the closed unavailable error frame", async () => {
    const fixture = createFixture({ processAdmittedTurn: vi.fn().mockResolvedValue({ ok: false, budgetDenied: { budgetExhausted: true, message: "private budget detail" } }) });
    const { handlers, ws } = fixture.upgrade.connect();
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await Promise.resolve();
    expect(sent(ws).at(-1)).toEqual({ protocolVersion: "1", type: "error", requestId: "request-1", code: "unavailable", redacted: true });
  });

  it("keeps admitted work alive when the initiating socket closes before completion", async () => {
    const fixture = createFixture();
    const { handlers, ws } = fixture.upgrade.connect();
    ws.send.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("socket closed"); });
    await open(handlers, ws);
    await message(handlers, ws, frame());
    await Promise.resolve();
    expect(fixture.processAdmittedTurn).toHaveBeenCalledOnce();
    expect(ws.send).toHaveBeenCalledTimes(2);
  });

  it("isolates active turns by the trusted caller and user session key", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const processAdmittedTurn = vi.fn().mockReturnValue(pending);
    const fixture = createFixture({ processAdmittedTurn });
    const first = fixture.upgrade.connect();
    const second = fixture.upgrade.connect({ "X-Caller": "caller-2" });
    await open(first.handlers, first.ws);
    await open(second.handlers, second.ws);
    await message(first.handlers, first.ws, frame({ sessionId: "shared-session" }));
    await Promise.resolve();
    await message(second.handlers, second.ws, JSON.stringify({ protocolVersion: "1", type: "turn_cancel", requestId: "cancel-other", sessionId: "shared-session", turnId: "request-1" }));
    expect(sent(second.ws).at(-1)).toEqual({ protocolVersion: "1", type: "turn_cancel_result", requestId: "cancel-other", turnId: "request-1", status: "not_active" });
    const call = processAdmittedTurn.mock.calls[0]![0] as { perCallConfig: { abortSignal: AbortSignal } };
    expect(call.perCallConfig.abortSignal.aborted).toBe(false);
    finish({ ok: true, result: { sessionId: "shared-session", parts: [] } });
  });
});
