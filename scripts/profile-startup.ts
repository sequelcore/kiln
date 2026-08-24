import { existsSync, rmSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { basename, join, resolve } from "node:path";
import { resolveProjectRoot } from "../packages/cli/src/application/project-root-resolver.js";
import { resolveProjectStateBinding } from "../packages/cli/src/application/project-state-root.js";

type Surface = "gui" | "tui";
type GuiMode = "dev" | "prod";

interface StartupProfileOptions {
  readonly surface: Surface;
  readonly mode: GuiMode;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly port: number;
  readonly guiPort: number;
  readonly provider?: string;
  readonly openBrowser: boolean;
  readonly measureFirstPaint: boolean;
  readonly verbose: boolean;
  readonly clearViteCache: boolean;
}

interface StartupMilestone {
  readonly name: string;
  readonly atMs: number;
  readonly detail?: string;
}

const repoRoot = resolve(import.meta.dir, "..");

const options = parseArgs(process.argv.slice(2));
const projectState = resolveProjectStateBinding(resolveProjectRoot({ cwd: options.cwd }).rootPath);
const startedAt = performance.now();
const milestones: StartupMilestone[] = [];
const phaseMarkers: Array<Record<string, unknown>> = [];
let stdout = "";
let stderr = "";
let viteReadyMs: number | undefined;
let firstUsablePaintMs: number | undefined;
let firstUsableFrameMs: number | undefined;
let browserLaunchMs: number | undefined;
let guiUrlToFirstUsableMs: number | undefined;
let browserResourceSummary: BrowserResourceSummary | undefined;
let profileError: string | undefined;

if (options.clearViteCache) {
  clearGuiViteCache(repoRoot);
}

const command = buildCommand(options);
mark("profile-started", `${command.cmd} ${command.args.join(" ")}`);

const child = Bun.spawn([command.cmd, ...command.args], {
  cwd: repoRoot,
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    KILN_STARTUP_PROFILE: "1",
    NO_COLOR: "1",
  },
});
let childExitCode: number | undefined;
const childExited = child.exited.then((code) => {
  childExitCode = code;
  return code;
});

const deadline = Date.now() + options.timeoutMs;
const stdoutReader = readStream(child.stdout, (chunk) => {
  stdout += chunk;
  const readyMatch = chunk.match(/Dev server:\s+ready in\s+(\d+)\s+ms/i);
  if (readyMatch && !viteReadyMs) {
    viteReadyMs = Number(readyMatch[1]);
    mark("gui-vite-ready", `${viteReadyMs} ms reported by Vite`);
  }
});
const stderrReader = readStream(child.stderr, (chunk) => {
  stderr += chunk;
  collectPhaseMarkers(chunk);
  const readyMatch = chunk.match(/Dev server:\s+ready in\s+(\d+)\s+ms/i);
  if (readyMatch && !viteReadyMs) {
    viteReadyMs = Number(readyMatch[1]);
    mark("gui-vite-ready", `${viteReadyMs} ms reported by Vite`);
  }
});

try {
  try {
    if (options.surface === "gui") {
      await waitForHttpOk(`http://127.0.0.1:${options.port}/health`, "gateway-health-ready");
      await waitForHttpOk(`http://127.0.0.1:${options.port}/gui/api/dashboard`, "gateway-dashboard-ready");
      const guiUrl = options.mode === "dev"
        ? `http://127.0.0.1:${options.guiPort}/gui/`
        : `http://127.0.0.1:${options.port}/gui/`;
      await waitForHttpOk(guiUrl, "gui-url-ready");
      if (options.measureFirstPaint) {
        const browserProbeStartedAt = performance.now();
        const browserProbeStartOffsetMs = Math.round(browserProbeStartedAt - startedAt);
        mark("browser-launch-requested", "headless chromium");
        const browserProbe = await runBrowserProbe(guiUrl);
        browserLaunchMs = browserProbe.browserLaunchMs;
        markAt("browser-ready", browserProbeStartOffsetMs + browserProbe.browserLaunchMs, `${browserLaunchMs} ms`);
        markAt(
          "gui-navigation-committed",
          browserProbeStartOffsetMs + browserProbe.navigationCommittedMs,
          `${browserProbe.navigationCommittedMs} ms after browser probe start`,
        );
        firstUsablePaintMs = browserProbeStartOffsetMs + browserProbe.firstUsableMs;
        guiUrlToFirstUsableMs = browserProbe.firstUsableMs;
        browserResourceSummary = browserProbe.initialResources;
        markAt(
          "gui-first-usable-interaction",
          firstUsablePaintMs,
          `${guiUrlToFirstUsableMs} ms after GUI URL readiness`,
        );
      }
    } else {
      await waitForPhaseMarker("tui-first-frame-rendered");
      firstUsableFrameMs = Math.round(performance.now() - startedAt);
      mark("tui-first-usable-frame");
    }
  } finally {
    if (child.exitCode === null) {
      if (process.platform === "win32") {
        terminateProcessTree(child.pid);
      } else {
        child.kill("SIGINT");
      }
    }
    await Promise.race([
      childExited.catch(() => undefined),
      sleep(2_000).then(() => {
        child.kill("SIGKILL");
      }),
    ]);
    await Promise.allSettled([stdoutReader, stderrReader]);
  }
} catch (error) {
  profileError = error instanceof Error ? error.message : String(error);
}

