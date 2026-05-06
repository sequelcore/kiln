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

export interface EngineBudgetStatus {
  readonly engineId: string;
  readonly tokensUsed: number;
  readonly ceiling: number | null;
  readonly withinBudget: boolean;
}

export interface EngineRouteResolution {
  readonly worker: string | undefined;
  readonly reason: "default" | "budget-ceiling" | "missing-default";
  readonly defaultWorker?: string;
  readonly fallback?: string;
  readonly budget?: EngineBudgetStatus;
}

export interface EngineRegistryOptions {
  readonly runner?: EngineProbeRunner;
  readonly timeoutMs?: number;
}

export interface EngineRouteContext {
  readonly getDailyTokensUsed?: (engineId: string) => number;
}

const ENGINE_COMMANDS: Readonly<Record<string, string>> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
};

export class EngineRegistry {
  private readonly runner: EngineProbeRunner;
  private readonly timeoutMs: number;

  constructor(options: EngineRegistryOptions = {}) {
    this.runner = options.runner ?? defaultProbeRunner;
    this.timeoutMs = options.timeoutMs ?? 2_000;
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

    const result = this.runner(command, ["--version"], this.timeoutMs);
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

export function getEngineBudgetStatus(
  config: KilnGlobalConfig,
  engineId: string,
  context: EngineRouteContext = {},
): EngineBudgetStatus {
  const budget = config.routing?.budget?.[engineId];
  const ceiling = budget?.dailyTokenCeiling ?? null;
  const tokensUsed = context.getDailyTokensUsed?.(engineId) ?? 0;
  return {
    engineId,
    tokensUsed,
    ceiling,
    withinBudget: ceiling === null || tokensUsed <= ceiling,
  };
}

export function resolveEngineRoute(
  config: KilnGlobalConfig,
  context: EngineRouteContext = {},
): EngineRouteResolution {
  const defaultWorker = config.routing?.defaultWorker
    ?? Object.entries(config.engines ?? {}).find(([, engine]) => engine.enabled === true)?.[0];
  const fallback = config.routing?.fallback;
  if (!defaultWorker) {
    return { worker: undefined, reason: "missing-default" };
  }

  if (config.routing?.budgetAware === true) {
    const budget = getEngineBudgetStatus(config, defaultWorker, context);
    if (!budget.withinBudget && fallback) {
      return {
        worker: fallback,
        reason: "budget-ceiling",
        defaultWorker,
        fallback,
        budget,
      };
    }
    return { worker: defaultWorker, reason: "default", defaultWorker, fallback, budget };
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
