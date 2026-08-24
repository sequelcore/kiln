import { Worker } from "node:worker_threads";
import type {
  KilnSkillCatalogDiagnosticsSnapshot,
  KilnSkillCatalogSnapshot,
} from "@kilnai/gateway-contracts";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import type { ProjectStateBinding } from "../application/project-state-root.js";

export interface SkillCatalogDiagnosticScanOptions {
  readonly projectPath: string;
  readonly userHome?: string;
  readonly cwd?: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
  readonly projectStateBinding?: ProjectStateBinding;
}

export interface SkillCatalogDiagnosticRead {
  readonly lifecycle: KilnSkillCatalogDiagnosticsSnapshot;
  readonly catalog?: KilnSkillCatalogSnapshot;
}

type SkillCatalogDiagnosticScanner = (
  options: SkillCatalogDiagnosticScanOptions,
) => Promise<KilnSkillCatalogSnapshot>;

type SkillCatalogDiagnosticWorkerMessage =
  | { readonly ok: true; readonly catalog: KilnSkillCatalogSnapshot }
  | { readonly ok: false; readonly reason: string };

export interface SkillCatalogDiagnosticWorkerPort {
  onMessage(listener: (message: SkillCatalogDiagnosticWorkerMessage) => void): void;
  onError(listener: (error: Error) => void): void;
  onExit(listener: (code: number) => void): void;
  terminate(): Promise<number>;
  unref?(): void;
}

export interface SkillCatalogDiagnosticWorkerScannerOptions {
  readonly createWorker?: (options: SkillCatalogDiagnosticScanOptions) => SkillCatalogDiagnosticWorkerPort;
  readonly timeoutMs?: number;
}

const SKILL_CATALOG_DIAGNOSTIC_TIMEOUT_MS = 10_000;
const SKILL_CATALOG_DIAGNOSTIC_MAX_ENTRIES = 8;
const DIAGNOSTIC_FAILURE_REASON = "Skill diagnostic inventory failed; use an explicit setup refresh to retry.";
const DIAGNOSTIC_CAPACITY_REASON = "Skill diagnostic inventory is busy; use an explicit setup refresh to retry.";

interface DiagnosticEntry {
  current?: KilnSkillCatalogSnapshot;
  observedAt?: Date;
  failureReason?: string;
  inFlight?: Promise<void>;
}

/**
 * Owns one process-local, single-flight diagnostic inventory per canonical
 * input. It is deliberately not an execution-admission cache.
 */
export class SkillCatalogDiagnosticInventory {
  readonly #entries = new Map<string, DiagnosticEntry>();

  constructor(
    private readonly scan: SkillCatalogDiagnosticScanner = createSkillCatalogDiagnosticWorkerScanner(),
    private readonly now: () => Date = () => new Date(),
    private readonly currentForMs = 15_000,
    private readonly maxEntries = SKILL_CATALOG_DIAGNOSTIC_MAX_ENTRIES,
  ) {}

  read(options: SkillCatalogDiagnosticScanOptions): SkillCatalogDiagnosticRead {
    const key = diagnosticKey(options);
    const entry = this.#entry(key);
    if (!entry) return { lifecycle: { state: "failed", reason: DIAGNOSTIC_CAPACITY_REASON } };
    const age = this.#age(entry);
    if (entry.failureReason) return this.#snapshot(entry, age);
    if (!entry.inFlight && (entry.current === undefined || age > this.currentForMs)) {
      entry.inFlight = this.#refresh(key, entry, options);
    }
    return this.#snapshot(entry, age);
  }

  /** Explicit retry port. Passive setup polling must call read(), never this. */
  async refresh(options: SkillCatalogDiagnosticScanOptions): Promise<SkillCatalogDiagnosticRead> {
    const key = diagnosticKey(options);
    const entry = this.#entry(key);
    if (!entry) return { lifecycle: { state: "failed", reason: DIAGNOSTIC_CAPACITY_REASON } };
    entry.inFlight ??= this.#refresh(key, entry, options);
    await entry.inFlight;
    return this.#snapshot(entry, this.#age(entry));
  }

