import {
  createDefaultBuiltinToolSurface as createCoreBuiltinToolSurface,
  createSessionBuiltinToolOptions as createCoreSessionBuiltinToolOptions,
  type DefaultBuiltinToolRegistryOptions,
  type DefaultBuiltinToolSurface,
  SpawnMonitorCommandRunner,
} from "@kilnai/core/tools";
import { SpawnCommandProcessRunner } from "./spawn-command-process-runner.js";

/** Materializes Core's canonical tool contracts with Runtime-owned process execution. */
export function createDefaultBuiltinToolSurface(
  options: DefaultBuiltinToolRegistryOptions = {},
): DefaultBuiltinToolSurface {
  return createCoreBuiltinToolSurface(withRuntimeProcessExecution(options));
}

export function createSessionBuiltinToolOptions(
  options: DefaultBuiltinToolRegistryOptions = {},
): DefaultBuiltinToolRegistryOptions {
  return createCoreSessionBuiltinToolOptions(withRuntimeProcessExecution(options));
}

function withRuntimeProcessExecution(options: DefaultBuiltinToolRegistryOptions): DefaultBuiltinToolRegistryOptions {
  const processRunner = new SpawnCommandProcessRunner();
  return {
    ...options,
    bash: {
      processRunner,
      platform: process.platform,
      ...options.bash,
    },
    monitor: {
      commandRunner: new SpawnMonitorCommandRunner(processRunner),
      ...options.monitor,
    },
  };
}
