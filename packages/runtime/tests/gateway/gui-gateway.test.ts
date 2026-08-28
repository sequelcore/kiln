import "./gui-gateway-test-fixture.js";
import * as guiFixture from "./gui-gateway-test-fixture.js";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GPT4O,
} from "@kilnai/core/agents";
import type {
  ToolResourceProvider,
} from "@kilnai/core/tools";
import {
  KILN_SETTINGS_SECTION_IDS,
  type KilnConfigSetupAction,
  type KilnSettingsApplyRequest,
  type KilnSettingsMutationResult,
  type KilnSettingsProposalRequest,
  type KilnSettingsProposalProjection,
  type KilnSettingsSnapshot,
} from "@kilnai/gateway-contracts";
import {
  Hono,
} from "hono";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  processAdmittedTurn,
} from "../../src/gateway/message-pipeline/index.js";
import {
  mountGuiStaticAssets,
  resolveGuiDistPath,
} from "../../src/gateway/gui-static-assets.js";
import {
  buildGuiOperatorDiscoveryResults,
} from "../../src/gateway/gui-provider-models.js";
import { runtimeCompletedDisposition } from "../session/runtime-terminal-fixture.js";

const {guiTestRouting, guiOperatorTransportDefaults, createGuiDist, selectGuiTestExecutionTarget, makeGuiOperatorDiscoveryFromModels} = guiFixture;
const guiSocketHarness = guiFixture.getGuiSocketHarness();

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gui-gateway-empty-"));
}