const endedAt = performance.now();
const result = {
  profileVersion: 1,
  command: {
    surface: options.surface,
    mode: options.mode,
    cwd: redactPath(options.cwd),
    provider: options.provider,
    openBrowser: options.openBrowser,
    measureFirstPaint: options.measureFirstPaint,
    raw: `${command.cmd} ${command.args.join(" ")}`,
  },
  environment: {
    commit: await readCommand(["git", "rev-parse", "HEAD"]),
    os: `${platform()} ${release()} ${arch()}`,
    bun: Bun.version,
    node: process.versions.node,
    vite: await readPackageVersion("packages/gui/package.json", "vite"),
    react: await readPackageVersion("packages/gui/package.json", "react"),
  },
  cache: {
    providerDiscovery: existsSync(join(projectState.cachePath, "provider-discovery.json")) ? "present" : "missing",
    viteDeps: existsSync(join(repoRoot, "packages", "gui", "node_modules", ".vite")) ? "present" : "missing",
    clearViteCache: options.clearViteCache,
  },
  timings: {
    totalMs: Math.round(endedAt - startedAt),
    viteReadyMs,
    firstUsablePaintMs,
    firstUsableFrameMs,
    browserLaunchMs,
    guiUrlToFirstUsableMs,
    browserResourceSummary,
    milestones,
    phaseMarkers,
  },
  output: {
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  },
  ...(profileError ? { error: profileError } : {}),
};

console.log(JSON.stringify(result, null, 2));
if (profileError) {
  process.exitCode = 1;
}

function parseArgs(args: readonly string[]): StartupProfileOptions {
  const surface = readFlag(args, "--surface") ?? "gui";
  if (surface !== "gui" && surface !== "tui") {
    throw new Error("--surface must be gui or tui");
  }
  const mode = readFlag(args, "--mode") ?? "dev";
  if (mode !== "dev" && mode !== "prod") {
    throw new Error("--mode must be dev or prod");
  }
  const cwd = resolve(readFlag(args, "--cwd") ?? repoRoot);
  return {
    surface,
    mode,
    cwd,
    timeoutMs: readNumberFlag(args, "--timeout-ms", 30_000),
    port: readNumberFlag(args, "--port", 4810),
    guiPort: readNumberFlag(args, "--gui-port", 5183),
    provider: readFlag(args, "--provider"),
    openBrowser: args.includes("--open"),
    measureFirstPaint: args.includes("--measure-first-paint"),
    verbose: args.includes("--verbose"),
    clearViteCache: args.includes("--clear-vite-cache"),
  };
}

