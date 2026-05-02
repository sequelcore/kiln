import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export interface CredentialWatcherConfig {
  readonly rootDir: string;
  readonly intervalMs?: number;
  readonly setIntervalImpl?: typeof setInterval;
  readonly clearIntervalImpl?: typeof clearInterval;
}

export type CredentialWatcherListener = (providerId: string) => void | Promise<void>;

type Timer = ReturnType<typeof setInterval>;

export class CredentialWatcher {
  private readonly rootDir: string;
  private readonly intervalMs: number;
  private readonly setIntervalImpl: typeof setInterval;
  private readonly clearIntervalImpl: typeof clearInterval;
  private readonly listeners = new Map<string, Set<CredentialWatcherListener>>();
  private snapshot = new Map<string, bigint>();
  private timer: Timer | null = null;
  private scanInFlight = false;
  private initialized = false;

  constructor(config: CredentialWatcherConfig) {
    this.rootDir = config.rootDir;
    this.intervalMs = config.intervalMs ?? 500;
    this.setIntervalImpl = config.setIntervalImpl ?? setInterval;
    this.clearIntervalImpl = config.clearIntervalImpl ?? clearInterval;
  }

  onProviderChanged(providerId: string, listener: CredentialWatcherListener): () => void {
    const listeners = this.listeners.get(providerId) ?? new Set<CredentialWatcherListener>();
    listeners.add(listener);
    this.listeners.set(providerId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(providerId);
      }
    };
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      this.snapshot = await this.readSnapshot();
      this.initialized = true;
    }
    if (this.timer !== null) return;
    this.timer = this.setIntervalImpl(() => {
      void this.scanOnce();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      this.clearIntervalImpl(this.timer);
      this.timer = null;
    }
  }

  async scanOnce(): Promise<void> {
    if (this.scanInFlight) return;
    this.scanInFlight = true;
    try {
      const next = await this.readSnapshot();
      if (!this.initialized) {
        this.snapshot = next;
        this.initialized = true;
        return;
      }
      const changedProviders = diffProviders(this.snapshot, next);
      this.snapshot = next;
      for (const providerId of changedProviders) {
        const listeners = this.listeners.get(providerId);
        if (!listeners) continue;
        await Promise.all([...listeners].map((listener) => listener(providerId)));
      }
    } finally {
      this.scanInFlight = false;
    }
  }

  private async readSnapshot(): Promise<Map<string, bigint>> {
    const entries = new Map<string, bigint>();
    await collectJsonFiles(this.rootDir, this.rootDir, entries);
    return entries;
  }
}

async function collectJsonFiles(rootDir: string, currentDir: string, entries: Map<string, bigint>): Promise<void> {
  let dirEntries;
  try {
    dirEntries = await readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of dirEntries) {
    if (entry.name === ".health") continue;
    const path = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectJsonFiles(rootDir, path, entries);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fileStat = await stat(path);
    entries.set(relative(rootDir, path), readMtimeNs(fileStat));
  }
}

function diffProviders(previous: Map<string, bigint>, next: Map<string, bigint>): string[] {
  const changed = new Set<string>();
  for (const [path, mtime] of next) {
    if (previous.get(path) !== mtime) {
      addProvider(changed, path);
    }
  }
  for (const path of previous.keys()) {
    if (!next.has(path)) {
      addProvider(changed, path);
    }
  }
  return [...changed].sort();
}

function addProvider(changed: Set<string>, relativePath: string): void {
  const providerId = relativePath.split(/[\\/]/)[0];
  if (providerId && providerId.length > 0) {
    changed.add(providerId);
  }
}

function readMtimeNs(fileStat: Awaited<ReturnType<typeof stat>>): bigint {
  const maybeNs = fileStat as typeof fileStat & { mtimeNs?: bigint };
  if (typeof maybeNs.mtimeNs === "bigint") {
    return maybeNs.mtimeNs;
  }
  return BigInt(Math.trunc(Number(fileStat.mtimeMs) * 1_000_000));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
