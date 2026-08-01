import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import axe from "axe-core";
import { build } from "esbuild";
import { chromium } from "playwright";

const workspace = "/workspace";
const outputRoot = "/output";
const verifierNodeModules = resolve("node_modules");
const allowedSourcePaths = new Set([
  resolve(workspace, "src/main.jsx"),
  resolve(workspace, "src/OrderQueue.jsx"),
]);
const packageEntrypoints = new Map([
  ["react", resolve("node_modules/react/index.js")],
  ["react/jsx-runtime", resolve("node_modules/react/jsx-runtime.js")],
  ["react-dom/client", resolve("node_modules/react-dom/client.js")],
]);

await build({
  entryPoints: [resolve(workspace, "src/main.jsx")],
  outfile: join(outputRoot, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  minify: false,
  sourcemap: false,
  logLevel: "silent",
  plugins: [{
    name: "closed-import-surface",
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (args.importer.startsWith(`${verifierNodeModules}/`)) return undefined;
        const packageEntry = packageEntrypoints.get(args.path);
        if (packageEntry) return { path: packageEntry };
        const candidate = args.kind === "entry-point"
          ? resolve(args.path)
          : resolve(args.resolveDir, args.path);
        const withExtension = candidate.endsWith(".jsx") ? candidate : `${candidate}.jsx`;
        if (allowedSourcePaths.has(candidate)) return { path: candidate };
        if (allowedSourcePaths.has(withExtension)) return { path: withExtension };
        return { errors: [{ text: `Import outside the closed frontend fixture: ${args.path}` }] };
      });
    },
  }],
});

const html = await readFile(join(workspace, "index.html"), "utf8");
const css = await readFile(join(workspace, "styles.css"), "utf8");
const bundle = await readFile(join(outputRoot, "bundle.js"));
const server = createServer((request, response) => {
  if (request.url === "/") return send(response, "text/html; charset=utf-8", html);
  if (request.url === "/styles.css") return send(response, "text/css; charset=utf-8", css);
  if (request.url === "/bundle.js") return send(response, "text/javascript; charset=utf-8", bundle);
  response.writeHead(404).end("not found");
});

await new Promise((resolveReady, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveReady);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Verifier server did not reserve a loopback port.");
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Order queue", level: 1 }).waitFor();
  await page.getByRole("table", { name: "Pending orders" }).waitFor();
  const trigger = page.getByRole("button", { name: "Review order A-104" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Review order A-104" });
  await dialog.waitFor();
  const confirm = dialog.getByRole("button", { name: "Confirm review" });
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const initialFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (initialFocus !== "Confirm review") throw new Error(`Dialog initial focus was '${initialFocus}'.`);
  await page.keyboard.press("Tab");
  if (!(await cancel.evaluate((element) => element === document.activeElement))) throw new Error("Dialog focus did not advance to Cancel.");
  await page.keyboard.press("Tab");
  if (!(await confirm.evaluate((element) => element === document.activeElement))) throw new Error("Dialog focus escaped instead of cycling.");
  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(async () => globalThis.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  }));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const restoredName = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "");
  if (restoredName !== "Review order A-104") throw new Error(`Focus was not restored to the trigger: '${restoredName}'.`);
  const screenshot = await page.screenshot({ type: "png", fullPage: true });
  const report = {
    status: accessibility.violations.length === 0 ? "passed" : "failed",
    browserVersion: browser.version(),
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
    assertions: {
      heading: true,
      tableAccessibleName: true,
      keyboardActivation: true,
      dialogAccessibleName: true,
      dialogInitialFocus: true,
      dialogFocusTrap: true,
      escapeCloses: true,
      focusRestored: true,
    },
    accessibility: {
      engine: "axe-core",
      version: axe.version,
      tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      violationCount: accessibility.violations.length,
      violations: accessibility.violations.map(({ id, impact, help, nodes }) => ({
        id,
        impact,
        help,
        targets: nodes.flatMap((node) => node.target),
      })),
    },
    screenshot: {
      sha256: `sha256:${createHash("sha256").update(screenshot).digest("hex")}`,
      bytes: screenshot.byteLength,
    },
  };
  await writeFile(join(outputRoot, "report.json"), JSON.stringify(report), "utf8");
  await writeFile(join(outputRoot, "screenshot.png"), screenshot);
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}

function send(response, contentType, body) {
  response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}
