import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountGuiStaticAssetsIfPresent } from "../../src/gateway/gui-static-assets.js";

function createGuiDist(): string {
  const distDir = mkdtempSync(join(tmpdir(), "gui-gateway-dist-"));
  mkdirSync(join(distDir, "assets"), { recursive: true });
  writeFileSync(join(distDir, "index.html"), "<!doctype html><html><body><div id=\"app\">GUI Test Build</div></body></html>", "utf-8");
  writeFileSync(join(distDir, "assets", "app.js"), "console.log('asset-ok');", "utf-8");
  return distDir;
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gui-gateway-empty-"));
}

describe("startGuiGateway static mount", () => {
  it("serves /gui/index.html and falls back to index.html for unknown /gui routes", async () => {
    const distDir = createGuiDist();
    const app = new Hono();
    app.get("/gui", (c) => c.redirect("/gui/"));
    const mounted = mountGuiStaticAssetsIfPresent(app, distDir);

    try {
      expect(mounted).toBe(true);

      const indexResponse = await app.request("http://localhost/gui/index.html");
      expect(indexResponse.status).toBe(200);
      const indexHtml = await indexResponse.text();
      expect(indexHtml).toContain("GUI Test Build");

      const routeResponse = await app.request("http://localhost/gui/sessions/alpha");
      expect(routeResponse.status).toBe(200);
      const routeHtml = await routeResponse.text();
      expect(routeHtml).toContain("GUI Test Build");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("skips the /gui mount when dist index.html is missing", async () => {
    const distDir = createTempDir();
    const app = new Hono();
    app.get("/gui", (c) => c.redirect("/gui/"));
    const mounted = mountGuiStaticAssetsIfPresent(app, distDir);

    try {
      expect(mounted).toBe(false);

      const response = await app.request("http://localhost/gui/index.html");
      expect(response.status).toBe(404);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});
