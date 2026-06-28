import { existsSync, rmSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { basename, join, resolve } from "node:path";

type Surface = "gui";
type GuiMode = "dev" | "prod";

interface StartupProfileOptions {
  readonly surface: Surface;
  readonly mode: GuiMode;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly port: number;
  readonly guiPort: number;
  readonly openBrowser: boolean;
  readonly clearViteCache: boolean;
}

interface StartupMilestone {
  readonly name: string;
  readonly atMs: number;
  readonly detail?: string;
}

const repoRoot = resolve(import.meta.dir, "..");

const options = parseArgs(process.argv.slice(2));
const startedAt = performance.now();
const milestones: StartupMilestone[] = [];
const phaseMarkers: Array<Record<string, unknown>> = [];
let stdout = "";
let stderr = "";
let viteReadyMs: number | undefined;

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
  await waitForHttpOk(`http://localhost:${options.port}/health`, "gateway-health-ready");
  await waitForHttpOk(`http://localhost:${options.port}/gui/api/dashboard`, "gateway-dashboard-ready");
  const guiUrl = options.mode === "dev"
    ? `http://localhost:${options.guiPort}/gui/`
    : `http://localhost:${options.port}/gui/`;
  await waitForHttpOk(guiUrl, "gui-url-ready");
} finally {
  if (child.exitCode === null) {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } else {
      child.kill("SIGINT");
    }
  }
  await Promise.race([
    child.exited.catch(() => undefined),
    sleep(2_000).then(() => {
      child.kill("SIGKILL");
    }),
  ]);
  await Promise.allSettled([stdoutReader, stderrReader]);
}

const endedAt = performance.now();
const result = {
  profileVersion: 1,
  command: {
    surface: options.surface,
    mode: options.mode,
    cwd: redactPath(options.cwd),
    openBrowser: options.openBrowser,
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
    providerDiscovery: existsSync(join(options.cwd, ".kiln", "cache", "provider-discovery.json")) ? "present" : "missing",
    viteDeps: existsSync(join(repoRoot, "packages", "gui", "node_modules", ".vite")) ? "present" : "missing",
    clearViteCache: options.clearViteCache,
  },
  timings: {
    totalMs: Math.round(endedAt - startedAt),
    viteReadyMs,
    milestones,
    phaseMarkers,
  },
  output: {
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  },
};

console.log(JSON.stringify(result, null, 2));

function parseArgs(args: readonly string[]): StartupProfileOptions {
  const mode = readFlag(args, "--mode") ?? "dev";
  if (mode !== "dev" && mode !== "prod") {
    throw new Error("--mode must be dev or prod");
  }
  const cwd = resolve(readFlag(args, "--cwd") ?? repoRoot);
  return {
    surface: "gui",
    mode,
    cwd,
    timeoutMs: readNumberFlag(args, "--timeout-ms", 30_000),
    port: readNumberFlag(args, "--port", 4810),
    guiPort: readNumberFlag(args, "--gui-port", 5183),
    openBrowser: args.includes("--open"),
    clearViteCache: args.includes("--clear-vite-cache"),
  };
}

function buildCommand(input: StartupProfileOptions): { readonly cmd: string; readonly args: readonly string[] } {
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

async function waitForHttpOk(url: string, milestone: string): Promise<void> {
  while (Date.now() < deadline) {
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

function mark(name: string, detail?: string): void {
  milestones.push({
    name,
    atMs: Math.round(performance.now() - startedAt),
    ...(detail ? { detail } : {}),
  });
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