  #snapshot(entry: DiagnosticEntry, age: number): SkillCatalogDiagnosticRead {
    if (entry.failureReason) {
      return {
        lifecycle: {
          state: "failed",
          reason: entry.failureReason,
          ...(entry.observedAt ? { observedAt: entry.observedAt.toISOString() } : {}),
        },
        ...(entry.current ? { catalog: entry.current } : {}),
      };
    }
    if (entry.current) {
      const empty = (entry.current.inventory?.candidates.length ?? 0) === 0 && entry.current.entries.length === 0;
      return {
        lifecycle: {
          state: age > this.currentForMs ? "stale" : empty ? "empty" : "current",
          ...(entry.observedAt ? { observedAt: entry.observedAt.toISOString() } : {}),
        },
        catalog: entry.current,
      };
    }
    return { lifecycle: { state: "pending" } };
  }

  #age(entry: DiagnosticEntry): number {
    return entry.observedAt
      ? this.now().getTime() - entry.observedAt.getTime()
      : Number.POSITIVE_INFINITY;
  }

  #entry(key: string): DiagnosticEntry | undefined {
    const existing = this.#entries.get(key);
    if (existing) {
      this.#entries.delete(key);
      this.#entries.set(key, existing);
      return existing;
    }
    if (this.#entries.size >= this.maxEntries) {
      const settledKey = [...this.#entries].find(([, candidate]) => candidate.inFlight === undefined)?.[0];
      if (settledKey === undefined) return undefined;
      this.#entries.delete(settledKey);
    }
    const created: DiagnosticEntry = {};
    this.#entries.set(key, created);
    return created;
  }

  async #refresh(
    key: string,
    entry: DiagnosticEntry,
    options: SkillCatalogDiagnosticScanOptions,
  ): Promise<void> {
    try {
      const catalog = await this.scan(options);
      entry.current = catalog;
      entry.observedAt = this.now();
      entry.failureReason = undefined;
    } catch (error: unknown) {
      entry.failureReason = diagnosticFailureReason(error);
    } finally {
      entry.inFlight = undefined;
      this.#entries.set(key, entry);
    }
  }
}

const diagnosticInventory = new SkillCatalogDiagnosticInventory();

export function readSkillCatalogDiagnostics(
  options: SkillCatalogDiagnosticScanOptions,
): SkillCatalogDiagnosticRead {
  return diagnosticInventory.read(options);
}

export function refreshSkillCatalogDiagnostics(
  options: SkillCatalogDiagnosticScanOptions,
): Promise<SkillCatalogDiagnosticRead> {
  return diagnosticInventory.refresh(options);
}

function diagnosticKey(options: SkillCatalogDiagnosticScanOptions): string {
  return JSON.stringify({
    projectPath: options.projectPath,
    userHome: options.userHome ?? null,
    cwd: options.cwd ?? null,
    skillsPath: options.projectStateBinding?.skillsPath ?? null,
    projectionPath: options.projectStateBinding?.projectionsPath ?? null,
    skillConfig: options.skillConfig ?? null,
  });
}

export function createSkillCatalogDiagnosticWorkerScanner(
  options: SkillCatalogDiagnosticWorkerScannerOptions = {},
): SkillCatalogDiagnosticScanner {
  const timeoutMs = options.timeoutMs ?? SKILL_CATALOG_DIAGNOSTIC_TIMEOUT_MS;
  const createWorker = options.createWorker ?? createNodeDiagnosticWorker;

  return (scanOptions) => new Promise((resolve, reject) => {
    const worker = createWorker(scanOptions);
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settle = (completion: () => void): boolean => {
      if (settled) return false;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      completion();
      return true;
    };

    worker.onMessage((message) => {
      settle(() => {
        if (message.ok) resolve(message.catalog);
        else reject(new Error(message.reason));
      });
    });
    worker.onError((error) => {
      settle(() => reject(error));
    });
    worker.onExit((code) => {
      settle(() => reject(new Error(code === 0
        ? "Skill diagnostic worker exited without returning evidence."
        : `Skill diagnostic worker exited with code ${code}.`)));
    });
    if (!settled) {
      timeout = setTimeout(() => {
        if (!settle(() => reject(new Error("Skill diagnostic worker exceeded its internal deadline.")))) return;
        terminateWorker(worker);
      }, timeoutMs);
      unrefTimer(timeout);
    }
    worker.unref?.();
  });
}

function createNodeDiagnosticWorker(
  options: SkillCatalogDiagnosticScanOptions,
): SkillCatalogDiagnosticWorkerPort {
  const worker = new Worker(new URL("./skill-catalog-diagnostics-worker.js", import.meta.url), {
    workerData: options,
  });
  return {
    onMessage: (listener) => { worker.once("message", listener); },
    onError: (listener) => { worker.once("error", listener); },
    onExit: (listener) => { worker.once("exit", listener); },
    terminate: () => worker.terminate(),
    unref: () => { worker.unref(); },
  };
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

function terminateWorker(worker: SkillCatalogDiagnosticWorkerPort): void {
  try {
    void worker.terminate().catch(() => undefined);
  } catch {
    // Timeout settlement is authoritative even if the worker implementation
    // cannot acknowledge termination.
  }
}

function diagnosticFailureReason(error: unknown): string {
  void error;
  return DIAGNOSTIC_FAILURE_REASON;
}