async function runBrowserProbe(guiUrl: string): Promise<{
  readonly browserLaunchMs: number;
  readonly navigationCommittedMs: number;
  readonly firstUsableMs: number;
  readonly initialResources: BrowserResourceSummary;
}> {
  const probe = Bun.spawn([
    "node",
    join(repoRoot, "scripts", "profile-gui-first-usable.mjs"),
    guiUrl,
    String(remainingTimeoutMs()),
  ], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(probe.stdout).text();
  const stderrPromise = new Response(probe.stderr).text();
  const timedOut = Symbol("browser-probe-timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof timedOut>((resolveTimeout) => {
    timeoutHandle = setTimeout(
      () => resolveTimeout(timedOut),
      remainingTimeoutMs(),
    );
  });
  let exitCode: number | typeof timedOut;
  try {
    exitCode = await Promise.race([probe.exited, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
  if (exitCode === timedOut) {
    terminateProcessTree(probe.pid);
    throw new Error("Timed out waiting for the GUI browser probe");
  }
  const [output, probeError] = await Promise.all([stdoutPromise, stderrPromise]);
  const browserProbeExitCode = exitCode as number;
  if (browserProbeExitCode !== 0) {
    throw new Error(`GUI browser probe failed: ${tail(probeError) || `exit ${browserProbeExitCode}`}`);
  }
  return JSON.parse(output) as {
    readonly browserLaunchMs: number;
    readonly navigationCommittedMs: number;
    readonly firstUsableMs: number;
    readonly initialResources: BrowserResourceSummary;
  };
}

interface BrowserResourceSummary {
  readonly count: number;
  readonly totalDurationMs: number;
  readonly slowest: readonly BrowserResourceTiming[];
}

interface BrowserResourceTiming {
  readonly name: string;
  readonly initiatorType: string;
  readonly startTimeMs: number;
  readonly durationMs: number;
  readonly transferSize?: number;
}

function buildCommand(input: StartupProfileOptions): { readonly cmd: string; readonly args: readonly string[] } {
  if (input.surface === "tui") {
    return {
      cmd: "bun",
      args: [
        "packages/cli/src/index.ts",
        "tui",
        "--cwd",
        input.cwd,
        "--port",
        String(input.port),
        ...(input.provider ? ["--provider", input.provider] : []),
      ],
    };
  }
  return {
    cmd: "bun",
    args: [
      "packages/cli/src/index.ts",
      "gui",
      input.mode === "dev" ? "--dev" : "--prod",
      input.openBrowser ? "--open" : "--no-open",
      "--cwd",
      input.cwd,
      "--port",
      String(input.port),
      "--gui-port",
      String(input.guiPort),
    ],
  };
}

async function waitForPhaseMarker(phase: string): Promise<void> {
  while (Date.now() < deadline) {
    assertStartupChildRunning(`startup phase ${phase}`);
    if (phaseMarkers.some((marker) => marker.phase === phase)) {
      return;
    }
    await sleep(25);
  }
  throw new Error(`Timed out waiting for startup phase ${phase}`);
}

async function waitForHttpOk(url: string, milestone: string): Promise<void> {
  while (Date.now() < deadline) {
    assertStartupChildRunning(url);
    try {
      const response = await fetch(url);
      if (response.ok) {
        mark(milestone, url);
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function assertStartupChildRunning(waitTarget: string): void {
  if (childExitCode !== undefined) {
    throw new Error(`Startup child exited with code ${childExitCode} while waiting for ${waitTarget}`);
  }
}

function remainingTimeoutMs(): number {
  return Math.max(1, deadline - Date.now());
}

function terminateProcessTree(pid: number): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: 2_000,
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process already exited.
  }
}

function mark(name: string, detail?: string): void {
  markAt(name, Math.round(performance.now() - startedAt), detail);
}

function markAt(name: string, atMs: number, detail?: string): void {
  const milestone = {
    name,
    atMs,
    ...(detail ? { detail } : {}),
  };
  milestones.push(milestone);
  if (options.verbose) {
    process.stderr.write(`[startup-profile] ${milestone.atMs}ms ${name}${detail ? `: ${detail}` : ""}\n`);
  }
}

function collectPhaseMarkers(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const marker = line.match(/^KILN_STARTUP_PROFILE\s+(.+)$/);
    if (!marker) {
      continue;
    }
    try {
      phaseMarkers.push(JSON.parse(marker[1]!) as Record<string, unknown>);
    } catch {
      phaseMarkers.push({ parseError: line });
    }
  }
}

async function readStream(stream: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        const tailChunk = decoder.decode();
        if (tailChunk.length > 0) {
          onChunk(tailChunk);
        }
        return;
      }
      onChunk(decoder.decode(result.value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}

async function readCommand(command: readonly string[]): Promise<string> {
  const result = Bun.spawnSync([...command], { cwd: repoRoot, stdout: "pipe", stderr: "ignore" });
  return new TextDecoder().decode(result.stdout).trim();
}

async function readPackageVersion(packagePath: string, dependency: string): Promise<string | undefined> {
  const packageJson = await Bun.file(join(repoRoot, packagePath)).json() as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return packageJson.dependencies?.[dependency] ?? packageJson.devDependencies?.[dependency];
}

function clearGuiViteCache(root: string): void {
  const cachePath = resolve(root, "packages", "gui", "node_modules", ".vite");
  const allowedRoot = resolve(root, "packages", "gui", "node_modules");
  if (!cachePath.startsWith(`${allowedRoot}\\`) && !cachePath.startsWith(`${allowedRoot}/`)) {
    throw new Error(`Refusing to clear unexpected Vite cache path: ${cachePath}`);
  }
  if (existsSync(cachePath)) {
    rmSync(cachePath, { recursive: true, force: true });
  }
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readNumberFlag(args: readonly string[], flag: string, fallback: number): number {
  const raw = readFlag(args, flag);
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function redactPath(path: string): string {
  return `<workspace:${basename(path)}>`;
}

function tail(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 2_000) {
    return normalized;
  }
  return normalized.slice(-2_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
