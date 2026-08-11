import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type SupportedGuiBrowserId = "edge" | "chrome" | "chromium";

interface GuiBrowserCandidate {
  readonly id: SupportedGuiBrowserId;
  readonly label: string;
  readonly commands: readonly string[];
  readonly absolutePaths: readonly string[];
}

export interface ResolvedGuiBrowserHost {
  readonly id: SupportedGuiBrowserId;
  readonly label: string;
  readonly executable: string;
}

export interface GuiWindowLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
}

export interface GuiWindowSession {
  readonly browserLabel: string;
  readonly child: ChildProcess;
  readonly whenClosed: Promise<void>;
  close(): void;
}

interface ResolveGuiBrowserHostOptions {
  readonly platform?: NodeJS.Platform;
  readonly resolveCommand?: (command: string, platform: NodeJS.Platform) => string | null;
  readonly pathExists?: (path: string) => boolean;
}

interface LaunchGuiWindowOptions extends ResolveGuiBrowserHostOptions {
  readonly spawnImpl?: typeof spawn;
  readonly createProfileDir?: () => string;
  readonly cleanupProfileDir?: (path: string) => void;
  readonly fetchImpl?: typeof fetch;
  readonly setIntervalImpl?: typeof setInterval;
  readonly clearIntervalImpl?: typeof clearInterval;
  readonly setTimeoutImpl?: typeof setTimeout;
  readonly clearTimeoutImpl?: typeof clearTimeout;
  readonly readDevToolsPort?: (profileDir: string) => number | null;
  readonly pollMs?: number;
  readonly startupTimeoutMs?: number;
}

interface DevToolsTargetSummary {
  readonly type?: string;
  readonly url?: string;
}

