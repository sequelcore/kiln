import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createNativeBrowserWindowOptions,
  createNativeSurfaceCapabilitySnapshot,
  createNativeSurfaceProjection,
  createNativeSurfaceTelemetry,
} from "../src/shared/native-surface.js";

describe("native operator surface foundation", () => {
  it("advertises native capability slots without claiming embedded browser support", () => {
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
      status: "unsupported",
      reason: "Roadmap 03 owns the embedded browser host proof.",
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
});