describe("GUI gateway HTTP and static assets", () => {
  it("serves /gui/index.html and falls back to index.html for unknown /gui routes", async () => {
    const distDir = createGuiDist();
    const app = new Hono();
    app.get("/gui", (c) => c.redirect("/gui/"));
    mountGuiStaticAssets(app, distDir);

    try {
      const indexResponse = await app.request("http://localhost/gui/index.html");
      expect(indexResponse.status).toBe(200);
      const indexHtml = await indexResponse.text();
      expect(indexHtml).toContain("GUI Test Build");

      const routeResponse = await app.request("http://localhost/gui/sessions/alpha");
      expect(routeResponse.status).toBe(200);
      const routeHtml = await routeResponse.text();
      expect(routeHtml).toContain("GUI Test Build");
      expect(routeHtml).toContain("/gui/assets/app.js");

      const assetResponse = await app.request("http://localhost/gui/assets/app.js");
      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toContain("asset-ok");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("binds to loopback and admits only startup-bound exact browser origins", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const externalGuiOrigin = "http://127.0.0.1:5183";
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    let serveOptions: { hostname?: string; port?: number } | undefined;
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation((options: {
        hostname?: string;
        port?: number;
        fetch: typeof appFetch;
      }) => {
        serveOptions = options;
        appFetch = options.fetch;
        return { port: 4917, stop };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        port: 0,
        guiDistPath: distDir,
        guiAssetMode: "external",
        externalGuiOrigin,
        getSnapshot: async () => ({}) as never,
      });

      expect(serveOptions).toMatchObject({ hostname: "127.0.0.1", port: 0 });
      expect(gateway.url).toBe("http://127.0.0.1:4917/gui/");
      expect(gateway.apiUrl).toBe("http://127.0.0.1:4917/gui/api/dashboard");

      const canonicalOrigin = "http://127.0.0.1:4917";
      const canonicalResponse = await appFetch!(new Request(`${canonicalOrigin}/health`, {
        headers: { origin: canonicalOrigin },
      }));
      expect(canonicalResponse.status).toBe(200);
      expect(canonicalResponse.headers.get("access-control-allow-origin")).toBe(canonicalOrigin);
      expect(canonicalResponse.headers.get("vary")).toContain("Origin");

      const externalResponse = await appFetch!(new Request(`${canonicalOrigin}/health`, {
        headers: { origin: externalGuiOrigin },
      }));
      expect(externalResponse.status).toBe(200);
      expect(externalResponse.headers.get("access-control-allow-origin")).toBe(externalGuiOrigin);

      const admittedPreflight = await appFetch!(new Request(`${canonicalOrigin}/gui/api/dashboard`, {
        method: "OPTIONS",
        headers: {
          origin: externalGuiOrigin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "Content-Type, X-Kiln-Operator-Token",
        },
      }));
      expect(admittedPreflight.status).toBe(204);
      expect(admittedPreflight.headers.get("access-control-allow-origin")).toBe(externalGuiOrigin);

      const deniedPreflight = await appFetch!(new Request(`${canonicalOrigin}/gui/api/dashboard`, {
        method: "OPTIONS",
        headers: {
          origin: externalGuiOrigin,
          "access-control-request-method": "DELETE",
        },
      }));
      expect(deniedPreflight.status).toBe(403);
      expect(deniedPreflight.headers.has("access-control-allow-origin")).toBe(false);

      for (const deniedOrigin of ["https://attacker.invalid", "http://localhost:4917", "null"]) {
        const denied = await appFetch!(new Request(`${canonicalOrigin}/health`, {
          headers: { origin: deniedOrigin },
        }));
        expect(denied.status).toBe(403);
        expect(denied.headers.has("access-control-allow-origin")).toBe(false);
      }

      const localProcessResponse = await appFetch!(new Request(`${canonicalOrigin}/health`));
      expect(localProcessResponse.status).toBe(200);
      expect(localProcessResponse.headers.has("access-control-allow-origin")).toBe(false);

      const deniedWebSocket = await appFetch!(new Request(`${canonicalOrigin}/gui/ws`, {
        headers: { origin: "https://attacker.invalid" },
      }));
      expect(deniedWebSocket.status).toBe(403);
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects a non-loopback external GUI origin before starting a listener", async () => {
    const serve = vi.fn();
    vi.stubGlobal("Bun", { serve });
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    await expect(startGuiGateway({
      guiAssetMode: "external",
      externalGuiOrigin: "https://gui.example.com",
      getSnapshot: async () => ({}) as never,
    })).rejects.toThrow("External GUI origin must be an exact loopback HTTP origin.");
    await expect(startGuiGateway({
      guiAssetMode: "external",
      externalGuiOrigin: "http://127.0.0.1",
      getSnapshot: async () => ({}) as never,
    })).rejects.toThrow("External GUI origin must be an exact loopback HTTP origin.");
    expect(serve).not.toHaveBeenCalled();
  });

  it("fails fast when an explicit GUI dist path is missing index.html", () => {
    const distDir = createTempDir();

    try {
      expect(() => resolveGuiDistPath(distDir)).toThrow("GUI bundle missing");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("starts an API-only gateway without resolving a GUI bundle when assets are external", async () => {
    const missingDistDir = createTempDir();
    const stop = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    const gateway = await startGuiGateway({
      guiAssetMode: "external",
      guiDistPath: missingDistDir,
      getSnapshot: async () => ({ } as never),
    });

    try {
      expect(gateway.hasMountedGui).toBe(false);
    } finally {
      gateway.shutdown();
      rmSync(missingDistDir, { recursive: true, force: true });
    }
  });

  it("starts listening before operator provider discovery resolves", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const discoverOperatorProviders = vi.fn(() => new Promise<never>(() => undefined));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        discoverOperatorProviders,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      expect(gateway.operatorModels).toEqual({});
      expect(gateway.operatorDiscovery).toEqual([]);
      expect(discoverOperatorProviders).toHaveBeenCalledTimes(1);
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("seeds the welcome frame from injected operator discovery", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: {
        claude: true,
        codex: false,
        opencode: false,
      },
      lastCheckedAt: "2026-07-28T09:00:00.000Z",
    });
    const discoverOperatorProviders = vi.fn(async () => discovery);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        discoverOperatorProviders,
        initialOperatorDiscovery: discovery,
        initialOperatorDiscoveryFreshness: "fresh",
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "claude",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection();
      await handlers.onOpen!(new Event("open"), wsCtx);
      const welcome = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string })
        .find((frame) => frame.type === "welcome");

      expect(discoverOperatorProviders).toHaveBeenCalled();
      expect(welcome).toMatchObject({
        type: "welcome",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("executes only GUI-authorized setup actions through the gateway callback", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    const setup = {
      projectRoot: "C:/workspace/kiln",
      projectContext: {
        path: "C:/workspace/kiln/.kiln/project-context.md",
        status: "valid" as const,
        recommendation: "none" as const,
      },
      repoShims: [],
      globalInstructionShims: [],
      nativeProjections: [],
      permissionIntegrity: [],
      skillDiagnostics: { state: "current" as const, observedAt: "2026-07-01T00:00:00.000Z" },
      recommendedActions: ["none" as const],
    };
    const executeSetupAction = vi.fn(async (action: KilnConfigSetupAction) => ({
      action,
      status: "applied" as const,
      message: "Repo shims synced.",
      errors: [],
      setup,
    }));
    const getSetupSnapshot = vi.fn(async () => setup);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return {
          port: port ?? 4810,
          stop,
        };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        getSetupSnapshot,
        executeSetupAction,
      });

      const refreshedSetup = await appFetch!(new Request(
        "http://localhost/gui/api/config/setup?refreshSkillDiagnostics=true",
      ));
      expect(refreshedSetup.status).toBe(200);
      expect(getSetupSnapshot).toHaveBeenLastCalledWith({ refreshSkillDiagnostics: true });

      const response = await appFetch!(new Request("http://localhost/gui/api/config/setup/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync-global-instruction-shims" }),
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        action: "sync-global-instruction-shims",
        status: "applied",
      });
      expect(executeSetupAction).toHaveBeenCalledTimes(1);
      expect(executeSetupAction).toHaveBeenCalledWith("sync-global-instruction-shims");

      for (const action of [
        "adopt-or-back-up-global-instructions",
        "review-global-instruction-drift",
        "adopt-or-back-up-native-guidance",
        "review-and-force-sync-repo-shims",
        "review-native-projection-drift",
      ] as const) {
        const blocked = await appFetch!(new Request("http://localhost/gui/api/config/setup/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }));

        expect(blocked.status).toBe(200);
        expect(await blocked.json()).toMatchObject({
          action,
          status: "blocked",
          errors: [`GUI setup action '${action}' is not executable.`],
          setup,
        });
      }
      expect(executeSetupAction).toHaveBeenCalledTimes(1);

      const malformed = await appFetch!(new Request("http://localhost/gui/api/config/setup/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "not-a-setup-action" }),
      }));
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({ error: "invalid_setup_action" });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("keeps onboarding reads secret-free and requires the local operator capability to apply", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    const readiness = {
      schemaVersion: 1 as const,
      status: "ready" as const,
      scope: "project" as const,
      posture: "read-only" as const,
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
    };
    const applyConfigurationOnboarding = vi.fn(async () => ({
      schemaVersion: 1 as const,
      status: "committed" as const,
      projectAdoption: { outcome: "committed" as const, replayed: false, diagnostics: [] },
      targetSelection: null,
      blockers: [],
      nextAction: "Start the first turn.",
    }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return { port: port ?? 4810, stop };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;
    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        workingDirectory: "C:/workspace/kiln",
        getSnapshot: async () => ({}) as never,
        getConfigurationOnboarding: async () => readiness,
        applyConfigurationOnboarding,
      });

      const read = await appFetch!(new Request("http://localhost/gui/api/config/onboarding"));
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(readiness);

      const requestBody = {
        schemaVersion: 1,
        scope: "project",
        posture: "read-only",
        targetId: "codex-terra",
      };
      const missing = await appFetch!(new Request("http://localhost/gui/api/config/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      }));
      expect(missing.status).toBe(403);

      const wrong = await appFetch!(new Request("http://localhost/gui/api/config/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json", "x-kiln-operator-token": "wrong" },
        body: JSON.stringify(requestBody),
      }));
      expect(wrong.status).toBe(403);

      const applied = await appFetch!(new Request("http://localhost/gui/api/config/onboarding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kiln-operator-token": gateway.operatorCapability!,
        },
        body: JSON.stringify(requestBody),
      }));
      expect(applied.status).toBe(200);
      expect(await applied.json()).toMatchObject({ status: "committed" });
      expect(applyConfigurationOnboarding).toHaveBeenCalledTimes(1);
      expect(applyConfigurationOnboarding).toHaveBeenCalledWith(requestBody);
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("reads shared settings and capability-gates proposal and apply mutations", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    const settings = {
      schemaRevision: 3,
      generatedAt: "2026-08-21T00:00:00.000Z",
      health: "current",
      activationStatus: {
        desiredRevisionSetId: `sha256:${"a".repeat(64)}`,
        state: "not-started",
        boundary: null,
        activeRevision: null,
        entries: [],
        summary: "No activation evidence is available.",
      },
      sections: KILN_SETTINGS_SECTION_IDS.map((id) => ({
        id,
        label: id,
        description: `${id} settings`,
        entryKeys: [],
      })),
      entries: [],
      revisions: {},
      modifiedCount: 0,
    } as KilnSettingsSnapshot;
    const proposal = {
      proposalId: "cfg_settings",
      createdAt: "2026-08-21T00:00:00.000Z",
      key: "domain",
      scope: "project",
      operation: "setting.set",
      status: "valid",
      baseRevision: "absent",
      affectedOwners: ["project-configuration"],
      reconciliation: [],
      authorityImpact: "none",
      approvalRequired: false,
      activation: "next-session",
      diagnostics: [],
      rollback: { restorable: true, summary: "Restore the previous value." },
    } as KilnSettingsProposalProjection;
    const result = {
      proposalId: "cfg_settings",
      scope: "project",
      operation: "setting.set",
      outcome: "committed",
      rejectionCode: null,
      committedRevision: `sha256:${"b".repeat(64)}`,
      activation: "next-session",
      activationObservation: {
        state: "scheduled",
        boundary: "next-session",
        committedRevision: `sha256:${"b".repeat(64)}`,
        activeRevision: null,
        summary: "The committed revision activates at the next session boundary.",
      },
      reconciliation: [],
      diagnostics: [],
      replayed: false,
      readBack: { schemaRevision: 1, verified: true },
    } as KilnSettingsMutationResult;
    const proposeSettingsMutation = vi.fn(async (_request: KilnSettingsProposalRequest) => proposal);
    const applySettingsMutation = vi.fn(async (_request: KilnSettingsApplyRequest) => result);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return { port: port ?? 4810, stop };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;
    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        workingDirectory: "C:/workspace/kiln",
        getSnapshot: async () => ({}) as never,
        getSettingsSnapshot: async () => settings,
        proposeSettingsMutation,
        applySettingsMutation,
      });

      const read = await appFetch!(new Request("http://localhost/gui/api/config/settings"));
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(settings);

      const proposalRequest = {
        operation: "setting.set",
        scope: "project",
        key: "domain",
        expectedRevision: "absent",
        value: "backend",
      };
      const deniedProposal = await appFetch!(new Request("http://localhost/gui/api/config/settings/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(proposalRequest),
      }));
      expect(deniedProposal.status).toBe(403);

      const authorizedHeaders = {
        "content-type": "application/json",
        "x-kiln-operator-token": gateway.operatorCapability!,
      };
      const proposed = await appFetch!(new Request("http://localhost/gui/api/config/settings/proposals", {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify(proposalRequest),
      }));
      expect(proposed.status).toBe(200);
      expect(await proposed.json()).toEqual(proposal);
      expect(proposeSettingsMutation).toHaveBeenCalledWith(proposalRequest);

      const applied = await appFetch!(new Request("http://localhost/gui/api/config/settings/apply", {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({ proposalId: "cfg_settings" }),
      }));
      expect(applied.status).toBe(200);
      expect(await applied.json()).toEqual(result);
      expect(applySettingsMutation).toHaveBeenCalledWith({ proposalId: "cfg_settings" });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects resource reads that do not name a committed authority session", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    const resourceProvider: ToolResourceProvider = {
      listResources: () => [{
        uri: "kiln://test/resources/work-1",
        name: "work_item_1",
        title: "Work item 1",
        mimeType: "text/markdown",
      }],
      listTemplates: () => [],
      read: vi.fn(async (uri, options) => ({
        contents: [{
          uri,
          mimeType: "text/markdown",
          text: `# ${options?.cursor ?? "start"}`,
        }],
        nextCursor: "line:125",
      })),
    };
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return {
          port: port ?? 4810,
          stop,
        };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
       getSnapshot: async () => ({ } as never),
      operatorTransport: {
        ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
        builtinToolOptions: {
          resourceProviders: [resourceProvider],
        },
      });

      const response = await appFetch!(new Request("http://localhost/gui/api/resources/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uri: "kiln://test/resources/work-1",
          target: {
            gatewayTargetId: "gateway:local-app",
            instanceId: "local-app:instance",
            sessionId: "session-1",
            resourceUri: "kiln://test/resources/work-1",
          },
          cursor: "line:100",
          limit: 25,
        }),
      }));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "resource_admission_required" });
      expect(resourceProvider.read).not.toHaveBeenCalled();
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("exposes health to the exact bundled GUI origin", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return {
          port: port ?? 4810,
          stop,
        };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
      });

      const response = await appFetch!(new Request("http://127.0.0.1:4810/health", {
        headers: { origin: "http://127.0.0.1:4810" },
      }));

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4810");
      expect(await response.json()).toMatchObject({
        status: "ok",
        channel: "gui",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("clears transport resume state only after durable admission and before fresh dispatch", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const onClear = vi.fn().mockResolvedValue(undefined);
    const exactProvider = {
      name: "openai",
      createMessage: vi.fn(),
    };
    const createProvider = vi.fn(async () => exactProvider);
    let persistedAuthorityBundle: import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle | undefined;
    const persistAuthority = vi.fn(async (bundle: import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle) => {
      persistedAuthorityBundle = bundle;
    });
    const persistCanonicalSessionEvents = vi.fn().mockResolvedValue(undefined);
    const freshRouting = guiTestRouting.create();
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "fresh turn admitted" }],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "fresh-session",
        sessionMode: "mode-a",
        traceId: "trace-fresh",
        ...runtimeCompletedDisposition(),
      },
    } as never);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          operatorTurnDispatcher: freshRouting.operatorTurnDispatcher as never,
          operatorTurnExecutionBridge: freshRouting.operatorTurnExecutionBridge as never,
          operatorAuthorityAdmissionBridge: freshRouting.operatorAuthorityAdmissionBridge as never,
          executionTargetSelection: freshRouting.executionTargetSelection,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
          createProvider: createProvider as never,
          onClear,
          persistCanonicalSessionEvents,
          authorityAdmissionEvidenceStore: {
            persist: persistAuthority,
            loadSessionFacet: async () => undefined,
            readAdmission: async ({ admissionId, sessionId, turnId }) =>
              persistedAuthorityBundle?.admissionId === admissionId
                && persistedAuthorityBundle.sessionId === sessionId
                && persistedAuthorityBundle.turnId === turnId
                ? persistedAuthorityBundle
                : undefined,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await selectGuiTestExecutionTarget(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui", sessionIntent: "fresh" }),
        }),
        wsCtx,
      );

      expect(onClear).toHaveBeenCalledWith();
      expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
        admission: expect.objectContaining({ providerId: "openai", providerModelId: GPT4O }),
        credential: { kind: "test" },
      }));
      expect(createProvider.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(processAdmittedTurn).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
      const persistedBundle = persistAuthority.mock.calls[0]?.[0];
      const persistedAdoption = persistCanonicalSessionEvents.mock.calls[0]?.[0]?.[0];
      expect(persistedBundle?.turnId).toBe(persistedAdoption?.operatorTurnId);
      expect(persistedAdoption?.correlationId).toEqual(expect.any(String));
      expect(persistAuthority.mock.invocationCallOrder[0]).toBeLessThan(
        onClear.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
      expect(onClear.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(processAdmittedTurn).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
      expect(processAdmittedTurn).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: expect.any(String),
      }));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining("fresh turn admitted"));

      onClear.mockRejectedValueOnce(new Error("provider clear failed"));
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "retry fresh gui", sessionIntent: "fresh" }),
        }),
        wsCtx,
      );
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining("provider clear failed"));

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "continue original gui session" }),
        }),
        wsCtx,
      );
      expect(processAdmittedTurn).toHaveBeenCalledTimes(2);
      expect(vi.mocked(processAdmittedTurn).mock.calls[1]?.[0].sessionId).toBe(
        vi.mocked(processAdmittedTurn).mock.calls[0]?.[0].sessionId,
      );
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});

