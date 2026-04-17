import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function mountGuiStaticAssets(app: Hono, guiDistPath: string): void {
  const indexHtmlPath = join(guiDistPath, "index.html");
  const indexHtml = readFileSync(indexHtmlPath, "utf-8");

  app.use("/gui/*", async (c, next) => {
    const requestPath = c.req.path;
    if (requestPath === "/gui/api" || requestPath.startsWith("/gui/api/") || requestPath === "/gui/ws") {
      return next();
    }

    const assetPath = resolveGuiAssetPath(guiDistPath, requestPath);
    if (assetPath && existsSync(assetPath) && statSync(assetPath).isFile()) {
      const extension = extname(assetPath).toLowerCase();
      const contentType = CONTENT_TYPES[extension];
      const assetBuffer = readFileSync(assetPath);
      if (contentType) {
        return c.body(assetBuffer, 200, { "Content-Type": contentType });
      }
      return c.body(assetBuffer);
    }

    return c.html(indexHtml);
  });
}

export function mountGuiStaticAssetsIfPresent(app: Hono, guiDistPath: string | undefined): boolean {
  if (!guiDistPath) {
    return false;
  }
  if (!existsSync(join(guiDistPath, "index.html"))) {
    return false;
  }
  mountGuiStaticAssets(app, guiDistPath);
  return true;
}

export function resolveGuiDistPath(configuredPath?: string, moduleUrl: string = import.meta.url): string | undefined {
  const candidates = resolveGuiDistCandidates(configuredPath, moduleUrl);
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveGuiDistCandidates(configuredPath?: string, moduleUrl: string = import.meta.url): readonly string[] {
  if (configuredPath) {
    return [resolve(configuredPath)];
  }
  const runtimePackageRoot = resolve(dirname(fileURLToPath(moduleUrl)), "..", "..");
  return [resolve(runtimePackageRoot, "..", "gui", "dist")];
}

function resolveGuiAssetPath(guiDistPath: string, requestPath: string): string | undefined {
  const stripped = requestPath.replace(/^\/gui\/?/, "");
  const segments = stripped.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }

  const rawAssetPath = segments.length === 0
    ? join(guiDistPath, "index.html")
    : join(guiDistPath, ...segments);

  const resolvedDistPath = resolve(guiDistPath);
  const resolvedAssetPath = resolve(rawAssetPath);
  const normalizedDistPrefix = `${resolvedDistPath}${resolvedDistPath.endsWith(sep) ? "" : sep}`;
  const isInsideDist = resolvedAssetPath === resolvedDistPath || resolvedAssetPath.startsWith(normalizedDistPrefix);

  return isInsideDist ? resolvedAssetPath : undefined;
}
