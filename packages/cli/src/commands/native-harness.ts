import { startNativeHarnessMcpServer } from "../native-harness/codex-app-mcp-server.js";
import { resolveNativeHarnessProjectRoot } from "../application/native-harness-project-root.js";
import type { NativeMcpHarness } from "../config/native-mcp-projection.js";

export async function nativeHarnessCommand(args: readonly string[]): Promise<void> {
  const parsed = parseNativeHarnessMcpArgs(args);
  const project = resolveNativeHarnessProjectRoot(parsed.projectPath);
  if (project.status !== "resolved") throw new Error("The trusted --project-root must contain .kiln/kiln.yaml.");

  process.stdin.pause();
  await startNativeHarnessMcpServer({ harness: parsed.harness, projectPath: project.rootPath });
  process.stdin.resume();
}

function parseNativeHarnessMcpArgs(args: readonly string[]): { readonly harness: NativeMcpHarness; readonly projectPath: string } {
  if (args.length !== 5 || args[0] !== "control-plane-mcp" || args[1] !== "--harness" || args[3] !== "--project-root") {
    throw new Error("Usage: kiln native-harness control-plane-mcp --harness <codex|claude|opencode> --project-root <path>");
  }
  const harness = args[2];
  const projectPath = args[4]?.trim();
  if ((harness !== "codex" && harness !== "claude" && harness !== "opencode") || !projectPath) {
    throw new Error("Usage: kiln native-harness control-plane-mcp --harness <codex|claude|opencode> --project-root <path>");
  }
  return { harness, projectPath };
}
