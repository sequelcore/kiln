import {
  createDefaultBuiltinToolSurface as createCoreBuiltinToolSurface,
  createSessionBuiltinToolOptions as createCoreSessionBuiltinToolOptions,
  type DefaultBuiltinToolRegistryOptions,
  type DefaultBuiltinToolSurface,
  SpawnMonitorCommandRunner,
} from "@kilnai/core/tools";
import { resolveVendoredToolBinary } from "@kilnai/tools";
import {
  detectRuntimeToolEnvironment,
  runNativeCommand,
  runNativeGitCommand,
  runNativeTesseractOcr,
} from "./native-command-execution.js";
import { SpawnCommandProcessRunner } from "./spawn-command-process-runner.js";
import { nodeBuiltinFilesystem } from "./node-builtin-filesystem.js";

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
    hostFilesystem: options.hostFilesystem ?? nodeBuiltinFilesystem,
    bash: {
      processRunner,
      environmentProvider: detectRuntimeToolEnvironment,
      platform: process.platform,
      ...options.bash,
    },
    git: {
      commandRunner: runNativeGitCommand,
      ...options.git,
    },
    grep: {
      filesystem: options.hostFilesystem ?? nodeBuiltinFilesystem,
      commandRunner: runNativeCommand,
      environmentProvider: detectRuntimeToolEnvironment,
      vendoredToolResolver: resolveVendoredToolBinary,
      configuredRgPath: process.env.KILN_RG_PATH,
      ...options.grep,
    },
    glob: {
      filesystem: options.hostFilesystem ?? nodeBuiltinFilesystem,
      commandRunner: runNativeCommand,
      environmentProvider: detectRuntimeToolEnvironment,
      vendoredToolResolver: resolveVendoredToolBinary,
      ...options.glob,
    },
    jsonQuery: {
      commandRunner: runNativeCommand,
      environmentProvider: detectRuntimeToolEnvironment,
      vendoredToolResolver: resolveVendoredToolBinary,
      ...options.jsonQuery,
    },
    ocrImage: {
      filesystem: options.hostFilesystem ?? nodeBuiltinFilesystem,
      ocrRunner: runNativeTesseractOcr,
      ...options.ocrImage,
    },
    monitor: {
      commandRunner: new SpawnMonitorCommandRunner(processRunner),
      ...options.monitor,
    },
  };
}
