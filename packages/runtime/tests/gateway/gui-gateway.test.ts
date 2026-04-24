import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountGuiStaticAssetsIfPresent } from "../../src/gateway/gui-static-assets.js";
import { buildGuiOperatorModels } from "../../src/gateway/gui-provider-models.js";

function createGuiDist(): string {
  const distDir = mkdtempSync(join(tmpdir(), "gui-gateway-dist-"));
  mkdirSync(join(distDir, "assets"), { recursive: true });
  writeFileSync(
    join(distDir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/gui/assets/app.js\"></script></head><body><div id=\"app\">GUI Test Build</div></body></html>",
    "utf-8",
  );
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
      expect(routeHtml).toContain("/gui/assets/app.js");

      const assetResponse = await app.request("http://localhost/gui/assets/app.js");
      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toContain("asset-ok");
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

describe("buildGuiOperatorModels", () => {
  it("includes codex-oauth subscription models for the GUI welcome payload", () => {
    const models = buildGuiOperatorModels({
      opencodeModels: ["openai/gpt-5.4-mini"],
      codexModels: ["gpt-5.4", "gpt-5.4-mini"],
      opencodeTier: null,
    });

    expect(models["codex-oauth"]).toEqual([
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
    ]);
    expect(models.codex).toEqual(["gpt-5.4", "gpt-5.4-mini"]);
    expect(models.opencode).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("adds opencode-go key when tier is 'go'", () => {
    const models = buildGuiOperatorModels({
      opencodeModels: [],
      codexModels: [],
      opencodeTier: "go",
    });
    expect(models["opencode-go"]).toBeDefined();
    expect(models["opencode-go"]?.length).toBeGreaterThan(0);
    expect(models["opencode-go"]).toContain("minimax-m2.5");
    expect(models["opencode-zen"]).toBeUndefined();
  });

  it("adds opencode-zen key when tier is 'zen'", () => {
    const models = buildGuiOperatorModels({
      opencodeModels: [],
      codexModels: [],
      opencodeTier: "zen",
    });
    expect(models["opencode-zen"]).toBeDefined();
    expect(models["opencode-zen"]?.length).toBeGreaterThan(0);
    expect(models["opencode-zen"]).toContain("anthropic/claude-sonnet-4-6");
    expect(models["opencode-go"]).toBeUndefined();
  });
});
