import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import axe from "axe-core";
import { build } from "esbuild";
import { chromium } from "playwright";

const workspace = "/workspace";
const outputRoot = "/output";
const benchmarkCase = process.env.KILN_BENCHMARK_CASE;
const verifierNodeModules = resolve("node_modules");
const allowedSourcePaths = new Set([
  resolve(workspace, "src/main.jsx"),
  resolve(workspace, "src/Challenge.jsx"),
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
        const candidate = args.kind === "entry-point" ? resolve(args.path) : resolve(args.resolveDir, args.path);
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

await new Promise((ready, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", ready);
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
  const assertions = await runCase(page, benchmarkCase);
  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(async () => globalThis.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  }));
  const screenshot = await page.screenshot({ type: "png", fullPage: true });
  const report = {
    status: accessibility.violations.length === 0 ? "passed" : "failed",
    benchmarkCaseId: benchmarkCase,
    browserVersion: browser.version(),
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
    assertions,
    accessibility: {
      engine: "axe-core",
      version: axe.version,
      tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      violationCount: accessibility.violations.length,
      violations: accessibility.violations.map(({ id, impact, help, nodes }) => ({
        id, impact, help, targets: nodes.flatMap((node) => node.target),
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
  await new Promise((closed) => server.close(closed));
}

async function runCase(page, id) {
  switch (id) {
    case "modal-focus": return verifyModal(page);
    case "tabs-keyboard": return verifyTabs(page);
    case "form-errors": return verifyForm(page);
    case "disclosure": return verifyDisclosure(page);
    case "sortable-table": return verifySortableTable(page);
    case "menu-button": return verifyMenu(page);
    case "live-status": return verifyLiveStatus(page);
    case "pagination": return verifyPagination(page);
    default: throw new Error("Unknown or missing frontend benchmark case.");
  }
}

async function verifyModal(page) {
  await page.getByRole("heading", { name: "Order queue", level: 1 }).waitFor();
  const trigger = page.getByRole("button", { name: "Review order A-104" });
  await expectNativeButton(trigger, "Review trigger");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Review order A-104" });
  const confirm = dialog.getByRole("button", { name: "Confirm review" });
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expectActive(confirm, "Dialog initial focus");
  await page.keyboard.press("Tab"); await expectActive(cancel, "Dialog Tab cycle");
  await page.keyboard.press("Tab"); await expectActive(confirm, "Dialog Tab wrap");
  await page.keyboard.press("Shift+Tab"); await expectActive(cancel, "Dialog Shift+Tab wrap");
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  await expectActive(trigger, "Dialog focus restoration");
  await page.keyboard.press("Space"); await expectActive(confirm, "Space activation focus");
  await page.keyboard.press("Escape"); await expectActive(trigger, "Space activation focus restoration");
  return { heading: true, keyboardActivation: true, spaceActivation: true, dialogName: true, initialFocus: true, focusTrap: true, escapeCloses: true, focusRestored: true };
}

async function verifyTabs(page) {
  await page.getByRole("heading", { name: "Account settings", level: 1 }).waitFor();
  const profile = page.getByRole("tab", { name: "Profile" });
  const security = page.getByRole("tab", { name: "Security" });
  const billing = page.getByRole("tab", { name: "Billing" });
  await expectAttribute(profile, "aria-selected", "true");
  await profile.focus(); await page.keyboard.press("ArrowRight"); await expectActive(security, "ArrowRight focus");
  await expectAttribute(security, "aria-selected", "true");
  await expectSingleVisiblePanel(page, "Security");
  await page.keyboard.press("Home"); await expectActive(profile, "Home focus");
  await expectSingleVisiblePanel(page, "Profile");
  await page.keyboard.press("End"); await expectActive(billing, "End focus");
  await page.keyboard.press("ArrowRight"); await expectActive(profile, "ArrowRight wrap");
  await page.keyboard.press("ArrowLeft"); await expectActive(billing, "ArrowLeft wrap");
  await expectSingleVisiblePanel(page, "Billing");
  return { heading: true, selectedState: true, arrowNavigation: true, homeEndNavigation: true, panelRelationship: true };
}

async function verifyForm(page) {
  await page.getByRole("heading", { name: "Invite teammate", level: 1 }).waitFor();
  const email = page.getByRole("textbox", { name: "Email address" });
  const submit = page.getByRole("button", { name: "Send invitation" });
  await expectNativeElement(email, "INPUT", "Email input"); await expectNativeButton(submit, "Invitation submit");
  await submit.click();
  await page.getByRole("alert").getByText(/Enter a valid email address/i).waitFor();
  await expectAttribute(email, "aria-invalid", "true"); await expectActive(email, "Invalid input focus");
  const describedBy = await email.getAttribute("aria-describedby");
  if (!describedBy || !(await page.locator(`#${describedBy}`).isVisible())) throw new Error("Validation message is not associated with the input.");
  await email.fill("not-an-email"); await submit.click();
  await page.getByRole("alert").getByText(/Enter a valid email address/i).waitFor();
  await email.fill("ada@example.com"); await submit.click();
  await page.getByRole("status").getByText(/Invitation sent/i).waitFor();
  if (await email.inputValue() !== "") throw new Error("Successful form did not clear the email input.");
  return { heading: true, errorAlert: true, invalidState: true, errorAssociation: true, errorFocus: true, successStatus: true };
}

async function verifyDisclosure(page) {
  await page.getByRole("heading", { name: "Deployment details", level: 1 }).waitFor();
  const button = page.getByRole("button", { name: "Show environment details" });
  await expectNativeButton(button, "Disclosure trigger");
  await expectAttribute(button, "aria-expanded", "false");
  const region = page.getByRole("region", { name: "Environment details" });
  if (await region.isVisible()) throw new Error("Disclosure region starts visible.");
  await button.click(); await expectAttribute(button, "aria-expanded", "true");
  await region.getByText("Region: us-west-2", { exact: true }).waitFor();
  await button.click(); if (await region.isVisible()) throw new Error("Disclosure did not close.");
  return { heading: true, nativeButton: true, expandedState: true, controlledRegion: true, toggles: true };
}

async function verifySortableTable(page) {
  await page.getByRole("heading", { name: "Build history", level: 1 }).waitFor();
  const table = page.getByRole("table", { name: "Recent builds" });
  const header = table.getByRole("columnheader", { name: /Build/ });
  const button = header.getByRole("button", { name: "Build" });
  await expectNativeButton(button, "Sort trigger");
  await button.click(); await expectAttribute(header, "aria-sort", "ascending");
  await expectColumn(table, ["B-1", "B-2", "B-3"]);
  await button.click(); await expectAttribute(header, "aria-sort", "descending");
  await expectColumn(table, ["B-3", "B-2", "B-1"]);
  return { heading: true, tableName: true, nativeSortButton: true, ascendingSort: true, descendingSort: true, ariaSort: true };
}

async function verifyMenu(page) {
  await page.getByRole("heading", { name: "Project actions", level: 1 }).waitFor();
  const trigger = page.getByRole("button", { name: "More actions" });
  await expectNativeButton(trigger, "Menu trigger");
  await expectAttribute(trigger, "aria-expanded", "false"); await trigger.focus(); await page.keyboard.press("Enter");
  await expectAttribute(trigger, "aria-expanded", "true");
  const rename = page.getByRole("menuitem", { name: "Rename" });
  const archive = page.getByRole("menuitem", { name: "Archive" });
  await expectActive(rename, "Menu initial focus");
  await page.keyboard.press("ArrowDown"); await expectActive(archive, "Menu ArrowDown");
  await page.keyboard.press("ArrowDown"); await expectActive(rename, "Menu ArrowDown wrap");
  await page.keyboard.press("ArrowUp"); await expectActive(archive, "Menu ArrowUp wrap");
  await page.keyboard.press("Escape"); await expectActive(trigger, "Menu focus restoration");
  await expectAttribute(trigger, "aria-expanded", "false");
  if (await page.getByRole("menu").isVisible()) throw new Error("Menu remained visible after Escape.");
  return { heading: true, expandedState: true, initialFocus: true, arrowNavigation: true, wrapping: true, escapeCloses: true, focusRestored: true };
}

async function verifyLiveStatus(page) {
  await page.getByRole("heading", { name: "Sync status", level: 1 }).waitFor();
  const status = page.getByRole("status");
  const button = page.getByRole("button", { name: "Sync now" });
  await status.evaluate((element) => {
    const button = element.closest("main")?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Sync button was not found beside the status region.");
    const transitions = [];
    window.__kilnStatusTransitions = transitions;
    const capture = () => transitions.push({ text: element.textContent ?? "", disabled: button.disabled });
    capture();
    const observer = new MutationObserver(capture);
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
  });
  await button.click();
  await status.getByText("Sync complete", { exact: true }).waitFor();
  const transitions = await page.evaluate(() => window.__kilnStatusTransitions ?? []);
  if (!transitions.some((entry) => entry.text === "Syncing" && entry.disabled)) {
    throw new Error("Syncing was not announced while the button was disabled.");
  }
  if (!transitions.some((entry) => entry.text === "Sync complete")) throw new Error("Sync completion was not observed.");
  if (await button.isDisabled()) throw new Error("Sync button was not re-enabled.");
  if (await status.getAttribute("role") === "alert") throw new Error("Status incorrectly uses alert semantics.");
  return { heading: true, persistentStatus: true, pendingAnnouncement: true, pendingDisabled: true, completionAnnouncement: true, reenabled: true };
}

async function verifyPagination(page) {
  const heading = page.getByRole("heading", { name: "Audit events", level: 1 });
  await heading.waitFor();
  const nav = page.getByRole("navigation", { name: "Audit pagination" });
  const previous = nav.getByRole("button", { name: "Previous" });
  const next = nav.getByRole("button", { name: "Next" });
  if (!(await previous.isDisabled()) || await next.isDisabled()) throw new Error("Initial pagination bounds are incorrect.");
  await nav.getByText("Page 1 of 3", { exact: true }).waitFor(); await next.click();
  await nav.getByText("Page 2 of 3", { exact: true }).waitFor(); await expectActive(heading, "Heading focus after next");
  await next.click(); await nav.getByText("Page 3 of 3", { exact: true }).waitFor();
  if (!(await next.isDisabled())) throw new Error("Next is not disabled on the final page.");
  await previous.click(); await nav.getByText("Page 2 of 3", { exact: true }).waitFor(); await expectActive(heading, "Heading focus after previous");
  return { heading: true, navigationName: true, initialBounds: true, pageUpdates: true, finalBounds: true, focusAfterUpdate: true };
}

async function expectActive(locator, label) {
  if (!(await locator.evaluate((element) => element === document.activeElement))) throw new Error(`${label} failed.`);
}

async function expectNativeButton(locator, label) {
  await expectNativeElement(locator, "BUTTON", label);
}

async function expectNativeElement(locator, tagName, label) {
  const actual = await locator.evaluate((element) => element.tagName);
  if (actual !== tagName) throw new Error(`${label} must be a native ${tagName.toLowerCase()} element.`);
}

async function expectSingleVisiblePanel(page, name) {
  await page.getByRole("tabpanel", { name }).waitFor();
  if (await page.locator('[role="tabpanel"]:visible').count() !== 1) {
    throw new Error("Exactly one tabpanel must be visible.");
  }
}

async function expectAttribute(locator, name, expected) {
  const actual = await locator.getAttribute(name);
  if (actual !== expected) throw new Error(`${name} was '${actual}', expected '${expected}'.`);
}

async function expectColumn(table, expected) {
  const rows = table.getByRole("row");
  const actual = [];
  for (let index = 1; index < await rows.count(); index += 1) {
    actual.push((await rows.nth(index).getByRole("cell").first().textContent())?.trim());
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Build order was ${JSON.stringify(actual)}.`);
}

function send(response, contentType, body) {
  response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}
