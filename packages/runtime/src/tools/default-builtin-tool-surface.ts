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
  const hostFilesystem = options.hostFilesystem ?? nodeBuiltinFilesystem;
  const hostCwd = options.hostCwd ?? process.cwd();
  return {
    ...options,
    hostFilesystem,
    hostCwd,
    bash: {
      processRunner,
      environmentProvider: detectRuntimeToolEnvironment,
      platform: process.platform,
      defaultCwd: hostCwd,
      ...options.bash,
    },
    git: {
      commandRunner: runNativeGitCommand,
      defaultCwd: hostCwd,
      ...options.git,
    },
    grep: {
      filesystem: hostFilesystem,
      commandRunner: runNativeCommand,
      environmentProvider: detectRuntimeToolEnvironment,
      vendoredToolResolver: resolveVendoredToolBinary,
      configuredRgPath: process.env.KILN_RG_PATH,
      defaultCwd: hostCwd,
      ...options.grep,
    },
    glob: {
      filesystem: hostFilesystem,
      commandRunner: runNativeCommand,
      environmentProvider: detectRuntimeToolEnvironment,
      vendoredToolResolver: resolveVendoredToolBinary,
      defaultCwd: hostCwd,
      ...options.glob,
    },
    jsonQuery: {
      commandRunner: runNativeCommand,
      environmentProvider: detectRuntimeToolEnvironment,
      vendoredToolResolver: resolveVendoredToolBinary,
      defaultCwd: hostCwd,
      ...options.jsonQuery,
    },
    ocrImage: {
      filesystem: hostFilesystem,
      ocrRunner: runNativeTesseractOcr,
      ...options.ocrImage,
    },
    monitor: {
      commandRunner: new SpawnMonitorCommandRunner(processRunner),
      ...options.monitor,
    },
  };
}
