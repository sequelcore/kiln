import { app, BrowserWindow } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  createNativeBrowserWindowOptions,
  createNativeSurfaceCapabilitySnapshot,
  createNativeSurfaceTelemetry,
} from "../shared/native-surface.js";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const RENDERER_ENTRY = join(CURRENT_DIR, "..", "..", "renderer", "index.html");
const SMOKE_MODE = process.argv.includes("--smoke");

function isAllowedNavigationUrl(url: string): boolean {
  if (url.startsWith("file://")) return true;
  if (process.env.KILN_NATIVE_DEV_SERVER && url.startsWith(process.env.KILN_NATIVE_DEV_SERVER)) return true;
  return false;
}

async function createWindow(): Promise<BrowserWindow> {
  const startedAtMs = performance.now();
  const window = new BrowserWindow(createNativeBrowserWindowOptions());

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

  await window.loadURL(pathToFileURL(RENDERER_ENTRY).toString());
  return window;
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
