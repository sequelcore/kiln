import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuiGatewayClient, resolveCandidateBaseUrls } from "../src/api/client.js";

describe("GuiGatewayClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("rejects when dashboard fetch fails instead of synthesizing a fallback snapshot", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("gateway unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");

    await expect(client.loadDashboard()).rejects.toThrow();
  });

  it("loads session detail from the GUI session detail endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "session-9",
      meta: {
        kilnSessionId: "session-9",
        task: "Inspect preview flow",
        startedAt: "2026-04-21T10:00:00.000Z",
      },
      events: [],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const detail = await client.loadSessionDetail("session-9");

    expect(detail?.id).toBe("session-9");
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gui/api/sessions/session-9");
  });

  it("returns null when no candidate endpoint resolves a session detail payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const detail = await client.loadSessionDetail("missing-session");

    expect(detail).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("ignores query params, localStorage values, and hardcoded fallback ports when resolving candidate base URLs", () => {
    window.history.replaceState({}, "", "/?gatewayUrl=http://localhost:7777&gatewayPort=6666&port=5555");
    localStorage.setItem("kiln.gui.gateway.baseUrl", "http://localhost:4444");
    localStorage.setItem("kiln.gui.gateway.port", "3333");

    expect(resolveCandidateBaseUrls("http://localhost:4810/gui?theme=dark", "http://127.0.0.1:9000/app")).toEqual([
      "http://127.0.0.1:9000",
      "http://localhost:4810",
    ]);
  });

  it("rejects when dashboard workspaceTree payload is malformed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      providers: [],
      sessions: [],
      telemetry: {
        status: "idle",
        dominantRegions: [],
        saturation: 0,
        entropy: 0,
      },
      resumeInfoByProvider: {},
      workspaceTree: {
        rootPath: 42,
        entries: [],
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");

    await expect(client.loadDashboard()).rejects.toThrow("Invalid dashboard workspace tree rootPath.");
  });

  it("rejects when dashboard workspaceTree entries payload is malformed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      providers: [],
      sessions: [],
      telemetry: {
        status: "idle",
        dominantRegions: [],
        saturation: 0,
        entropy: 0,
      },
      resumeInfoByProvider: {},
      workspaceTree: {
        rootPath: "C:/Proyectos/Sequel/kiln",
        entries: "not-an-array",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");

    await expect(client.loadDashboard()).rejects.toThrow("Invalid dashboard workspace tree entries payload.");
  });
});
