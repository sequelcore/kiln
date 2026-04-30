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
});
