import pkg from "../../package.json" with { type: "json" };
import type { OperatorRuntimeHarness } from "@kilnai/gateway-contracts";
import { createGlobalOperatorRuntimeLifecycle, type GlobalOperatorRuntimeLifecycle } from "../application/operator-runtime-lifecycle.js";
import { startGlobalMcpBridge, type StartGlobalMcpBridgeOptions } from "../native-harness/global-mcp-bridge.js";

interface NativeHarnessCommandDependencies {
  readonly createLifecycle: () => GlobalOperatorRuntimeLifecycle;
  readonly startBridge: (options: StartGlobalMcpBridgeOptions) => Promise<unknown>;
  readonly pauseStdin: () => void;
  readonly resumeStdin: () => void;
}

const defaultDependencies: NativeHarnessCommandDependencies = {
  createLifecycle: () => createGlobalOperatorRuntimeLifecycle({
    version: pkg.version,
    execPath: process.execPath,
    entrypoint: process.argv[1] ?? "",
  }),
  startBridge: startGlobalMcpBridge,
  pauseStdin: () => { process.stdin.pause(); },
  resumeStdin: () => { process.stdin.resume(); },
};

export async function nativeHarnessCommand(
  args: readonly string[],
  overrides: Partial<NativeHarnessCommandDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const parsed = parseNativeHarnessMcpArgs(args);
  const lifecycle = dependencies.createLifecycle();
  dependencies.pauseStdin();
  try {
    await dependencies.startBridge({
      harness: parsed.harness,
      supervisor: lifecycle.supervisor,
      readBridgeCredentials: lifecycle.readBridgeCredentials,
    });
  } finally {
    dependencies.resumeStdin();
  }
}

function parseNativeHarnessMcpArgs(args: readonly string[]): { readonly harness: OperatorRuntimeHarness } {
  if (args.length !== 3 || args[0] !== "control-plane-mcp" || args[1] !== "--harness") {
    throw new Error("Usage: kiln native-harness control-plane-mcp --harness <codex|claude|opencode>");
  }
  const harness = args[2];
  if (harness !== "codex" && harness !== "claude" && harness !== "opencode") {
    throw new Error("Usage: kiln native-harness control-plane-mcp --harness <codex|claude|opencode>");
  }
  return { harness };
}
