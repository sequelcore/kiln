import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createNativeBrowserWindowOptions,
  createNativeSurfaceCapabilitySnapshot,
  createNativeSurfaceProjection,
  createNativeSurfaceTelemetry,
} from "../src/shared/native-surface.js";
import {
  createNativeBrowserHostEvidenceEvent,
  createNativeBrowserHostPolicy,
  createNativeBrowserHostSessionState,
  createNativeEmbeddedBrowserHostOptions,
  isNativeBrowserHostNavigationAllowed,
  nativeBrowserHostOperatorInputAllowed,
  nativeBrowserHostRuntimeActionAllowed,
} from "../src/shared/native-browser-host.js";
import {
  createNativeBrowserOperatorSurfaceProjection,
  createNativeBrowserRegionBounds,
  nativeBrowserOperatorActionAllowed,
} from "../src/shared/native-browser-operator-surface.js";

describe("native operator surface foundation", () => {
  it("advertises native capability slots including the proven embedded browser host", () => {
    const snapshot = createNativeSurfaceCapabilitySnapshot({
      surfaceId: "native:local",
      generatedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(snapshot.surface).toBe("native");
    expect(snapshot.capabilities).toContainEqual({
      capability: "gateway-attach",
      status: "available",
    });
    expect(snapshot.capabilities).toContainEqual({
      capability: "native-window-lifecycle",
      status: "available",
    });
    expect(snapshot.capabilities).toContainEqual({
      capability: "embedded-browser-host",
      status: "available",
      reason: "Electron WebContentsView host proof is available behind the native host adapter.",
    });
  });

  it("uses hardened browser window options for renderer isolation", () => {
    const options = createNativeBrowserWindowOptions();

    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.webSecurity).toBe(true);
    expect(options.webPreferences?.preload).toBeUndefined();
  });

  it("projects session and authority state from gateway-contract event data", () => {
    const projection = createNativeSurfaceProjection({
      connected: true,
      gatewayUrl: "http://localhost:4810",
      sessionId: "session-1",
      authority: "audited",
      providerRoute: "codex-oauth/gpt-5.4",
      theme: "kiln-dark",
      latestEvent: {
        eventId: "session-1:1",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-05-14T12:00:00.000Z",
        kind: "session_started",
        source: {
          actor: "runtime",
          surface: "native",
          component: "native-smoke",
        },
        payload: {
          prompt: "do not render raw prompt text as runtime truth",
        },
      },
    });

    expect(projection.sessionId).toBe("session-1");
    expect(projection.authority).toBe("audited");
    expect(projection.providerRoute).toBe("codex-oauth/gpt-5.4");
    expect(projection.latestEvent?.title).toBe("Session Started");
    expect(projection.latestEvent?.payload).toBeUndefined();
  });

  it("records performance telemetry without reading runtime-owned config", () => {
    const telemetry = createNativeSurfaceTelemetry({
      startedAtMs: 100,
      firstPaintAtMs: 128,
      frameHandledAtMs: 142,
      projectedAtMs: 151,
      memoryUsageBytes: 512_000,
      droppedFrames: 0,
    });

    expect(telemetry.firstPaintMs).toBe(28);
    expect(telemetry.frameHandlingMs).toBe(42);
    expect(telemetry.projectionUpdateMs).toBe(51);
    expect(telemetry.memoryUsageBytes).toBe(512_000);
  });

  it("does not depend on core or runtime implementation packages", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["@kilnai/core"]).toBeUndefined();
    expect(packageJson.dependencies?.["@kilnai/runtime"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@kilnai/core"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@kilnai/runtime"]).toBeUndefined();
  });

  it("configures the embedded browser host with isolated ephemeral security defaults", () => {
    const options = createNativeEmbeddedBrowserHostOptions({
      sessionId: "browser-1",
    });

    expect(options.transport).toBe("electron-webcontents");
    expect(options.webPreferences.nodeIntegration).toBe(false);
    expect(options.webPreferences.contextIsolation).toBe(true);
    expect(options.webPreferences.sandbox).toBe(true);
    expect(options.webPreferences.webSecurity).toBe(true);
    expect(options.webPreferences.allowRunningInsecureContent).toBe(false);
    expect(options.webPreferences.preload).toBeUndefined();
    expect(options.webPreferences.partition).toBe("kiln-embedded-browser-host:browser-1");
    expect(options.webPreferences.partition.startsWith("persist:")).toBe(false);
  });

  it("fails closed for unapproved embedded browser navigation", () => {
    const policy = createNativeBrowserHostPolicy({
      allowedUrls: ["file:///C:/Proyectos/Sequel/kiln/packages/native/proof/browser-host-proof.html"],
    });

    expect(isNativeBrowserHostNavigationAllowed(
      "file:///C:/Proyectos/Sequel/kiln/packages/native/proof/browser-host-proof.html",
      policy,
    )).toBe(true);
    expect(isNativeBrowserHostNavigationAllowed("https://example.com", policy)).toBe(false);
    expect(isNativeBrowserHostNavigationAllowed("javascript:alert(1)", policy)).toBe(false);
  });

  it("projects embedded browser host state and evidence through gateway-shaped data", () => {
    const state = createNativeBrowserHostSessionState({
      sessionId: "browser-1",
      kilnSessionId: "session-1",
      url: "file:///proof.html",
      title: "Kiln Browser Host Proof",
      updatedAt: "2026-05-14T12:00:00.000Z",
      viewport: {
        width: 1024,
        height: 640,
      },
      ownership: "operator",
    });
    const event = createNativeBrowserHostEvidenceEvent({
      eventId: "session-1:browser-host:1",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: "2026-05-14T12:00:00.000Z",
      sessionId: "browser-1",
      action: "operator_input",
      url: "file:///proof.html",
      title: "Kiln Browser Host Proof",
      input: {
        kind: "text",
        textLength: 5,
      },
      acknowledgement: {
        status: "accepted",
      },
    });

    expect(state.latestCapture?.transport).toBe("electron-webcontents");
    expect(state.stream.status).toBe("live");
    expect(event.kind).toBe("browser_operator_evidence");
    expect(event.source.surface).toBe("native");
    expect(event.payload).toMatchObject({
      hostTransport: "electron-webcontents",
      browserSessionId: "browser-1",
      input: {
        kind: "text",
        textLength: 5,
      },
    });
    expect(JSON.stringify(event.payload)).not.toContain("typed secret");
  });

  it("keeps runtime dispatch and operator input mutually gated by ownership", () => {
    expect(nativeBrowserHostRuntimeActionAllowed({ ownership: "agent" })).toBe(true);
    expect(nativeBrowserHostRuntimeActionAllowed({ ownership: "operator" })).toBe(false);
    expect(nativeBrowserHostOperatorInputAllowed({ ownership: "operator" })).toBe(true);
    expect(nativeBrowserHostOperatorInputAllowed({ ownership: "agent" })).toBe(false);
    expect(nativeBrowserHostOperatorInputAllowed({ ownership: "released" })).toBe(false);
  });

  it("reserves a stable embedded browser region for the native operator surface", () => {
    const bounds = createNativeBrowserRegionBounds({
      windowWidth: 1280,
      windowHeight: 820,
    });

    expect(bounds).toEqual({
      x: 24,
      y: 232,
      width: 828,
      height: 572,
    });
  });

  it("projects embedded browser operator surface state without owning runtime truth", () => {
    const state = createNativeBrowserHostSessionState({
      sessionId: "browser-1",
      kilnSessionId: "session-1",
      url: "file:///proof.html",
      title: "Kiln Browser Host Proof",
      updatedAt: "2026-05-14T12:00:00.000Z",
      viewport: {
        width: 820,
        height: 548,
      },
      ownership: "agent",
    });
    const projection = createNativeBrowserOperatorSurfaceProjection({
      state,
      evidenceCount: 4,
      lastEvidenceAction: "runtime_dispatch",
      lastObservation: {
        url: "file:///proof.html",
        title: "Kiln Browser Host Proof",
        proofInputValue: "kiln!",
        scrollY: 480,
      },
    });

    expect(projection.surfaceMode).toBe("embedded-browser");
    expect(projection.transport).toBe("electron-webcontents");
    expect(projection.ownership).toBe("agent");
    expect(projection.operatorCanInput).toBe(false);
    expect(projection.runtimeCanDispatch).toBe(true);
    expect(projection.evidenceCount).toBe(4);
    expect(projection.lastEvidenceAction).toBe("runtime_dispatch");
    expect(projection.lastObservation?.proofInputValue).toBe("kiln!");
  });

  it("admits embedded browser operator actions only for the correct ownership state", () => {
    expect(nativeBrowserOperatorActionAllowed({
      action: "takeover",
      ownership: "agent",
    })).toBe(true);
    expect(nativeBrowserOperatorActionAllowed({
      action: "operator_input",
      ownership: "operator",
    })).toBe(true);
    expect(nativeBrowserOperatorActionAllowed({
      action: "release",
      ownership: "operator",
    })).toBe(true);
    expect(nativeBrowserOperatorActionAllowed({
      action: "runtime_dispatch",
      ownership: "agent",
    })).toBe(true);
    expect(nativeBrowserOperatorActionAllowed({
      action: "operator_input",
      ownership: "agent",
    })).toBe(false);
  });
});
