import { spawnSync } from "node:child_process";
import type { KilnGlobalConfig } from "../config/global-config.js";

export interface EngineProbeExecution {
  readonly status: number | null;
  readonly error?: unknown;
}

export type EngineProbeRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => EngineProbeExecution;

export interface EngineProbeResult {
  readonly engineId: string;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly command?: string;
  readonly reason?: string;
}

export interface EngineRouteResolution {
  readonly worker: string | undefined;
  readonly reason: "default" | "missing-default" | "unavailable";
  readonly defaultWorker?: string;
  readonly fallback?: string;
}

export interface EngineRegistryOptions {
  readonly runner?: EngineProbeRunner;
  readonly timeoutMs?: number;
}

export interface EngineRouteContext {
  readonly isEngineAvailable?: (engineId: string) => boolean;
}

const ENGINE_COMMANDS: Readonly<Record<string, string>> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
};

const DEFAULT_ENGINE_PROBE_TIMEOUT_MS = 2_000;
const CLAUDE_COLD_START_RETRY_TIMEOUT_MS = 8_000;

export class EngineRegistry {
  private readonly runner: EngineProbeRunner;
  private readonly timeoutMs: number | undefined;

  constructor(options: EngineRegistryOptions = {}) {
    this.runner = options.runner ?? defaultProbeRunner;
    this.timeoutMs = options.timeoutMs;
  }

  probe(engineId: string, enabled = true): EngineProbeResult {
    const command = ENGINE_COMMANDS[engineId];
    if (!command) {
      return {
        engineId,
        enabled,
        available: enabled,
        reason: enabled ? "not-probed" : "disabled",
      };
    }

    if (!enabled) {
      return { engineId, enabled: false, available: false, command, reason: "disabled" };
    }

    const timeoutMs = this.timeoutMs ?? DEFAULT_ENGINE_PROBE_TIMEOUT_MS;
    let result = this.runner(command, ["--version"], timeoutMs);
    // Claude Code can exceed the normal probe window on a cold Windows start.
    // Retry only a genuine timeout: healthy starts and every other failure keep
    // the fast two-second path, while the retry remains strictly bounded.
    if (this.timeoutMs === undefined && engineId === "claude" && isProbeTimeout(result.error)) {
      result = this.runner(command, ["--version"], CLAUDE_COLD_START_RETRY_TIMEOUT_MS);
    }
    if (result.status === 0) {
      return { engineId, enabled: true, available: true, command };
    }
    return {
      engineId,
      enabled: true,
      available: false,
      command,
      reason: formatProbeFailure(result.error, result.status),
    };
  }

  probeAll(config: KilnGlobalConfig): EngineProbeResult[] {
    return Object.entries(config.engines ?? {})
      .filter(([, engine]) => engine.enabled === true)
      .map(([engineId, engine]) => this.probe(engineId, engine.enabled === true));
  }
}

function isProbeTimeout(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as Error & { readonly code?: unknown }).code === "ETIMEDOUT";
}

export function resolveEngineAvailabilityMap(
  config: KilnGlobalConfig | null | undefined,
  registry: Pick<EngineRegistry, "probeAll"> = new EngineRegistry(),
): ReadonlyMap<string, boolean> {
  if (!config) {
    return new Map();
  }
  return new Map(registry.probeAll(config).map((engine) => [engine.engineId, engine.available]));
}

export function resolveEngineRoute(
  config: KilnGlobalConfig,
  context: EngineRouteContext = {},
): EngineRouteResolution {
  const defaultTargetId = config.targetRouting?.defaultTargetId;
  const defaultTarget = config.targetCatalog?.targets.find((target) => target.id === defaultTargetId);
  const enabledEngines = Object.entries(config.engines ?? {})
    .filter(([, engine]) => engine.enabled === true)
    .map(([engineId]) => engineId);
  const defaultWorker = defaultTarget?.kind === "harness"
    ? defaultTarget.providerId
    : enabledEngines[0];
  const fallback = enabledEngines.find((engineId) => engineId !== defaultWorker);
  if (!defaultWorker) {
    return { worker: undefined, reason: "missing-default" };
  }
  if (context.isEngineAvailable?.(defaultWorker) === false && fallback) {
    return {
      worker: fallback,
      reason: "unavailable",
      defaultWorker,
      fallback,
    };
  }

  return { worker: defaultWorker, reason: "default", defaultWorker, fallback };
}

function defaultProbeRunner(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): EngineProbeExecution {
  const result = spawnSync(command, [...args], {
    encoding: "utf-8",
    timeout: timeoutMs,
    windowsHide: true,
  });
  return { status: result.status, error: result.error };
}

function formatProbeFailure(error: unknown, status: number | null): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (status !== null) {
    return `exit ${status}`;
  }
  return "probe failed";
}