const WINDOWS_BROWSER_CANDIDATES: readonly GuiBrowserCandidate[] = [
  {
    id: "edge",
    label: "Microsoft Edge",
    commands: ["msedge", "msedge.exe"],
    absolutePaths: [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
  },
  {
    id: "chrome",
    label: "Google Chrome",
    commands: ["chrome", "chrome.exe"],
    absolutePaths: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
  },
  {
    id: "chromium",
    label: "Chromium",
    commands: ["chromium", "chromium.exe"],
    absolutePaths: [
      "C:\\Program Files\\Chromium\\Application\\chromium.exe",
      "C:\\Program Files (x86)\\Chromium\\Application\\chromium.exe",
    ],
  },
];

const DARWIN_BROWSER_CANDIDATES: readonly GuiBrowserCandidate[] = [
  {
    id: "edge",
    label: "Microsoft Edge",
    commands: ["microsoft-edge", "msedge"],
    absolutePaths: [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
  },
  {
    id: "chrome",
    label: "Google Chrome",
    commands: ["google-chrome", "chrome"],
    absolutePaths: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ],
  },
  {
    id: "chromium",
    label: "Chromium",
    commands: ["chromium", "chromium-browser"],
    absolutePaths: [
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
  },
];

const LINUX_BROWSER_CANDIDATES: readonly GuiBrowserCandidate[] = [
  {
    id: "edge",
    label: "Microsoft Edge",
    commands: ["microsoft-edge", "microsoft-edge-stable", "msedge"],
    absolutePaths: [],
  },
  {
    id: "chrome",
    label: "Google Chrome",
    commands: ["google-chrome", "google-chrome-stable", "chrome"],
    absolutePaths: [],
  },
  {
    id: "chromium",
    label: "Chromium",
    commands: ["chromium", "chromium-browser"],
    absolutePaths: [],
  },
];

function getBrowserCandidates(platform: NodeJS.Platform): readonly GuiBrowserCandidate[] {
  switch (platform) {
    case "win32":
      return WINDOWS_BROWSER_CANDIDATES;
    case "darwin":
      return DARWIN_BROWSER_CANDIDATES;
    default:
      return LINUX_BROWSER_CANDIDATES;
  }
}

function defaultResolveCommand(command: string, platform: NodeJS.Platform): string | null {
  const locator = platform === "win32" ? "where" : "which";
  const result = spawnSync(locator, [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  }) as SpawnSyncReturns<string>;

  if (result.status !== 0) {
    return null;
  }

  const firstMatch = result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstMatch ?? null;
}

function defaultCreateProfileDir(): string {
  return mkdtempSync(join(tmpdir(), "kiln-gui-window-"));
}

function defaultCleanupProfileDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function normalizeManagedGuiUrl(url: string): string {
  return url.replace(/[?#].*$/, "");
}

function tryReadDevToolsPort(profileDir: string): number | null {
  const activePortFile = join(profileDir, "DevToolsActivePort");
  if (!existsSync(activePortFile)) {
    return null;
  }

  try {
    const [portLine] = readFileSync(activePortFile, "utf8").split(/\r?\n/g);
    const port = Number.parseInt((portLine ?? "").trim(), 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function waitForManagedGuiAppWindowClose(
  url: string,
  profileDir: string,
  child: ChildProcess,
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly setIntervalImpl?: typeof setInterval;
    readonly clearIntervalImpl?: typeof clearInterval;
    readonly setTimeoutImpl?: typeof setTimeout;
    readonly clearTimeoutImpl?: typeof clearTimeout;
    readonly readDevToolsPort?: (profileDir: string) => number | null;
    readonly pollMs?: number;
    readonly startupTimeoutMs?: number;
  } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const readDevToolsPort = options.readDevToolsPort ?? tryReadDevToolsPort;
  const pollMs = options.pollMs ?? 500;
  const startupTimeoutMs = options.startupTimeoutMs ?? 15_000;
  const normalizedUrl = normalizeManagedGuiUrl(url);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let sawManagedAppTarget = false;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;
    let startupTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (intervalHandle) {
        clearIntervalImpl(intervalHandle);
        intervalHandle = null;
      }
      if (startupTimeoutHandle) {
        clearTimeoutImpl(startupTimeoutHandle);
        startupTimeoutHandle = null;
      }
    };

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      resolve();
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      reject(error);
    };

    const inspectTargets = async () => {
      if (settled) {
        return;
      }

      const port = readDevToolsPort(profileDir);
      if (!port) {
        return;
      }

      try {
        const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`);
        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        if (!Array.isArray(payload)) {
          return;
        }

        const hasManagedAppTarget = payload.some((target) => {
          const summary = target as DevToolsTargetSummary;
          return summary.type === "page"
            && typeof summary.url === "string"
            && normalizeManagedGuiUrl(summary.url) === normalizedUrl;
        });

        if (hasManagedAppTarget) {
          sawManagedAppTarget = true;
          if (startupTimeoutHandle) {
            clearTimeoutImpl(startupTimeoutHandle);
            startupTimeoutHandle = null;
          }
          return;
        }

        if (sawManagedAppTarget) {
          finish();
        }
      } catch {
        if (sawManagedAppTarget) {
          finish();
        }
      }
    };

    child.once("error", (error) => {
      if (!sawManagedAppTarget) {
        fail(error);
      }
    });

    intervalHandle = setIntervalImpl(() => {
      void inspectTargets();
    }, pollMs);
    startupTimeoutHandle = setTimeoutImpl(() => {
      fail(new Error(`GUI window did not expose its managed page within ${startupTimeoutMs} ms.`));
    }, startupTimeoutMs);
    void inspectTargets();
  });
}

export function resolveGuiBrowserHost(options: ResolveGuiBrowserHostOptions = {}): ResolvedGuiBrowserHost | null {
  const platform = options.platform ?? process.platform;
  const resolveCommand = options.resolveCommand ?? defaultResolveCommand;
  const pathExists = options.pathExists ?? existsSync;

  for (const candidate of getBrowserCandidates(platform)) {
    for (const command of candidate.commands) {
      const executable = resolveCommand(command, platform);
      if (executable) {
        return {
          id: candidate.id,
          label: candidate.label,
          executable,
        };
      }
    }
    for (const absolutePath of candidate.absolutePaths) {
      if (pathExists(absolutePath)) {
        return {
          id: candidate.id,
          label: candidate.label,
          executable: absolutePath,
        };
      }
    }
  }

  return null;
}

export function buildGuiWindowLaunchSpec(
  host: ResolvedGuiBrowserHost,
  url: string,
  profileDir: string,
): GuiWindowLaunchSpec {
  return {
    command: host.executable,
    args: [
      `--app=${url}`,
      "--new-window",
      `--user-data-dir=${profileDir}`,
      "--window-size=1440,980",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions",
      "--disable-component-update",
      "--disable-default-apps",
      "--no-service-autorun",
      "--disable-features=Translate,MediaRouter",
      "--remote-debugging-port=0",
    ],
  };
}

export function launchGuiWindow(
  url: string,
  options: LaunchGuiWindowOptions = {},
): GuiWindowSession {
  const host = resolveGuiBrowserHost(options);
  if (!host) {
    throw new Error(
      "No supported app-mode browser was found. Install Microsoft Edge, Google Chrome, or Chromium, or rerun with --no-open.",
    );
  }

  const spawnImpl = options.spawnImpl ?? spawn;
  const createProfileDir = options.createProfileDir ?? defaultCreateProfileDir;
  const cleanupProfileDir = options.cleanupProfileDir ?? defaultCleanupProfileDir;
  const profileDir = createProfileDir();
  const launchSpec = buildGuiWindowLaunchSpec(host, url, profileDir);

  const child = spawnImpl(launchSpec.command, [...launchSpec.args], {
    stdio: "ignore",
    windowsHide: false,
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    try {
      cleanupProfileDir(profileDir);
    } catch (error) {
      console.warn(`Could not clean up GUI browser profile at ${profileDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const whenClosed = waitForManagedGuiAppWindowClose(url, profileDir, child, options);
  void whenClosed.then(cleanup, cleanup);

  return {
    browserLabel: host.label,
    child,
    whenClosed,
    close() {
      if (child.exitCode === null) {
        child.kill();
      }
    },
  };
}
