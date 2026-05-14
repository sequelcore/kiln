import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type {
  GuiBrowserOperatorInput,
} from "@kilnai/gateway-contracts";
import {
  createEmbeddedBrowserOperatorSurface,
} from "./embedded-browser-operator-surface.js";
import {
  createNativeEmbeddedBrowserHost,
  runNativeEmbeddedBrowserHostSmoke,
} from "./embedded-browser-host.js";
import {
  createNativeBrowserHostPolicy,
} from "../shared/native-browser-host.js";
import {
  createNativeBrowserRegionBounds,
} from "../shared/native-browser-operator-surface.js";
import type {
  NativeBrowserRegionBounds,
} from "../shared/native-browser-operator-surface.js";
import {
  createNativeBrowserWindowOptions,
  createNativeSurfaceCapabilitySnapshot,
  createNativeSurfaceTelemetry,
} from "../shared/native-surface.js";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const PRELOAD_ENTRY = join(CURRENT_DIR, "..", "preload", "native-api.js");
const RENDERER_ENTRY = join(CURRENT_DIR, "..", "..", "renderer", "index.html");
const BROWSER_HOST_PROOF_ENTRY = join(CURRENT_DIR, "..", "..", "..", "proof", "browser-host-proof.html");
const SMOKE_MODE = process.argv.includes("--smoke");
const BROWSER_HOST_SMOKE_MODE = process.argv.includes("--browser-host-smoke");
const EMBEDDED_BROWSER_SURFACE_SMOKE_MODE = process.argv.includes("--embedded-browser-surface-smoke");

if (SMOKE_MODE || BROWSER_HOST_SMOKE_MODE || EMBEDDED_BROWSER_SURFACE_SMOKE_MODE) {
  app.setPath("userData", join(tmpdir(), `kiln-native-smoke-${process.pid}`));
}

function isAllowedNavigationUrl(url: string): boolean {
  if (url.startsWith("file://")) return true;
  if (process.env.KILN_NATIVE_DEV_SERVER && url.startsWith(process.env.KILN_NATIVE_DEV_SERVER)) return true;
  return false;
}

async function createWindow(): Promise<BrowserWindow> {
  const startedAtMs = performance.now();
  const window = new BrowserWindow(createNativeBrowserWindowOptions({
    preload: PRELOAD_ENTRY,
  }));
  const embeddedBrowserSurface = createEmbeddedBrowserOperatorSurface({
    parentWindow: window,
    proofFilePath: BROWSER_HOST_PROOF_ENTRY,
    sessionId: "native-embedded-browser",
    kilnSessionId: "native-embedded-browser-session",
  });

  registerNativeBrowserIpc(embeddedBrowserSurface);

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.once("did-finish-load", () => {
    const now = performance.now();
    const telemetry = createNativeSurfaceTelemetry({
      startedAtMs,
      firstPaintAtMs: now,
      frameHandledAtMs: now,
      projectedAtMs: now,
      memoryUsageBytes: process.memoryUsage().rss,
      droppedFrames: 0,
    });

    if (BROWSER_HOST_SMOKE_MODE) {
      void runBrowserHostSmoke(window, telemetry).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Kiln native browser host smoke failed: ${message}\n`);
        window.close();
        app.exit(1);
      });
      return;
    }

    if (EMBEDDED_BROWSER_SURFACE_SMOKE_MODE) {
      void runEmbeddedBrowserSurfaceSmoke(window, embeddedBrowserSurface, telemetry).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Kiln embedded browser surface smoke failed: ${message}\n`);
        embeddedBrowserSurface.close();
        window.close();
        app.exit(1);
      });
      return;
    }

    if (SMOKE_MODE) {
      const capabilities = createNativeSurfaceCapabilitySnapshot({
        surfaceId: "native:smoke",
        generatedAt: new Date().toISOString(),
      });
      process.stdout.write(JSON.stringify({
        ok: true,
        surface: capabilities.surface,
        capabilities: capabilities.capabilities.map((entry) => entry.capability),
        telemetry,
      }) + "\n");
      window.close();
      app.quit();
    }
  });

  window.on("closed", () => {
    embeddedBrowserSurface.close();
    clearNativeBrowserIpc();
  });

  await window.loadURL(pathToFileURL(RENDERER_ENTRY).toString());
  return window;
}

