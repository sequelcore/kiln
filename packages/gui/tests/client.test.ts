import { beforeEach, describe, expect, it, vi } from "vitest";
import { GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH } from "@kilnai/gateway-contracts";
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

  it("loads app and tenant descriptors from the dashboard", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      providers: [],
      sessions: [],
      telemetry: {
        status: "stable",
        dominantRegions: ["support"],
        saturation: 1,
        entropy: 0,
      },
      continuationInfoByProvider: {},
      operatorWorkspaceHome: {
        mode: "read-only",
        projectedAt: "2026-06-25T12:00:00.000Z",
        gatewayTargets: [
          {
            instanceId: "app-gateway:support",
            label: "support",
            gatewayTarget: {
              targetId: "app-gateway:support",
              kind: "local-app-gateway",
              trust: "local",
              label: "support",
              appId: "support",
            },
            sessionCount: 0,
            eventCount: 0,
            managedInvocationCount: 0,
            toolCallCount: 0,
            resourceLinkCount: 0,
            totalCostUsd: 0,
          },
        ],
        sessions: [],
        work: {
          totalCount: 0,
          activeCount: 0,
          blockedCount: 0,
          missingEvidenceCount: 0,
          goalCount: 0,
          activeGoalCount: 0,
          items: [],
        },
        managedAgents: { totalCount: 0, activeCount: 0, attentionCount: 0 },
        approvals: { pendingCount: 0, resolvedCount: 0, items: [] },
        configHealth: { status: "unknown", issueCount: 0, items: [] },
        routeHealth: {
          totalCount: 0,
          healthyCount: 0,
          degradedCount: 0,
          blockedCount: 0,
          unknownCount: 0,
          items: [],
        },
        providerReadiness: {
          totalCount: 0,
          liveProvenCount: 0,
          configuredCount: 0,
          unprovenCount: 0,
          unknownCount: 0,
          items: [],
        },
        gatewayHealth: {
          status: "healthy",
          targetCount: 1,
          localCount: 1,
          remoteCount: 0,
          appTargetCount: 1,
          tenantTargetCount: 0,
          items: [{
            targetId: "app-gateway:support",
            kind: "local-app-gateway",
            trust: "local",
            status: "healthy",
            sessionCount: 0,
            label: "support",
            appId: "support",
          }],
        },
        resources: { totalCount: 0, linkedResourceCount: 0, items: [] },
        attention: {
          items: [],
          totalCount: 0,
          actionRequiredCount: 0,
          blockedCount: 0,
          failedCount: 0,
        },
      },
      apps: [
        {
          name: "support",
          runtime: "tenant",
          channels: ["api"],
          runtimeCapable: true,
          tenants: [
            { tenantId: "acme", label: "ACME", enabled: true },
          ],
        },
      ],
      activeAppName: "support",
      activeTenantId: "acme",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const snapshot = await client.loadDashboard();

    expect(snapshot.activeAppName).toBe("support");
    expect(snapshot.activeTenantId).toBe("acme");
    expect(snapshot.apps?.[0]).toMatchObject({
      name: "support",
      runtime: "tenant",
      runtimeCapable: true,
      tenants: [{ tenantId: "acme", label: "ACME", enabled: true }],
    });
    expect(snapshot.operatorWorkspaceHome?.gatewayTargets[0]).toMatchObject({
      instanceId: "app-gateway:support",
      gatewayTarget: {
        targetId: "app-gateway:support",
        kind: "local-app-gateway",
        trust: "local",
        appId: "support",
      },
    });
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
      continuationInfoByProvider: {},
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
      continuationInfoByProvider: {},
      workspaceTree: {
        rootPath: "C:/workspace/kiln",
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

  it("loads a workspace directory snapshot from the gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      rootPath: "C:/repo",
      directoryPath: "C:/repo/src",
      parentPath: "C:/repo",
      source: "gateway",
      entries: [
        { path: "C:/repo/src/index.ts", name: "index.ts", kind: "file", sizeBytes: 42, vcs: { provider: "git", state: "modified" } },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const snapshot = await client.loadWorkspaceDirectory("C:/repo/src");

    expect(snapshot.entries[0]?.name).toBe("index.ts");
    expect(snapshot.entries[0]?.vcs).toEqual({ provider: "git", state: "modified" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gui/api/workspace/tree?path=C%3A%2Frepo%2Fsrc");
  });

  it("loads a workspace file preview from the gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      path: "C:/repo/src/index.ts",
      name: "index.ts",
      kind: "text",
      sizeBytes: 24,
      source: "gateway",
      encoding: "utf-8",
      content: "export const ok = true;",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const file = await client.loadWorkspaceFile("C:/repo/src/index.ts");

    expect(file.content).toBe("export const ok = true;");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gui/api/workspace/file?path=C%3A%2Frepo%2Fsrc%2Findex.ts");
  });

  it("loads Memory Lattice graph snapshots from the GUI gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      snapshot: {
        nodes: [{
          id: "memory:record-1",
          recordId: "record-1",
          layer: "semantic",
          scope: { kind: "project", id: "kiln" },
          label: "memory lattice",
          score: 1,
        }],
        edges: [],
        limits: { maxNodes: 25, maxEdges: 50 },
        truncated: false,
      },
      filters: {
        scope: { kind: "project", id: "kiln" },
        layer: "semantic",
        query: "admission",
        depth: 1,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const graph = await client.loadMemoryLatticeGraph({
      scope: { kind: "project", id: "kiln" },
      layer: "semantic",
      query: "admission",
      depth: 1,
      limit: 25,
    });

    expect(graph.snapshot.nodes[0]?.recordId).toBe("record-1");
    expect(graph.filters.scope).toEqual({ kind: "project", id: "kiln" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/gui/api/memory/graph?scopeKind=project&scopeId=kiln&layer=semantic&query=admission&depth=1&limit=25",
    );
  });

  it("loads setup status from the GUI gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      projectRoot: "C:/workspace/kiln",
      projectContext: {
        path: "C:/workspace/kiln/.kiln/project-context.md",
        status: "valid",
        recommendation: "none",
      },
      repoShims: [{
        target: "agents",
        targetId: "repo-shim:agents",
        path: "C:/workspace/kiln/AGENTS.md",
        status: "current",
        recommendation: "none",
      }],
      nativeProjections: [],
      recommendedActions: ["none"],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const setup = await client.loadConfigSetup();

    expect(setup.projectContext.status).toBe("valid");
    expect(setup.repoShims[0]?.targetId).toBe("repo-shim:agents");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gui/api/config/setup");
  });

  it("executes setup actions through the GUI gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      action: "sync-repo-shims",
      status: "applied",
      message: "Repo shims synced.",
      errors: [],
      setup: {
        projectRoot: "C:/workspace/kiln",
        projectContext: {
          path: "C:/workspace/kiln/.kiln/project-context.md",
          status: "valid",
          recommendation: "none",
        },
        repoShims: [{
          target: "agents",
          targetId: "repo-shim:agents",
          path: "C:/workspace/kiln/AGENTS.md",
          status: "current",
          recommendation: "none",
        }],
        nativeProjections: [],
        recommendedActions: ["none"],
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const result = await client.executeConfigSetupAction("sync-repo-shims");

    expect(result.status).toBe("applied");
    expect(result.setup.repoShims[0]?.status).toBe("current");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gui/api/config/setup/actions");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ action: "sync-repo-shims" }),
    });
  });

  it("rejects oversized Memory Lattice graph queries before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new GuiGatewayClient("http://localhost:4810");

    await expect(client.loadMemoryLatticeGraph({
      query: "x".repeat(GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH + 1),
    })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
