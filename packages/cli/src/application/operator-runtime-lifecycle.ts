import { dirname, join } from "node:path";
import {
  OperatorRuntimeSupervisor,
  inspectOperatorRuntimeListener,
  readOperatorRuntimeBridgeCredentials,
  readOperatorRuntimeChildCredentials,
  type OperatorRuntimeLaunchDescriptor,
} from "@kilnai/runtime";
import { resolveGlobalConfigPath } from "../config/global-config.js";

export const GLOBAL_OPERATOR_RUNTIME_PORT = 4_820;

export interface GlobalOperatorRuntimeLifecycle {
  readonly runtimeDir: string;
  readonly port: number;
  readonly launch: OperatorRuntimeLaunchDescriptor;
  readonly supervisor: OperatorRuntimeSupervisor;
  readonly readBridgeCredentials: () => ReturnType<typeof readOperatorRuntimeBridgeCredentials>;
  readonly readChildCredentials: () => ReturnType<typeof readOperatorRuntimeChildCredentials>;
}

export function createGlobalOperatorRuntimeLifecycle(input: {
  readonly version: string;
  readonly execPath: string;
  readonly entrypoint: string;
  readonly globalConfigPath?: string;
}): GlobalOperatorRuntimeLifecycle {
  const runtimeDir = join(dirname(input.globalConfigPath ?? resolveGlobalConfigPath()), "runtime", "operator");
  const launch = resolveOperatorRuntimeLaunchDescriptor(input);
  const supervisor = new OperatorRuntimeSupervisor({
    runtimeDir,
    port: GLOBAL_OPERATOR_RUNTIME_PORT,
    version: input.version,
    launch,
    inspect: inspectOperatorRuntimeListener,
  });
  return {
    runtimeDir,
    port: GLOBAL_OPERATOR_RUNTIME_PORT,
    launch,
    supervisor,
    readBridgeCredentials: () => readOperatorRuntimeBridgeCredentials(runtimeDir),
    readChildCredentials: () => readOperatorRuntimeChildCredentials(runtimeDir),
  };
}

export function resolveOperatorRuntimeLaunchDescriptor(input: {
  readonly version: string;
  readonly execPath: string;
  readonly entrypoint: string;
}): OperatorRuntimeLaunchDescriptor {
  if (!input.entrypoint.trim()) throw new Error("Cannot resolve the versioned Kiln CLI entrypoint for operator runtime launch.");
  const mode = /(?:^|[\\/])(?:packages[\\/]cli[\\/]src|src)[\\/].*\.ts$/i.test(input.entrypoint)
    ? "local-dev"
    : "installed";
  return {
    schemaVersion: 1,
    command: input.execPath,
    args: [input.entrypoint, "operator-runtime", "serve", "--global-runtime"],
    mode,
    version: input.version,
  };
}