function registerNativeBrowserIpc(
  surface: ReturnType<typeof createEmbeddedBrowserOperatorSurface>,
): void {
  clearNativeBrowserIpc();
  ipcMain.handle("native-browser:open", async (_event, bounds: NativeBrowserRegionBounds) => {
    return surface.open(bounds);
  });
  ipcMain.handle("native-browser:resize", async (_event, bounds: NativeBrowserRegionBounds) => {
    return surface.resize(bounds);
  });
  ipcMain.handle("native-browser:takeover", async () => {
    return surface.takeover();
  });
  ipcMain.handle("native-browser:input", async (_event, input: GuiBrowserOperatorInput) => {
    return surface.dispatchOperatorInput(input);
  });
  ipcMain.handle("native-browser:release", async () => {
    return surface.release();
  });
  ipcMain.handle("native-browser:runtime-resume", async () => {
    return surface.dispatchRuntimeResume();
  });
}

function clearNativeBrowserIpc(): void {
  for (const channel of [
    "native-browser:open",
    "native-browser:resize",
    "native-browser:takeover",
    "native-browser:input",
    "native-browser:release",
    "native-browser:runtime-resume",
  ]) {
    ipcMain.removeHandler(channel);
  }
}

async function runBrowserHostSmoke(
  window: BrowserWindow,
  telemetry: ReturnType<typeof createNativeSurfaceTelemetry>,
): Promise<void> {
  const proofUrl = pathToFileURL(BROWSER_HOST_PROOF_ENTRY).toString();
  const host = createNativeEmbeddedBrowserHost({
    parentWindow: window,
    sessionId: "native-browser-host-smoke",
    kilnSessionId: "native-browser-host-smoke-session",
    bounds: {
      x: 32,
      y: 120,
      width: 960,
      height: 560,
    },
    policy: createNativeBrowserHostPolicy({
      allowedUrls: [proofUrl],
    }),
  });

  try {
    const hostProof = await runNativeEmbeddedBrowserHostSmoke(host, proofUrl);
    process.stdout.write(JSON.stringify({
      ...hostProof,
      telemetry,
    }) + "\n");
  } finally {
    host.close();
    window.close();
    app.quit();
  }
}

async function runEmbeddedBrowserSurfaceSmoke(
  window: BrowserWindow,
  surface: ReturnType<typeof createEmbeddedBrowserOperatorSurface>,
  telemetry: ReturnType<typeof createNativeSurfaceTelemetry>,
): Promise<void> {
  const bounds = createNativeBrowserRegionBounds({
    windowWidth: 1280,
    windowHeight: 820,
  });
  await surface.open(bounds);
  await surface.takeover();
  await surface.dispatchOperatorInput({
    kind: "pointer",
    phase: "click",
    x: 48,
    y: 48,
    button: "left",
  });
  await surface.dispatchOperatorInput({
    kind: "text",
    text: "kiln",
  });
  await surface.dispatchOperatorInput({
    kind: "wheel",
    x: 500,
    y: 500,
    deltaX: 0,
    deltaY: 480,
  });
  await surface.release();
  const finalSnapshot = await surface.dispatchRuntimeResume();
  const evidenceActions = finalSnapshot.evidence.map((event) => {
    const payload = event.payload;
    return typeof payload === "object" && payload !== null && "action" in payload
      ? (payload as { readonly action?: unknown }).action
      : undefined;
  });

  if (finalSnapshot.observation.proofInputValue !== "kiln!") {
    throw new Error("Embedded browser surface smoke failed to resume runtime dispatch.");
  }
  if (finalSnapshot.state.ownership !== "agent") {
    throw new Error("Embedded browser surface smoke did not return ownership to agent.");
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    surface: "native",
    surfaceMode: finalSnapshot.projection.surfaceMode,
    hostTransport: finalSnapshot.projection.transport,
    ownership: finalSnapshot.state.ownership,
    proofInputValue: finalSnapshot.observation.proofInputValue,
    scrollY: finalSnapshot.observation.scrollY,
    evidenceActions,
    sessionState: finalSnapshot.state,
    telemetry,
  }) + "\n");
  surface.close();
  window.close();
  app.quit();
}

app.whenReady()
  .then(async () => {
    await createWindow();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Kiln native startup failed: ${message}\n`);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
