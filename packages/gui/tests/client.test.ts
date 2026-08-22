import { beforeEach, describe, expect, it, vi } from "vitest";
import { GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH, KILN_SETTINGS_SECTION_IDS } from "@kilnai/gateway-contracts";
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

  it("rejects malformed operator-session rows at the HTTP boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessions: [{
        sessionId: "session-1",
        title: "Missing required projection fields",
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");

    await expect(client.loadOperatorSessionHistory()).rejects.toThrow("Session list fetch failed");
  });

  it("reads resources through the canonical resource endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      uri: "kiln://session/work-items/work-1",
      target: {
        gatewayTargetId: "gateway:local-app",
        instanceId: "local-app:instance",
        sessionId: "session-1",
        resourceUri: "kiln://session/work-items/work-1",
      },
      contents: [
        {
          kind: "text",
          uri: "kiln://session/work-items/work-1",
          mimeType: "text/markdown",
          text: "# Work item",
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const result = await client.readResource({
      uri: " kiln://session/work-items/work-1 ",
      target: {
        gatewayTargetId: "gateway:local-app",
        instanceId: "local-app:instance",
        sessionId: "session-1",
        resourceUri: "kiln://session/work-items/work-1",
      },
      cursor: "line:100",
      limit: 25,
    });

    expect(result?.target).toMatchObject({
      gatewayTargetId: "gateway:local-app",
      instanceId: "local-app:instance",
      sessionId: "session-1",
      resourceUri: "kiln://session/work-items/work-1",
    });
    expect(result?.contents[0]).toMatchObject({
      kind: "text",
      mimeType: "text/markdown",
      text: "# Work item",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gui/api/resources/read");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uri: "kiln://session/work-items/work-1",
        target: {
          gatewayTargetId: "gateway:local-app",
          instanceId: "local-app:instance",
          sessionId: "session-1",
          resourceUri: "kiln://session/work-items/work-1",
        },
        cursor: "line:100",
        limit: 25,
      }),
    });
  });

  it("keeps data URL conversion as GUI presentation behavior", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      uri: "kiln://artifacts/capture",
      contents: [
        {
          kind: "blob",
          uri: "kiln://artifacts/capture",
          mimeType: "image/png",
          blob: "iVBORw0KGgo=",
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");

    await expect(client.loadResourceDataUrl("kiln://artifacts/capture")).resolves.toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  it("preserves summarized text resources as shared operator resource JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      uri: "kiln://external-engagement/artifacts",
      summary: {
        kind: "external-engagement",
        totalCount: 2,
        counts: {
          artifact: 2,
          candidate: 3,
        },
        facets: {
          artifactKinds: ["candidate-report", "evidence-report"],
        },
      },
      contents: [
        {
          kind: "text",
          uri: "kiln://external-engagement/artifacts",
          mimeType: "application/json",
          text: "{\"artifactRoot\":\".kiln/external-engagement\"}",
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");

    const dataUrl = await client.loadResourceDataUrl("kiln://external-engagement/artifacts");
    expect(dataUrl).toMatch(/^data:application\/json;charset=utf-8;base64,/u);
    const payload = JSON.parse(atob(dataUrl!.slice(dataUrl!.indexOf(",") + 1)));
    expect(payload).toEqual({
      uri: "kiln://external-engagement/artifacts",
      summary: {
        kind: "external-engagement",
        totalCount: 2,
        counts: {
          artifact: 2,
          candidate: 3,
        },
        facets: {
          artifactKinds: ["candidate-report", "evidence-report"],
        },
      },
      presentation: {
        uri: "kiln://external-engagement/artifacts",
        title: "external-engagement",
        total: { label: "total", value: 2 },
        counts: [
          { label: "artifact", value: 2 },
          { label: "candidate", value: 3 },
        ],
        facets: [
          { label: "artifactKinds", values: ["candidate-report", "evidence-report"] },
        ],
        meta: [],
        contentCount: 1,
        hasMore: false,
      },
      contents: [{
        kind: "text",
        uri: "kiln://external-engagement/artifacts",
        mimeType: "application/json",
        text: "{\"artifactRoot\":\".kiln/external-engagement\"}",
      }],
    });
  });

  it("loads app and tenant descriptors from the dashboard", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      executionRouteCatalog: { routes: [] },
      providers: [],
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
          admissionReadyCount: 0,
          admissionDegradedCount: 0,
          admissionBlockedCount: 0,
          admissionUnknownCount: 0,
          executionHealthyCount: 0,
          executionDegradedCount: 0,
          executionUnknownCount: 0,
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
      executionRouteCatalog: { routes: [] },
      providers: [],
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
      executionRouteCatalog: { routes: [] },
      providers: [],
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
      globalInstructionShims: [],
      nativeProjections: [],
      permissionIntegrity: [],
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
        globalInstructionShims: [],
        nativeProjections: [],
        permissionIntegrity: [],
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

  it("reads and mutates settings through validated capability-bearing requests", async () => {
    const snapshot = {
      schemaRevision: 1,
      generatedAt: "2026-08-21T00:00:00.000Z",
      health: "current",
      sections: KILN_SETTINGS_SECTION_IDS.map((id) => ({ id, label: id, description: id, entryKeys: [] })),
      entries: [],
      revisions: {},
      modifiedCount: 0,
    };
    const proposal = {
      proposalId: "cfg_settings",
      createdAt: "2026-08-21T00:00:00.000Z",
      scope: "project",
      operation: "setting.reset",
      key: "domain",
      status: "valid",
      baseRevision: "absent",
      affectedOwners: ["project-configuration"],
      reconciliation: [],
      authorityImpact: "none",
      approvalRequired: false,
      activation: "next-session",
      diagnostics: [],
      rollback: { restorable: true, summary: "Restore the prior value." },
    };
    const result = {
      proposalId: "cfg_settings",
      scope: "project",
      operation: "setting.reset",
      outcome: "committed",
      rejectionCode: null,
      committedRevision: `sha256:${"b".repeat(64)}`,
      activation: "next-session",
      reconciliation: [],
      diagnostics: [],
      replayed: false,
      readBack: { schemaRevision: 1, verified: true },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot))
      .mockResolvedValueOnce(Response.json(proposal))
      .mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810", "local-capability");
    await expect(client.loadSettings()).resolves.toEqual(snapshot);
    await expect(client.proposeSettingsMutation({
      operation: "setting.reset",
      scope: "project",
      key: "domain",
      expectedRevision: "absent",
    })).resolves.toEqual(proposal);
    await expect(client.applySettingsMutation({ proposalId: "cfg_settings" })).resolves.toEqual(result);

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "x-kiln-operator-token": "local-capability" }),
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "x-kiln-operator-token": "local-capability" }),
    });
  });

  it("reads secret-free onboarding readiness and applies with the local operator capability", async () => {
    const readiness = {
      schemaVersion: 1,
      status: "ready",
      scope: "project",
      posture: "read-only",
      targets: [{
        id: "codex-terra",
        label: "Codex Terra",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-terra",
        selected: true,
      }],
      defaultTargetId: "codex-terra",
      blockers: [],
      nextAction: "Apply onboarding to this project.",
    } as const;
    const result = {
      schemaVersion: 1,
      status: "committed",
      projectAdoption: { outcome: "committed", replayed: false, diagnostics: [] },
      targetSelection: null,
      blockers: [],
      nextAction: "Start the first turn.",
    } as const;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(readiness), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810", "local-capability");
    expect(await client.loadConfigurationOnboarding()).toEqual(readiness);
    expect(await client.applyConfigurationOnboarding({
      schemaVersion: 1,
      scope: "project",
      posture: "read-only",
      targetId: "codex-terra",
    })).toEqual(result);

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kiln-operator-token": "local-capability",
      },
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
