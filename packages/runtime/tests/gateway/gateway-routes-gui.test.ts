import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { createGatewayApp } from "../../src/gateway/gateway-routes.js";

describe("App Gateway GUI routes", () => {
  it("exposes a minimal GUI dashboard for App Gateway attach mode", async () => {
    const app = createGatewayApp({
      port: 3800,
      apps: [],
    });

    const response = await app.request("http://localhost/gui/api/dashboard");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      providers: [],
      sessions: [],
      telemetry: {
        status: "stable",
        dominantRegions: [],
        saturation: 0,
        entropy: 0,
      },
      resumeInfoByProvider: {},
      domainLabel: "app-gateway",
    });
  });

  it("exposes runtime-capable apps and active tenant selection in the GUI dashboard", async () => {
    const app = createGatewayApp({
      port: 3800,
      apps: [
        {
          name: "support",
          app: {} as never,
          binding: { channels: [{ type: "api", path: "/api/support" }] },
          registry: {} as never,
          tenantRuntime: {
            appName: "support",
            orchestrator: {} as never,
            sessionRegistry: { activeSessions: vi.fn().mockResolvedValue([]) } as never,
            tenantRegistry: {
              get: vi.fn(),
              list: vi.fn().mockReturnValue([
                {
                  tenantId: "acme",
                  appName: "support",
                  name: "ACME",
                  enabled: true,
                },
              ]),
            } as never,
          },
        } as never,
      ],
    });

    const response = await app.request("http://localhost/gui/api/dashboard");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      apps: [
        {
          name: "support",
          runtime: "tenant",
          channels: ["api"],
          runtimeCapable: true,
          tenants: [{ tenantId: "acme", label: "ACME", enabled: true }],
        },
      ],
      activeAppName: "support",
      activeTenantId: "acme",
      domainLabel: "support",
    });
  });

  it("exposes an empty GUI session list when no runtime sessions exist", async () => {
    const app = createGatewayApp({
      port: 3800,
      apps: [],
    });

    const response = await app.request("http://localhost/gui/api/sessions");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sessions: [] });
  });

  it("returns a structured GUI websocket error when no runtime app is available", async () => {
    let handlers: {
      onOpen?: (event: Event, ws: { send: (value: string) => void }) => void | Promise<void>;
      onMessage?: (event: MessageEvent, ws: { send: (value: string) => void }) => void | Promise<void>;
    } | undefined;
    const app = createGatewayApp({
      port: 3800,
      apps: [],
      upgradeWebSocket: ((factory: (c: unknown) => typeof handlers) => {
        return (c: { text: (value: string) => Response }) => {
          handlers = factory(c);
          return c.text("upgraded");
        };
      }) as never,
    });

    const response = await app.request("http://localhost/gui/ws?userId=gui-test");
    expect(response.status).toBe(200);
    expect(handlers).toBeDefined();

    const send = vi.fn();
    await handlers?.onOpen?.(new Event("open"), { send });
    await handlers?.onMessage?.(
      new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hello" }) }),
      { send },
    );

    const sentFrames = send.mock.calls.map((call) => JSON.parse(call[0] as string) as { type: string; code?: string });
    expect(sentFrames).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "welcome" }),
      expect.objectContaining({ type: "error", code: "APP_GATEWAY_NO_GUI_RUNTIME" }),
    ]));
  });

  it("forwards requestedAuthority through App Gateway GUI provider-adapter messages", async () => {
    vi.resetModules();
    const processAdmittedTurnMock = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "mock response" }],
        inputTokens: 3,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "session-gui",
        sessionMode: "ai_active",
        traceId: "trace-gui",
        effectiveTurnAuthority: {
          executionMode: "execute",
          requestedAuthority: "audited",
          admittedAuthority: "fail_closed",
          sourcePolicy: "runtime_surface_projection",
          reason: "test",
          completeness: "authoritative",
          toolCount: 0,
          deniedToolCount: 1,
        },
      },
    });
    vi.doMock("../../src/gateway/message-pipeline.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/gateway/message-pipeline.js")>("../../src/gateway/message-pipeline.js");
      return {
        ...actual,
        processAdmittedTurn: processAdmittedTurnMock,
      };
    });
    const { createGatewayApp: createGatewayAppWithMocks } = await import("../../src/gateway/gateway-routes.js");
    const detachActive = vi.fn().mockResolvedValue(true);
    let handlers: {
      onOpen?: (event: Event, ws: { send: (value: string) => void }) => void | Promise<void>;
      onMessage?: (event: MessageEvent, ws: { send: (value: string) => void }) => void | Promise<void>;
    } | undefined;
    const app = createGatewayAppWithMocks({
      port: 3800,
      apps: [
        {
          name: "support",
          app: {} as never,
          binding: { channels: [{ type: "api", path: "/api/support" }] },
          registry: {} as never,
          providerAdapterRuntime: {
            appName: "support",
            orchestrator: {} as never,
            sessionRegistry: { activeSessions: vi.fn().mockResolvedValue([]), detachActive } as never,
            systemPrompt: "System prompt",
          },
        } as never,
      ],
      upgradeWebSocket: ((factory: (c: unknown) => typeof handlers) => {
        return (c: { text: (value: string) => Response }) => {
          handlers = factory(c);
          return c.text("upgraded");
        };
      }) as never,
    });

    const response = await app.request("http://localhost/gui/ws?userId=gui-test");
    expect(response.status).toBe(200);
    const send = vi.fn();
    await handlers?.onOpen?.(new Event("open"), { send });
    await handlers?.onMessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "message",
          content: "hello",
          requestedAuthority: "audited",
          sessionIntent: "fresh",
        }),
      }),
      { send },
    );

    expect(processAdmittedTurnMock).toHaveBeenCalledTimes(1);
    expect(detachActive).toHaveBeenCalledWith("support", "_gui", "_default");
    expect(detachActive.mock.invocationCallOrder[0]).toBeLessThan(processAdmittedTurnMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(processAdmittedTurnMock.mock.calls[0]![0].requestedAuthority).toBe("audited");
    expect(processAdmittedTurnMock.mock.calls[0]![0].sessionId).toBeUndefined();
    const sentFrames = send.mock.calls.map((call) => JSON.parse(call[0] as string) as { type: string; authorityStatus?: unknown });
    expect(sentFrames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "done",
        authorityStatus: { effective: "fail_closed", completeness: "authoritative" },
      }),
    ]));

    vi.doUnmock("../../src/gateway/message-pipeline.js");
    vi.resetModules();
  });

  it("rejects conflicting fresh session intent and resume session id in App Gateway GUI messages", async () => {
    let handlers: {
      onOpen?: (event: Event, ws: { send: (value: string) => void }) => void | Promise<void>;
      onMessage?: (event: MessageEvent, ws: { send: (value: string) => void }) => void | Promise<void>;
    } | undefined;
    const app = createGatewayApp({
      port: 3800,
      apps: [
        {
          name: "support",
          app: {} as never,
          binding: { channels: [{ type: "api", path: "/api/support" }] },
          registry: {} as never,
          providerAdapterRuntime: {
            appName: "support",
            orchestrator: {} as never,
            sessionRegistry: { activeSessions: vi.fn().mockResolvedValue([]) } as never,
            systemPrompt: "System prompt",
          },
        } as never,
      ],
      upgradeWebSocket: ((factory: (c: unknown) => typeof handlers) => {
        return (c: { text: (value: string) => Response }) => {
          handlers = factory(c);
          return c.text("upgraded");
        };
      }) as never,
    });

    const response = await app.request("http://localhost/gui/ws?userId=gui-test");
    expect(response.status).toBe(200);
    const send = vi.fn();
    await handlers?.onOpen?.(new Event("open"), { send });
    await handlers?.onMessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "message",
          content: "start clean",
          sessionIntent: "fresh",
          resumeSessionId: "session-old",
        }),
      }),
      { send },
    );

    const sentFrames = send.mock.calls.map((call) => JSON.parse(call[0] as string) as { type: string; code?: string });
    expect(sentFrames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "error",
        code: "APP_GATEWAY_CONFLICTING_SESSION_INTENT",
      }),
    ]));
  });

  it("forwards destructive requestedAuthority to App Gateway GUI processing", async () => {
    vi.resetModules();
    const processAdmittedTurnMock = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "mock response" }],
        inputTokens: 3,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "session-gui",
        sessionMode: "ai_active",
        traceId: "trace-gui",
        effectiveTurnAuthority: {
          executionMode: "execute",
          requestedAuthority: "destructive",
          admittedAuthority: "fail_closed",
          sourcePolicy: "runtime_surface_projection",
          reason: "test",
          completeness: "authoritative",
          toolCount: 0,
          deniedToolCount: 1,
        },
      },
    });
    vi.doMock("../../src/gateway/message-pipeline.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/gateway/message-pipeline.js")>("../../src/gateway/message-pipeline.js");
      return {
        ...actual,
        processAdmittedTurn: processAdmittedTurnMock,
      };
    });
    const { createGatewayApp: createGatewayAppWithMocks } = await import("../../src/gateway/gateway-routes.js");
    let handlers: {
      onOpen?: (event: Event, ws: { send: (value: string) => void }) => void | Promise<void>;
      onMessage?: (event: MessageEvent, ws: { send: (value: string) => void }) => void | Promise<void>;
    } | undefined;
    const app = createGatewayAppWithMocks({
      port: 3800,
      apps: [
        {
          name: "support",
          app: {} as never,
          binding: { channels: [{ type: "api", path: "/api/support" }] },
          registry: {} as never,
          providerAdapterRuntime: {
            appName: "support",
            orchestrator: {} as never,
            sessionRegistry: { activeSessions: vi.fn().mockResolvedValue([]) } as never,
            systemPrompt: "System prompt",
          },
        } as never,
      ],
      upgradeWebSocket: ((factory: (c: unknown) => typeof handlers) => {
        return (c: { text: (value: string) => Response }) => {
          handlers = factory(c);
          return c.text("upgraded");
        };
      }) as never,
    });

    const response = await app.request("http://localhost/gui/ws?userId=gui-test");
    expect(response.status).toBe(200);
    const send = vi.fn();
    await handlers?.onOpen?.(new Event("open"), { send });
    await handlers?.onMessage?.(
      new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hello", requestedAuthority: "destructive" }) }),
      { send },
    );

    expect(processAdmittedTurnMock).toHaveBeenCalledTimes(1);
    expect(processAdmittedTurnMock.mock.calls[0]![0].requestedAuthority).toBe("destructive");
    const sentFrames = send.mock.calls.map((call) => JSON.parse(call[0] as string) as { type: string; authorityStatus?: unknown });
    expect(sentFrames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "done",
        authorityStatus: { effective: "fail_closed", completeness: "authoritative" },
      }),
    ]));

    vi.doUnmock("../../src/gateway/message-pipeline.js");
    vi.resetModules();
  });
});
